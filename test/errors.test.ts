import { schema } from '../src/parser/schema';
import { Template } from '../src/parser/template';
import { Testing } from './util';

test('invalid enum option raises an error', async () => {
  // GIVEN
  const template = {
    Resources: {
      Hello: {
        Type: 'aws-cdk-lib.aws_sqs.Queue',
        Properties: {
          encryption: 'boom',
        },
      },
    },
  };

  // THEN
  expect(template).not.toBeValidTemplate();
  await expect(
    Testing.synth(await Template.fromObject(template), false)
  ).rejects.toThrow(
    'Expected choice for enum type aws-cdk-lib.aws_sqs.QueueEncryption to be one of UNENCRYPTED|KMS_MANAGED|KMS, got: boom'
  );
});

test('invalid tags raises an error', async () => {
  // GIVEN
  const template = {
    Resources: {
      Hello: {
        Type: 'aws-cdk-lib.aws_sqs.Queue',
        Properties: {
          encryption: 'KMS_MANAGED',
        },
        Tags: [{}],
      },
    },
  };

  // THEN
  expect(template).not.toBeValidTemplate();
  await expect(async () => Template.fromObject(template)).rejects.toThrow(
    'Expected list of form {Key: string, Value: string}'
  );
});

describe('overrides', () => {
  test('RemoveResource requires ChildConstructPath', async () => {
    // GIVEN
    const template: schema.Template = {
      Resources: {
        Hello: {
          Type: 'aws-cdk-lib.aws_sqs.Queue',
          Properties: {
            encryption: 'KMS_MANAGED',
          },
          Overrides: [
            {
              RemoveResource: true,
            },
          ],
        },
      },
    };

    // THEN
    expect(template).not.toBeValidTemplate();
    await expect(async () => Template.fromObject(template)).rejects.toThrow(
      "Expected field named 'ChildConstructPath'"
    );
  });

  test("can only have one of 'RemoveResource', 'Update' or 'Delete'", async () => {
    // GIVEN
    const template = {
      Resources: {
        Hello: {
          Type: 'aws-cdk-lib.aws_sqs.Queue',
          Properties: {
            encryption: 'boom',
          },
          Overrides: [
            {
              Update: { Path: 'encryption', Value: 'KMS' },
              Delete: { Path: 'encryption' },
            },
          ],
        },
      },
    };

    // THEN
    expect(template).not.toBeValidTemplate();
    await expect(async () => Template.fromObject(template)).rejects.toThrow(
      'Expected exactly one of the fields'
    );
  });
});
