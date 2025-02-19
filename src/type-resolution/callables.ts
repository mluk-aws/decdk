import * as reflect from 'jsii-reflect';
import { TypeReference, TypeSystem } from 'jsii-reflect';
import {
  assertExactlyOneOfFields,
  assertOneField,
  assertOneOf,
} from '../parser/private/types';
import {
  ArrayLiteral,
  asArrayLiteral,
  GetPropIntrinsic,
  ObjectLiteral,
  RefIntrinsic,
  Template,
  TemplateExpression,
  TemplateResource,
} from '../parser/template';
import { FactoryMethodCall, toArrayLiteral } from '../parser/template/calls';
import { TypedArrayExpression, TypedTemplateExpression } from './expression';
import { ResolveReferenceExpression } from './references';
import { resolveExpressionType } from './resolve';
import { isCfnResource } from './resource-like';
import { assertImplements } from './types';

export interface StaticMethodCallExpression {
  readonly type: 'staticMethodCall';
  readonly fqn: string;
  readonly namespace?: string;
  readonly method: string;
  readonly args: TypedArrayExpression;
}

export interface InstanceMethodCallExpression {
  readonly type: 'instanceMethodCall';
  readonly target: ResolveReferenceExpression;
  readonly method: string;
  readonly args: TypedArrayExpression;
}

interface MethodCall {
  readonly method: reflect.Method;
  readonly args: TypedArrayExpression;
}

interface InstanceMethodCall extends MethodCall {
  readonly target: ResolveReferenceExpression;
}

export function methodFQN(method: reflect.Method): string {
  return `${method.parentType.fqn}.${method.name}`;
}

export function resolveStaticMethodCallExpression(
  call: FactoryMethodCall,
  typeSystem: reflect.TypeSystem,
  resultType?: reflect.Type
): StaticMethodCallExpression {
  const { method, args } = inferMethodCall(typeSystem, call);

  if (resultType) {
    assertImplements(method.returns.type, resultType);
  }

  return {
    type: 'staticMethodCall',
    fqn: method.parentType.fqn,
    namespace: method.parentType.namespace,
    method: method.name,
    args,
  };
}

export function resolveInstanceMethodCallExpression(
  template: Template,
  call: Required<FactoryMethodCall>,
  typeSystem: reflect.TypeSystem,
  resultType?: reflect.Type
): InstanceMethodCallExpression {
  const { target, method, args } = inferInstanceMethodCall(
    typeSystem,
    template,
    call
  );

  if (resultType) {
    assertImplements(method.returns.type, resultType);
  }

  return {
    type: 'instanceMethodCall',
    target,
    method: method.name,
    args,
  };
}

function inferMethodCall(
  typeSystem: reflect.TypeSystem,
  call: FactoryMethodCall
): MethodCall {
  const candidateFqn = enclosingClassFqn(call.methodName);
  const candidateClass = typeSystem.findClass(candidateFqn);

  const methods = staticNonVoidMethods(candidateClass);
  const methodNames = methods.map(methodFQN);
  const methodName = assertOneOf(call.methodName, methodNames);
  const method = methods.find((m) => methodFQN(m) === methodName)!;

  return {
    method,
    args: resolveArguments(call.arguments, method),
  };
}

function inferInstanceMethodCall(
  typeSystem: TypeSystem,
  template: Template,
  call: Required<FactoryMethodCall>
): InstanceMethodCall {
  const factory = inferType(call.target);
  const method = inferMethod(factory, call.methodName);
  const args = resolveArguments(call.arguments, method);

  return {
    target: {
      type: 'resolve-reference',
      reference: makeRefOrGetPropIntrinsic(call.target),
    },
    method,
    args,
  };

  function inferType(refPath: string): TypeReference {
    let res: TemplateResource;
    if (!refPath.includes('.')) {
      res = template.resource(refPath);
      if (isCfnResource(res)) {
        throw new Error(
          `${res.type} is a CloudFormation resource. Method calls are not allowed.`
        );
      }

      if (res.type) {
        return typeSystem.findFqn(res.type).reference;
      }

      if (res.call?.target) {
        return inferMethod(inferType(res.call.target), res.call.methodName)
          .returns.type;
      }

      if (res.call != null) {
        const methodCall = inferMethodCall(typeSystem, res.call);
        return methodCall.method.returns.type;
      }

      throw new Error(
        `The type of ${refPath} could not be inferred. Please provide the type explicitly.`
      );
    } else {
      const [logicalId, ...propPath] = refPath.split('.');
      return resolveTypeFromPath(inferType(logicalId).type, propPath).reference;
    }
  }
}

function inferMethod(
  typeRef: reflect.TypeReference,
  methodName: string
): reflect.Method {
  const candidateType = resolveTypeFromPath(typeRef.type, []);
  const methods = candidateType?.allMethods.filter((m) => !m.static);
  const methodNames = methods.map((m) => m.name);

  if (!methodNames.includes(methodName)) {
    throw new Error(
      `'${candidateType.fqn}' has no method called '${methodName}'`
    );
  }

  return methods.find((m) => m.name === methodName)!;
}

function resolveTypeFromPath(
  type: reflect.Type | undefined,
  path: string[]
): reflect.ReferenceType {
  const result = path.reduce((t, name) => {
    const property = assertReferenceType(t).allProperties.find(
      (p) => p.name === name
    );
    if (!property) {
      throw new Error(`Invalid construct path '${path}'.`);
    }
    return property.type.type;
  }, type);

  return assertReferenceType(result);
}

