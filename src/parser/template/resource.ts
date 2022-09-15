import {
  assertAtMostOneOfFields,
  assertField,
  assertObject,
  assertString,
  assertStringOrList,
  parseRetentionPolicy,
} from '../private/types';
import { schema } from '../schema';
import { parseCall } from './calls';
import { RetentionPolicy } from './enums';
import {
  ifField,
  ObjectLiteral,
  parseObject,
  TemplateExpression,
} from './expression';
import { parseOverrides, ResourceOverride } from './overrides';
import { parseTags, ResourceTag } from './tags';

export interface TemplateResource {
  readonly type: string;
  readonly properties: Record<string, TemplateExpression>;
  readonly conditionName?: string;
  readonly dependencies: Set<string>;
  readonly dependsOn: Set<string>;
  readonly deletionPolicy: RetentionPolicy;
  readonly updateReplacePolicy: RetentionPolicy;
  readonly metadata: Record<string, unknown>;
  readonly tags: ResourceTag[];
  readonly overrides: ResourceOverride[];
  readonly call: ObjectLiteral;

  // readonly creationPolicy?: CreationPolicy;
  // readonly updatePolicy?: UpdatePolicy;
}

export function parseTemplateResource(
  resource: schema.Resource
): TemplateResource {
  assertAtMostOneOfFields(resource, ['Properties', 'Call']);

  const properties = parseObject(resource.Properties);

  return {
    type: assertString(assertField(resource, 'Type')),
    properties,
    conditionName: ifField(resource, 'Condition', assertString),
    metadata: assertObject(resource.Metadata ?? {}),
    dependencies: new Set([
      ...(ifField(resource, 'DependsOn', assertStringOrList) ?? []),
      ...findReferencedLogicalIds(properties),
    ]),
    dependsOn: new Set([
      ...(ifField(resource, 'DependsOn', assertStringOrList) ?? []),
    ]),
    deletionPolicy:
      ifField(resource, 'DeletionPolicy', parseRetentionPolicy) ?? 'Delete',
    updateReplacePolicy:
      ifField(resource, 'UpdateReplacePolicy', parseRetentionPolicy) ??
      'Delete',
    tags: parseTags(resource.Tags),
    overrides: parseOverrides(resource.Overrides),
    call: parseCall(resource.Call),
  };
}

function findReferencedLogicalIds(
  xs: Record<string, TemplateExpression>,
  into: string[] = []
): string[] {
  Object.values(xs).forEach(recurse);
  return into;

  function recurse(x: TemplateExpression) {
    switch (x.type) {
      case 'array':
        x.array.forEach(recurse);
        break;
      case 'object':
        Object.values(x.fields).forEach(recurse);
        break;
      case 'intrinsic':
        switch (x.fn) {
          case 'ref':
          case 'getAtt':
            into.push(x.logicalId);
            break;
          case 'base64':
            recurse(x.expression);
            break;
          case 'cidr':
            recurse(x.count);
            recurse(x.ipBlock);
            recurse(x.netMask);
            break;
          case 'findInMap':
            recurse(x.key1);
            recurse(x.key2);
            break;
          case 'getAzs':
            recurse(x.region);
            break;
          case 'if':
            recurse(x.then);
            recurse(x.else);
            break;
          case 'importValue':
            recurse(x.export);
            break;
          case 'join':
            x.array.forEach(recurse);
            break;
          case 'select':
            recurse(x.index);
            x.array.forEach(recurse);
            break;
          case 'split':
            recurse(x.value);
            break;
          case 'sub':
            Object.values(x.additionalContext).forEach(recurse);
            break;
          case 'transform':
            Object.values(x.parameters).forEach(recurse);
            break;
          default:
            throw new Error(`Unrecognized intrinsic for evaluation: ${x.fn}`);
        }
        break;
    }
  }
}
