import { Match } from 'aws-cdk-lib/assertions';
import { Template } from '../../src/parser/template';
import { Testing } from '../util';

test('can references L2 construct from L1 resource', async () => {
  // GIVEN
  const template = await Testing.template(
    Template.fromObject({
      Resources: {
        MyBucket: {
          Type: 'aws-cdk-lib.aws_s3.Bucket',
        },
        MyFunction: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Runtime: 'nodejs16.x',
            Handler: 'index.handler',
            Code: {
              ZipFile:
                'exports.handler = function(event) { console.log("hello world!"); }',
            },
            Description: { Ref: 'MyBucket' },
          },
        },
      },
    })
  );

  // THEN
  template.hasResourceProperties('AWS::Lambda::Function', {
    Description: {
      Ref: Match.stringLikeRegexp('^MyBucket.{8}$'),
    },
  });
});

test('can use FnRef where it is expected to be evaluated to FnRef (not an object)', async () => {
  // GIVEN
  const source = {
    Resources: {
      MyBucket: {
        Type: 'aws-cdk-lib.aws_s3.Bucket',
      },
      TestRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          assumedBy: {
            'aws-cdk-lib.aws_iam.AccountPrincipal': { Ref: 'AWS::AccountId' },
          },
          inlinePolicies: {
            bucketAccess: {
              'aws-cdk-lib.aws_iam.PolicyStatement.fromJson': {
                obj: {
                  Effect: 'Allow',
                  Action: ['s3:GetObject*', 's3:PutObject*'],
                  Resource: [
                    { 'CDK::GetProp': 'MyBucket.bucketArn' },
                    { Ref: 'MyBucket' },
                    {
                      'Fn::Join': [
                        '',
                        [{ 'Fn::GetAtt': 'MyBucket.Arn' }, '/*'],
                      ],
                    },
                    {
                      'Fn::Join': ['', [{ Ref: 'MyBucket' }, '/*']],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  };
  const template = await Testing.template(Template.fromObject(source));

  // THEN
  expect(template).toMatchSnapshot();
});

test('can use FnRef as string property', async () => {
  // GIVEN
  const source = {
    Resources: {
      CfnBucket: {
        Type: 'AWS::S3::Bucket',
      },
      CdkBucket: {
        Type: 'aws-cdk-lib.aws_s3.Bucket',
      },
      Topic: {
        Type: 'aws-cdk-lib.aws_sns.Topic',
        Properties: {
          displayName: { Ref: 'CfnBucket' },
          topicName: { Ref: 'CdkBucket' },
        },
      },
    },
  };
  const template = await Testing.template(Template.fromObject(source));

  // THEN
  template.hasResourceProperties('AWS::SNS::Topic', {
    DisplayName: { Ref: 'CfnBucket' },
    TopicName: { Ref: Match.stringLikeRegexp('^CdkBucket.{8}$') },
  });
});

test('can use FnRef on result of Member Method Call', async () => {
  // GIVEN
  const source = {
    Resources: {
      MyLambda: {
        Type: 'aws-cdk-lib.aws_lambda.Function',
        Properties: {
          handler: 'app.hello_handler',
          runtime: 'PYTHON_3_9',
          code: {
            'aws-cdk-lib.aws_lambda.Code.fromAsset': {
              path: 'examples/lambda-handler',
            },
          },
        },
      },
      Alias: {
        Type: 'aws-cdk-lib.aws_lambda.Alias',
        On: 'MyLambda',
        Call: {
          addAlias: {
            aliasName: 'live',
          },
        },
      },
      Topic: {
        Type: 'aws-cdk-lib.aws_sns.Topic',
        Properties: {
          displayName: { Ref: 'Alias' },
          topicName: { 'CDK::GetProp': 'Alias.aliasName' },
        },
      },
    },
  };
  const template = await Testing.template(Template.fromObject(source));

  // THEN
  template.hasResourceProperties('AWS::SNS::Topic', {
    DisplayName: {
      Ref: Match.stringLikeRegexp('^MyLambdaAliaslive.{8}$'),
    },
    TopicName: 'live',
  });
});
