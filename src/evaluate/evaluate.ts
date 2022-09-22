import * as cdk from 'aws-cdk-lib';
import { CfnResource, Token } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';
import { SubFragment } from '../parser/private/sub';
import { assertBoolean, assertString } from '../parser/private/types';
import { GetPropIntrinsic, RefIntrinsic } from '../parser/template';
import { ResourceOverride } from '../parser/template/overrides';
import { ResourceTag } from '../parser/template/tags';
import { isCdkConstructExpression, ResourceLike } from '../type-resolution';
import {
  InstanceMethodCallExpression,
  StaticMethodCallExpression,
} from '../type-resolution/callables';
import { TypedTemplateExpression } from '../type-resolution/expression';
import { EvaluationContext } from './context';
import { applyOverride } from './overrides';
import {
  CfnResourceReference,
  ConstructReference,
  ValueOnlyReference,
} from './references';

export class Evaluator {
  constructor(public readonly context: EvaluationContext) {}

  public evaluateTemplate() {
    return this.context.template.resources.forEach((_logicalId, resource) =>
      this.evaluateResource(resource)
    );
  }

  public evaluateResource(resource: ResourceLike) {
    const construct = this.evaluate(resource);

    // If this is the result of a call to a method with no
    // return type (void), then there is nothing else to do here.
    if (construct == null) return;

    this.applyTags(construct, resource.tags);
    this.applyDependsOn(construct, resource.dependsOn);
    if (isCdkConstructExpression(resource)) {
      this.applyOverrides(construct, resource.overrides);
    }

    this.context.addReference(
      this.referenceForResourceLike(resource.logicalId, construct)
    );
  }

  private referenceForResourceLike(logicalId: string, value: unknown) {
    if (!Construct.isConstruct(value)) {
      return new ValueOnlyReference(logicalId, value);
    }

    if (CfnResource.isCfnResource(value)) {
      return new CfnResourceReference(logicalId, value);
    }

    return new ConstructReference(logicalId, value as Construct);
  }

  public evaluate(x: TypedTemplateExpression): any {
    const ev = this.evaluate.bind(this);
    const maybeEv = (y?: TypedTemplateExpression): any =>
      y ? ev(y) : undefined;

    switch (x.type) {
      case 'string':
      case 'number':
      case 'boolean':
        return x.value;
      case 'date':
        return x.date;
      case 'array':
        return this.evaluateArray(x.array);
      case 'struct':
      case 'object':
        return this.evaluateObject(x.fields);
      case 'resolve-reference':
        return this.resolveReferences(x.reference);
      case 'intrinsic':
        switch (x.fn) {
          case 'base64':
            return this.fnBase64(assertString(ev(x.expression)));
          case 'cidr':
            return this.fnCidr(ev(x.ipBlock), ev(x.count), maybeEv(x.netMask));
          case 'findInMap':
            return this.fnFindInMap(
              x.mappingName,
              assertString(ev(x.key1)),
              assertString(ev(x.key2))
            );
          case 'getAtt':
            return this.fnGetAtt(x.logicalId, assertString(ev(x.attribute)));
          case 'getProp':
            return this.fnGetProp(x.logicalId, assertString(x.property));
          case 'getAzs':
            return this.fnGetAzs(assertString(ev(x.region)));
          case 'if':
            return this.fnIf(x.conditionName, x.then, x.else);
          case 'importValue':
            return this.fnImportValue(assertString(ev(x.export)));
          case 'join':
            return this.fnJoin(assertString(x.separator), ev(x.list));
          case 'ref':
            return this.cfnRef(x.logicalId);
          case 'select':
            return this.fnSelect(ev(x.index), ev(x.objects));
          case 'split':
            return this.fnSplit(x.separator, assertString(ev(x.value)));
          case 'sub':
            return this.fnSub(
              x.fragments,
              this.evaluateObject(x.additionalContext)
            );
          case 'transform':
            return this.fnTransform(
              x.transformName,
              this.evaluateObject(x.parameters)
            );
          case 'and':
            return this.fnAnd(x.operands.map(ev).map(assertBoolean));
          case 'or':
            return this.fnOr(x.operands.map(ev).map(assertBoolean));
          case 'not':
            return this.fnNot(assertBoolean(ev(x.operand)));
          case 'equals':
            return this.fnEquals(ev(x.value1), ev(x.value2));
        }
      case 'enum':
        return this.enum(x.fqn, x.choice);
      case 'staticProperty':
        return this.enum(x.fqn, x.property);
      case 'any':
        return ev(x.value);
      case 'void':
        return;
      case 'lazyResource':
        return this.invoke(x.call);
      case 'construct':
      case 'resource':
        return this.initializer(x.fqn, [
          this.context.stack,
          x.logicalId,
          ev(x.props),
        ]);
      case 'initializer':
        return this.initializer(x.fqn, this.evaluateArray(x.args.array));
      case 'staticMethodCall':
        return this.invokeStaticMethod(
          x.fqn,
          x.method,
          this.evaluateArray(x.args.array)
        );
    }
  }

