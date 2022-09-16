import { Match } from 'aws-cdk-lib/assertions';
import { Template } from '../../src/parser/template';
import { Testing } from '../util';

test('FnBase64', async () => {
  // GIVEN
  const template = await Testing.template(
    await Template.fromObject({
      Resources: {
        Bucket: {
          Type: 'aws-cdk-lib.aws_s3.Bucket',
        },
        Topic: {
          Type: 'aws-cdk-lib.aws_sns.Topic',
          Properties: {
            displayName: { 'Fn::Base64': 'Test' },
            topicName: { 'Fn::Base64': { Ref: 'Bucket' } },
          },
        },
      },
    })
  );

  // THEN
  template.hasResourceProperties('AWS::SNS::Topic', {
    DisplayName: { 'Fn::Base64': 'Test' },
    TopicName: {
      'Fn::Base64': { Ref: Match.stringLikeRegexp('^Bucket.{8}$') },
    },
  });
});

test('FnCidr', async () => {
  // GIVEN
  const template = await Testing.template(
    await Template.fromObject({
      Resources: {
        VPC: {
          Type: 'AWS::EC2::VPC',
        },
        Subnet: {
          Type: 'aws-cdk-lib.aws_ec2.Subnet',
          Properties: {
            vpcId: { Ref: 'VPC' },
            availabilityZone: 'us-east-1a',
            cidrBlock: {
              'Fn::Select': [
                0,
                {
                  'Fn::Cidr': [{ 'Fn::GetAtt': ['VPC', 'CidrBlock'] }, 1, 8],
                },
              ],
            },
          },
        },
      },
    })
  );

  // THEN
  template.hasResourceProperties('AWS::EC2::Subnet', {
    CidrBlock: {
      'Fn::Select': [
        0,
        {
          'Fn::Cidr': [{ 'Fn::GetAtt': ['VPC', 'CidrBlock'] }, 1, 8],
        },
      ],
    },
  });
});

test.each(['', 'us-east-1', { Ref: 'AWS::Region' }])(
  'FnGetAZs with: %j',
  async (azsValue) => {
    // GIVEN
    const template = await Testing.template(
      await Template.fromObject({
        Resources: {
          VPC: {
            Type: 'aws-cdk-lib.aws_ec2.Vpc',
          },
          Subnet: {
            Type: 'aws-cdk-lib.aws_ec2.Subnet',
            Properties: {
              vpcId: { Ref: 'VPC' },
              cidrBlock: '10.0.0.0/24',
              availabilityZone: {
                'Fn::Select': ['0', { 'Fn::GetAZs': azsValue }],
              },
            },
          },
        },
      })
    );

    // THEN
    template.hasResourceProperties('AWS::EC2::Subnet', {
      AvailabilityZone: {
        'Fn::Select': ['0', { 'Fn::GetAZs': azsValue }],
      },
    });
  }
);

test('FnImportValue', async () => {
  // GIVEN
  const template = await Testing.template(
    await Template.fromObject({
      Resources: {
        Topic: {
          Type: 'aws-cdk-lib.aws_sns.Topic',
          Properties: {
            displayName: {
              'Fn::ImportValue': {
                'Fn::Base64': { Ref: 'AWS::StackName' },
              },
            },
          },
        },
      },
    })
  );

  // THEN
  template.hasResourceProperties('AWS::SNS::Topic', {
    DisplayName: {
      'Fn::ImportValue': {
        'Fn::Base64': { Ref: 'AWS::StackName' },
      },
    },
  });
});
