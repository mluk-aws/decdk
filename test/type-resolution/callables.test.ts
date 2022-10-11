import * as reflect from 'jsii-reflect';
import { Template } from '../../src/parser/template';
import { TypedTemplate } from '../../src/type-resolution/template';
import {
  matchConstruct,
  matchInitializer,
  matchInstanceMethodCall,
  matchLazyResource,
  matchStringLiteral,
  Testing,
} from '../util';

let typeSystem: reflect.TypeSystem;

beforeAll(async () => {
  typeSystem = await Testing.typeSystem;
});

test('Static Methods are resolved correctly', async () => {
  // GIVEN
  const template = await Template.fromObject({
    Resources: {
      MyLambda: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromAsset': 'examples/lambda-handler',
          },
          runtime: 'PYTHON_3_6',
          handler: 'index.handler',
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  // THEN
  const myLambda = typedTemplate.resource('MyLambda');
  expect(myLambda).toEqual(
    matchConstruct({
      code: expect.objectContaining({
        type: 'staticMethodCall',
        fqn: 'aws-cdk-lib.aws_lambda.Code',
        namespace: 'aws_lambda',
        method: 'fromAsset',
      }),
    })
  );
  expect(template.template).toBeValidTemplate();
});

test('Can provide implementation via static method', async () => {
  // GIVEN
  const template = await Template.fromObject({
    Resources: {
      MyVpc: {
        Type: 'aws-cdk-lib.aws_ec2.Vpc',
        Properties: {
          maxAzs: 2,
        },
      },
      MyFleet: {
        Type: 'aws-cdk-lib.aws_autoscaling.AutoScalingGroup',
        Properties: {
          vpc: { Ref: 'MyVpc' },
          instanceType: {
            'aws-cdk-lib.aws_ec2.InstanceType.of': ['T2', 'XLARGE'],
          },
          machineImage: {
            'aws-cdk-lib.aws_ecs.EcsOptimizedImage.amazonLinux2': [],
          },
          desiredCapacity: 3,
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  // THEN
  const myAsg = typedTemplate.resource('MyFleet');
  expect(myAsg).toEqual(
    matchConstruct({
      machineImage: expect.objectContaining({
        type: 'staticMethodCall',
        fqn: 'aws-cdk-lib.aws_ecs.EcsOptimizedImage',
        namespace: 'aws_ecs',
        method: 'amazonLinux2',
      }),
    })
  );
  expect(template.template).toBeValidTemplate();
});

test('Can provide implementation if expected type is a class', async () => {
  // GIVEN
  const template = await Template.fromObject({
    Resources: {
      LibraryApi: {
        Type: 'aws-cdk-lib.aws_apigateway.RestApi',
      },
      BooksResource: {
        Type: 'aws-cdk-lib.aws_apigateway.Resource',
        Properties: {
          parent: {
            'CDK::GetProp': 'LibraryApi.root',
          },
          pathPart: 'books',
        },
      },
      GetBooks: {
        Type: 'aws-cdk-lib.aws_apigateway.Method',
        On: 'BooksResource',
        Call: {
          addMethod: [
            'GET',
            {
              'aws-cdk-lib.aws_apigateway.HttpIntegration': [
                'https://amazon.com/{proxy}',
                {
                  proxy: true,
                  httpMethod: 'GET',
                  options: {
                    requestParameters: {
                      'integration.request.path.proxy':
                        'method.request.path.proxy',
                    },
                  },
                },
              ],
            },
            {
              requestParameters: {
                'method.request.path.proxy': true,
              },
            },
          ],
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  // THEN
  const books = typedTemplate.resource('GetBooks');
  expect(books).toEqual(
    matchLazyResource(
      matchInstanceMethodCall('BooksResource', [
        matchStringLiteral('GET'),
        matchInitializer('aws-cdk-lib.aws_apigateway.HttpIntegration'),
      ])
    )
  );
  expect(template.template).toBeValidTemplate();
});

test('Can only provide compatible inline implementations', async () => {
  // GIVEN
  const template = await Template.fromObject({
    Resources: {
      LibraryApi: {
        Type: 'aws-cdk-lib.aws_apigateway.RestApi',
      },
      BooksResource: {
        Type: 'aws-cdk-lib.aws_apigateway.Resource',
        Properties: {
          parent: {
            'CDK::GetProp': 'LibraryApi.root',
          },
          pathPart: 'books',
        },
      },
      GetBooks: {
        Type: 'aws-cdk-lib.aws_apigateway.Method',
        On: 'BooksResource',
        Call: {
          addMethod: [
            'GET',
            {
              'aws-cdk-lib.aws_apigateway.ProxyResource': {
                'CDK::Args': [
                  { Ref: 'CDK::Scope' },
                  'test',
                  {
                    parent: { 'CDK::GetProp': 'LibraryApi.root' },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  });

  // THEN
  expect(() => new TypedTemplate(template, { typeSystem })).toThrow(
    "Expected exactly one of the fields 'aws-cdk-lib.aws_apigateway.AwsIntegration',"
  );
});

test('Resources can be created by calling instance methods on constructs', async () => {
  // GIVEN
  const template = await Template.fromObject({
    Resources: {
      Alias: {
        Type: 'aws-cdk-lib.aws_lambda.Alias',
        On: 'MyFunction',
        Call: {
          addAlias: 'live',
        },
      },
      MyFunction: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          handler: 'index.handler',
          runtime: 'NODEJS_14_X',
          code: {
            Ref: 'BusinessLogic',
          },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  const alias = typedTemplate.resource('Alias');
  expect(alias).toEqual({
    type: 'lazyResource',
    logicalId: 'Alias',
    namespace: 'aws_lambda',
    tags: [],
    dependsOn: [],
    overrides: [],
    call: {
      type: 'instanceMethodCall',
      logicalId: 'MyFunction',
      method: 'addAlias',
      args: {
        type: 'array',
        array: [
          {
            type: 'string',
            value: 'live',
          },
          {
            type: 'void',
          },
        ],
      },
    },
  });
});

test("Resources must not have a 'Properties' property if a 'Call' property exists", async () => {
  // GIVEN
  expect(() =>
    Template.fromObject({
      Resources: {
        BusinessLogic: {
          Type: 'aws-cdk-lib.aws_lambda.Code',
          Call: {
            'aws-cdk-lib.aws_lambda.Code.fromBucket': {
              bucket: {
                Ref: 'SourceBucket',
              },
              key: 'foo-bar',
            },
          },
          Properties: {
            // should not be here
            foo: 'bar',
          },
        },
      },
    })
  ).toThrow("Expected at most one of the fields 'Properties', 'Call'");
});

test("Resources must have a 'Call' property if a 'On' property exists", async () => {
  // GIVEN
  expect(() =>
    Template.fromObject({
      Resources: {
        Alias: {
          Type: 'aws-cdk-lib.aws_lambda.Alias',
          On: 'MyFunction',
          // no 'Call'
        },
      },
    })
  ).toThrow(
    "In resource 'Alias': expected to find a 'Call' property, to a method of 'MyFunction'."
  );
});

test('Calls to raw CloudFormation resources are not allowed', async () => {
  // GIVEN
  const template = Template.fromObject({
    Resources: {
      MyLogGroup: {
        Type: 'AWS::Logs::LogGroup', // raw CFN resource
        Properties: {
          LogGroupName: { Ref: 'AWS::AccountId' },
        },
      },
      Alias: {
        Type: 'aws-cdk-lib.aws_lambda.Alias',
        On: 'MyLogGroup',
        Call: { foo: 'bar' },
      },
    },
  });

  expect(() => new TypedTemplate(template, { typeSystem })).toThrow(
    'AWS::Logs::LogGroup is a CloudFormation resource. Method calls are not allowed.'
  );
});

test('Calls to methods that do not exist are not allowed', async () => {
  // GIVEN
  const template = Template.fromObject({
    Resources: {
      MyLambda: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromAsset': 'examples/lambda-handler',
          },
          runtime: 'PYTHON_3_6',
          handler: 'index.handler',
        },
      },
      Alias: {
        Type: 'aws-cdk-lib.aws_lambda.Alias',
        On: 'MyLambda',
        Call: { foo: 'bar' }, // wrong method
      },
    },
  });

  expect(() => new TypedTemplate(template, { typeSystem })).toThrow(
    "'aws-cdk-lib.aws_lambda.Function' has no method called 'foo'"
  );
});

test('Declared type must match returned type', async () => {
  // GIVEN
  const template = Template.fromObject({
    Resources: {
      MyLambda: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromAsset': 'examples/lambda-handler',
          },
          runtime: 'PYTHON_3_6',
          handler: 'index.handler',
        },
      },
      Alias: {
        Type: 'aws-cdk-lib.aws_apigateway.RestApi', // wrong type
        On: 'MyLambda',
        Call: {
          addAlias: 'live',
        },
      },
    },
  });

  expect(() => new TypedTemplate(template, { typeSystem })).toThrow(
    'Expected class aws-cdk-lib.aws_lambda.Alias to implement class aws-cdk-lib.aws_apigateway.RestApi'
  );
});

test('Resources created by properties should have a declared type', () => {
  expect(() =>
    Template.fromObject({
      Resources: {
        Bucket: {
          Properties: {
            bucketName: 'website',
          },
        },
      },
    })
  ).toThrow("In resource 'Bucket': missing 'Type' property.");
});

test('Resources created by method calls can have the type omitted', () => {
  const template = Template.fromObject({
    Resources: {
      MyLambda: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromAsset': 'examples/lambda-handler',
          },
          runtime: 'PYTHON_3_6',
          handler: 'index.handler',
        },
      },
      ConfigureAsyncInvokeStatement: {
        On: 'MyLambda',
        Call: {
          configureAsyncInvoke: {
            retryAttempts: 2,
          },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  expect(typedTemplate.resource('ConfigureAsyncInvokeStatement')).toEqual({
    type: 'lazyResource',
    logicalId: 'ConfigureAsyncInvokeStatement',
    namespace: undefined,
    tags: [],
    dependsOn: [],
    overrides: [],
    call: {
      type: 'instanceMethodCall',
      logicalId: 'MyLambda',
      method: 'configureAsyncInvoke',
      args: {
        type: 'array',
        array: [
          {
            fields: { retryAttempts: { type: 'number', value: 2 } },
            type: 'struct',
          },
        ],
      },
    },
  });
});

test('Types can be inferred transitively', () => {
  const template = Template.fromObject({
    Resources: {
      MyFunction: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          handler: 'index.handler',
          runtime: 'NODEJS_14_X',
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromInline':
              "exports.handler = async function() { return 'SUCCESS'; }",
          },
        },
      },
      Alias: {
        On: 'MyFunction',
        Call: {
          addAlias: 'live',
        },
      },
      ConfigureAsyncInvokeStatement: {
        On: 'Alias',
        Call: {
          configureAsyncInvoke: {
            retryAttempts: 2,
          },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  expect(typedTemplate.resource('ConfigureAsyncInvokeStatement')).toEqual({
    type: 'lazyResource',
    logicalId: 'ConfigureAsyncInvokeStatement',
    namespace: undefined,
    tags: [],
    dependsOn: [],
    overrides: [],
    call: {
      type: 'instanceMethodCall',
      logicalId: 'Alias',
      method: 'configureAsyncInvoke',
      args: {
        type: 'array',
        array: [
          {
            fields: { retryAttempts: { type: 'number', value: 2 } },
            type: 'struct',
          },
        ],
      },
    },
  });
});

test('Resources can be created by calling instance methods on nested construct', () => {
  const template = Template.fromObject({
    Resources: {
      Function: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          handler: 'index.handler',
          runtime: 'NODEJS_14_X',
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromInline':
              "exports.handler = async function() { return 'SUCCESS'; }",
          },
        },
      },
      User: {
        Type: 'aws-cdk-lib.aws_iam.User',
      },
      Grant: {
        On: 'Function',
        Call: {
          'logGroup.grantWrite': { Ref: 'User' },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  expect(typedTemplate.resource('Grant')).toEqual({
    type: 'lazyResource',
    logicalId: 'Grant',
    namespace: undefined,
    tags: [],
    dependsOn: [],
    overrides: [],
    call: {
      type: 'instanceMethodCall',
      logicalId: 'Function',
      method: 'logGroup.grantWrite',
      args: {
        type: 'array',
        array: [
          {
            reference: {
              fn: 'ref',
              logicalId: 'User',
              type: 'intrinsic',
            },
            type: 'resolve-reference',
          },
        ],
      },
    },
  });
});

test('Nested construct paths must be valid', () => {
  const template = Template.fromObject({
    Resources: {
      Function: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          handler: 'index.handler',
          runtime: 'NODEJS_14_X',
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromInline':
              "exports.handler = async function() { return 'SUCCESS'; }",
          },
        },
      },
      User: {
        Type: 'aws-cdk-lib.aws_iam.User',
      },
      Grant: {
        On: 'Function',
        Call: {
          'foo.grantWrite': { Ref: 'User' },
        },
      },
    },
  });

  expect(() => new TypedTemplate(template, { typeSystem })).toThrow(
    `Invalid construct path 'foo'`
  );
});

test('Single arguments are interpreted as the first argument of a call', async () => {
  const template = await Template.fromObject({
    Resources: {
      Alias: {
        Type: 'aws-cdk-lib.aws_lambda.Alias',
        On: 'MyFunction',
        Call: {
          addAlias: 'live',
        },
      },
      MyFunction: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          handler: 'index.handler',
          runtime: 'NODEJS_14_X',
          code: {
            Ref: 'BusinessLogic',
          },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  const alias = typedTemplate.resource('Alias');
  expect(alias).toEqual(
    expect.objectContaining({
      call: {
        type: 'instanceMethodCall',
        logicalId: 'MyFunction',
        method: 'addAlias',
        args: {
          type: 'array',
          array: [
            {
              type: 'string',
              value: 'live',
            },
            {
              type: 'void',
            },
          ],
        },
      },
    })
  );
});

test('Scope and id are automatically added when not provided in static method call', async () => {
  const template = await Testing.template(
    Template.fromObject({
      Resources: {
        Key: {
          Call: {
            'aws-cdk-lib.aws_kms.Key.fromKeyArn':
              'arn:aws:kms:us-east-1:111111111111:key/93726116-3886-4976-885d-035f6c630059',
          },
        },
        Bucket: {
          Type: 'aws-cdk-lib.aws_s3.Bucket',
          Properties: {
            encryptionKey: {
              Ref: 'Key',
            },
          },
        },
      },
    })
  );

  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            KMSMasterKeyID:
              'arn:aws:kms:us-east-1:111111111111:key/93726116-3886-4976-885d-035f6c630059',
            SSEAlgorithm: 'aws:kms',
          },
        },
      ],
    },
  });
});

test('Scope and id are unwrapped when passed through CDK::Args', async () => {
  const template = await Template.fromObject({
    Resources: {
      Key: {
        Call: {
          'aws-cdk-lib.aws_kms.Key.fromKeyArn': {
            'CDK::Args': [{ Ref: 'CDK::Scope' }, 'Key', 'some-key'],
          },
        },
      },
      Bucket: {
        Type: 'aws-cdk-lib.aws_s3.Bucket',
        Properties: {
          encryptionKey: {
            Ref: 'Key',
          },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  expect(typedTemplate.resource('Key')).toEqual(
    expect.objectContaining({
      call: {
        args: {
          array: [
            {
              reference: {
                fn: 'ref',
                logicalId: 'CDK::Scope',
                type: 'intrinsic',
              },
              type: 'resolve-reference',
            },
            {
              type: 'string',
              value: 'Key',
            },
            {
              type: 'string',
              value: 'some-key',
            },
          ],
          type: 'array',
        },
        fqn: 'aws-cdk-lib.aws_kms.Key',
        method: 'fromKeyArn',
        namespace: 'aws_kms',
        type: 'staticMethodCall',
      },
    })
  );
});

test('Calls to fromXxx methods cannot be inlined', async () => {
  await expect(
    Testing.template(
      Template.fromObject({
        Resources: {
          Bucket: {
            Type: 'aws-cdk-lib.aws_s3.Bucket',
            Properties: {
              encryptionKey: {
                'aws-cdk-lib.aws_kms.Key.fromKeyArn': 'some-key',
              },
            },
          },
        },
      }),
      false
    )
  ).rejects.toThrow(/failed because the id could not be inferred/);
});

test('Calls to fromXxx() wrapped in CDK::Args work for property values', async () => {
  const template = await Template.fromObject({
    Resources: {
      Bucket: {
        Type: 'aws-cdk-lib.aws_s3.Bucket',
        Properties: {
          encryptionKey: {
            'aws-cdk-lib.aws_kms.Key.fromKeyArn': {
              'CDK::Args': [{ Ref: 'CDK::Scope' }, 'Key', 'some-key'],
            },
          },
        },
      },
    },
  });

  const typedTemplate = new TypedTemplate(template, { typeSystem });

  expect(typedTemplate.resource('Bucket')).toEqual(
    matchConstruct({
      encryptionKey: {
        args: {
          array: [
            {
              reference: {
                fn: 'ref',
                logicalId: 'CDK::Scope',
                type: 'intrinsic',
              },
              type: 'resolve-reference',
            },
            {
              type: 'string',
              value: 'Key',
            },
            {
              type: 'string',
              value: 'some-key',
            },
          ],
          type: 'array',
        },
        fqn: 'aws-cdk-lib.aws_kms.Key',
        method: 'fromKeyArn',
        namespace: 'aws_kms',
        type: 'staticMethodCall',
      },
    })
  );
});