  public evaluateObject(
    xs: Record<string, TypedTemplateExpression>
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(xs).map(([k, v]) => [k, this.evaluate(v)])
    );
  }

  public evaluateArray(xs: TypedTemplateExpression[]) {
    return xs.map(this.evaluate.bind(this));
  }

  public evaluateCondition(conditionName: string) {
    const condition = this.context.condition(conditionName);
    const result = this.evaluate(condition);
    if (typeof result !== 'boolean') {
      throw new Error(
        `Condition does not evaluate to boolean: ${JSON.stringify(result)}`
      );
    }
    return result;
  }

  protected invoke(
    call: StaticMethodCallExpression | InstanceMethodCallExpression
  ) {
    const parameters = this.evaluateArray(call.args.array);

    return call.type === 'staticMethodCall'
      ? this.invokeStaticMethod(call.fqn, call.method, parameters)
      : this.invokeInstanceMethod(call.logicalId, call.method, parameters);
  }

  private invokeInstanceMethod(
    logicalId: string,
    method: string,
    parameters: any[]
  ) {
    const record = this.context.reference(logicalId);
    const construct = record.instance as any;
    return construct[method](...parameters);
  }

  protected invokeStaticMethod(
    fqn: string,
    method: string,
    parameters: unknown[]
  ): any {
    const typeClass = this.context.resolveClass(fqn);
    return typeClass[method](...parameters);
  }

  protected initializer(fqn: string, parameters: unknown[]): any {
    const typeClass = this.context.resolveClass(fqn);
    return new typeClass(...parameters);
  }

  protected enum(fqn: string, choice: string): any {
    const typeClass = this.context.resolveClass(fqn);
    return typeClass[choice];
  }

  protected fnBase64(x: string) {
    return cdk.Fn.base64(x);
  }

  protected fnCidr(ipBlock: string, count: number, sizeMask?: string) {
    return cdk.Fn.cidr(ipBlock, count, sizeMask);
  }

  protected fnFindInMap(mappingName: string, key1: string, key2: string) {
    const map = this.context.mapping(mappingName);
    const inner = map.get(key1);
    if (!inner) {
      throw new Error(
        `Mapping ${mappingName} has no key '${key1}' (available: ${Object.keys(
          map
        )})`
      );
    }
    const ret = inner.get(key2);
    if (ret === undefined) {
      throw new Error(
        `Mapping ${mappingName}[${key1}] has no key '${key2}' (available: ${Object.keys(
          inner
        )})`
      );
    }
    return ret;
  }

  protected fnGetProp(logicalId: string, prop: string) {
    const c = this.context.reference(logicalId);
    if (!c.instance || !c.hasProp(prop)) {
      throw Error(
        `CDK::GetProp: Expected Construct Property, got: ${logicalId}.${prop}`
      );
    }
    return c.instance?.[prop];
  }

  protected fnGetAtt(logicalId: string, attribute: string) {
    const c = this.context.reference(logicalId);
    if (!c.hasAtt?.(attribute)) {
      throw Error(
        `Fn::GetAtt: Expected Cloudformation Attribute, got: ${logicalId}.${attribute}`
      );
    }
    return cdk.Fn.getAtt(c.ref, attribute);
  }

  protected fnGetAzs(region: string) {
    return cdk.Fn.getAzs(region);
  }

  protected fnIf(
    conditionName: string,
    ifYes: TypedTemplateExpression,
    ifNo: TypedTemplateExpression
  ) {
    const evaled = this.evaluateCondition(conditionName);
    return evaled ? this.evaluate(ifYes) : this.evaluate(ifNo);
  }

  protected fnImportValue(exportName: string) {
    return cdk.Fn.importValue(exportName);
  }

  protected fnJoin(separator: string, array: any[]) {
    return cdk.Fn.join(separator, array);
  }

  protected resolveReferences(intrinsic: RefIntrinsic | GetPropIntrinsic) {
    const { logicalId, fn } = intrinsic;
    const c = this.context.reference(logicalId);

    if (fn !== 'ref') {
      return this.evaluate(intrinsic);
    }

    if (!c.instance) {
      return this.cfnRef(logicalId);
    }

    return c.instance;
  }

  protected cfnRef(logicalId: string) {
    const c = this.context.reference(logicalId);
    return cdk.Fn.ref(c.ref);
  }

  protected fnSelect(index: number, elements: any[]) {
    return cdk.Fn.select(index, elements);
  }

  protected fnSplit(separator: string, value: string) {
    return cdk.Fn.split(separator, value);
  }

  protected fnSub(
    fragments: SubFragment[],
    additionalContext: Record<string, any>
  ) {
    const asVariable = (x: string) => '${' + x + '}';
    const assertUndefinedIfEmpty = (
      x: Record<string, any>
    ): Record<string, any> | undefined => {
      if (!x || Object.keys(x).length === 0) {
        return;
      }
      return x;
    };

    const body = fragments
      .map((part) => {
        switch (part.type) {
          case 'literal':
            return part.content;
          case 'ref':
            if (part.logicalId in additionalContext) {
              return asVariable(part.logicalId);
            }
            return asVariable(this.context.reference(part.logicalId).ref);
          case 'getatt':
            const attVal = this.fnGetAtt(part.logicalId, part.attr);
            if (Token.isUnresolved(attVal)) {
              return asVariable(part.logicalId + '.' + part.attr);
            }
            return attVal;
        }
      })
      .join('');

    return cdk.Fn.sub(body, assertUndefinedIfEmpty(additionalContext));
  }

  protected fnTransform(
    transformName: string,
    parameters: Record<string, unknown>
  ) {
    return cdk.Fn.transform(transformName, parameters);
  }

  protected fnAnd(_operands: boolean[]): boolean {
    // @todo
    throw Error('not implemented');
    // return operands.every((x) => x);
    // return cdk.Fn.conditionAnd(...operands) as any;
  }

  protected fnOr(_operands: boolean[]): boolean {
    // @todo
    throw Error('not implemented');
    // return operands.some((x) => x);
    // return cdk.Fn.conditionOr(...operands);
  }

  protected fnNot(_operand: boolean): boolean {
    // @todo
    throw Error('not implemented');
    // return !operand;
    // return cdk.Fn.conditionNot(operand);
  }

  protected fnEquals(_value1: unknown, _value2: unknown): boolean {
    // @todo
    throw Error('not implemented');
    // return assertString(value1) === assertString(value2);
    // return cdk.Fn.conditionEquals(value1, value2);
  }

  protected applyTags(resource: IConstruct, tags: ResourceTag[] = []) {
    tags.forEach((tag: ResourceTag) => {
      cdk.Tags.of(resource).add(tag.key, tag.value);
    });
  }

  protected applyDependsOn(from: IConstruct, dependencies: string[] = []) {
    from.node?.addDependency(
      ...dependencies.map((to) => this.context.stack.node.findChild(to))
    );
  }

  protected applyOverrides(
    resource: IConstruct,
    overrides: ResourceOverride[]
  ) {
    const ev = this.evaluate.bind(this);
    overrides.forEach((override: ResourceOverride) => {
      applyOverride(resource, override, ev);
    });
  }
}