function enclosingClassFqn(methodFqn: string): string {
  const parts = methodFqn.split('.');
  return parts.slice(0, parts.length - 1).join('.');
}

export interface InitializerExpression {
  readonly type: 'initializer';
  readonly fqn: string;
  readonly namespace?: string;
  readonly args: TypedArrayExpression;
}

export function resolveInstanceExpression(
  x: ObjectLiteral,
  type: reflect.InterfaceType | reflect.ClassType
): InitializerExpression | StaticMethodCallExpression {
  const candidateFQN = assertOneField(x.fields);
  const klass = type.system.tryFindFqn(candidateFQN);

  // Cannot find a class for the fqn, try a static method call instead
  if (!klass) {
    const call: FactoryMethodCall = {
      methodName: candidateFQN,
      arguments: toArrayLiteral(x.fields[candidateFQN]),
    };
    return resolveStaticMethodCallExpression(call, type.system, type);
  }

  const classFqn = selectClassFqn(x, type);
  const parameters = asArrayLiteral(x.fields[classFqn]);
  const initializer = assertInitializer(klass);
  const args = resolveArguments(parameters, initializer);

  return {
    type: 'initializer',
    fqn: klass.fqn,
    namespace: klass.namespace,
    args,
  };
}

function selectClassFqn(
  x: ObjectLiteral,
  type: reflect.ClassType | reflect.InterfaceType
): string {
  const possibleImplementations = type.system.classes
    .filter((i) => i.extends(type))
    .map((s) => s.fqn);

  return assertExactlyOneOfFields(x.fields, possibleImplementations);
}

export function assertInitializer(type: reflect.Type): reflect.Initializer {
  if (!type.isClassType() || !type.initializer) {
    throw new TypeError(`Expected Class Initializer, got ${type.toString()}`);
  }

  return type.initializer;
}

export function resolveArguments(
  x: ArrayLiteral,
  callable: reflect.Callable
): TypedArrayExpression {
  const paramArray = prepareParameters(x, callable).filter(
    (expr) => expr.type !== 'null'
  );
  const args: TypedTemplateExpression[] = [];

  for (let i = 0; i < callable.parameters.length; i++) {
    const p = callable.parameters[i];
    args.push(parameterToArg(paramArray[i], p, callable));
  }

  return {
    type: 'array',
    array: args,
  };
}

/**
 * Returns an array of parameters such that scope and id (if it applies) are in
 * the right positions.
 */
function prepareParameters(
  x: ArrayLiteral,
  callable: reflect.Callable
): TemplateExpression[] {
  const typeSystem = callable.system;
  const constructType = typeSystem.findClass('constructs.Construct');
  const parameters = callable.parameters;

  if (parameters.length > 2 && isScope(parameters[0]) && isId(parameters[1])) {
    if (
      x.array.length === 1 &&
      x.array[0].type === 'intrinsic' &&
      x.array[0].fn === 'args'
    ) {
      return x.array[0].array;
    } else {
      return [
        makeRefIntrinsic('CDK::Scope'),
        {
          type: 'intrinsic',
          fn: 'lazyLogicalId',
          errorMessage: `Call to ${callable.parentType.fqn}.${
            callable.name
          } with parameters:

${JSON.stringify(x.array)}

failed because the id could not be inferred. Use the intrinsic function CDK::Args to pass scope and id explicitly.`,
        },
        ...x.array,
      ];
    }
  }
  return x.array;

  function isScope(p: reflect.Parameter): boolean {
    const type = p.type.type;
    return Boolean(
      p.name === 'scope' && type?.isClassType() && type?.extends(constructType)
    );
  }

  function isId(p: reflect.Parameter): boolean {
    return p.name === 'id' && p.type.primitive === 'string';
  }
}

function parameterToArg(
  x: TemplateExpression,
  parameter: reflect.Parameter,
  callable: reflect.Callable
): TypedTemplateExpression {
  if (x === undefined) {
    if (!parameter.optional) {
      throw new TypeError(
        `Expected required parameter '${parameter.name}' for ${callable.parentType.fqn}.${callable.name}`
      );
    }
    return { type: 'void' };
  }
  return resolveExpressionType(x, parameter.type);
}

function assertReferenceType(
  t: reflect.Type | undefined
): reflect.ReferenceType {
  if (!t || !(t.isClassType() || t.isInterfaceType())) {
    throw new Error(`Construct paths must only contain classes or interfaces.`);
  }
  return t;
}

function staticNonVoidMethods(cls: reflect.ClassType) {
  return cls.allMethods.filter(
    (m) => m.static && m.returns && m.returns.type.type
  );
}

function makeRefOrGetPropIntrinsic(
  referencePath: string
): RefIntrinsic | GetPropIntrinsic {
  if (referencePath.includes('.')) {
    return makeGetPropIntrinsic(referencePath);
  }

  return makeRefIntrinsic(referencePath);
}

function makeRefIntrinsic(logicalId: string): RefIntrinsic {
  return {
    type: 'intrinsic',
    fn: 'ref',
    logicalId,
  };
}

function makeGetPropIntrinsic(path: string): GetPropIntrinsic {
  const [logicalId, ...propPath] = path.split('.');

  return {
    type: 'intrinsic',
    fn: 'getProp',
    logicalId,
    property: propPath.join('.'),
  };
}
