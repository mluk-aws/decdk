import * as reflect from 'jsii-reflect';
import * as jsonschema from 'jsonschema';
import { Schema } from 'jsonschema';
import { renderFullSchema } from '../../src/cdk-schema';
import { Testing } from '../util';

let typeSystem: reflect.TypeSystem;
let schema: Schema;
beforeAll(async () => {
  typeSystem = await Testing.typeSystem;
  schema = renderFullSchema(typeSystem);
});

test('invalid schema will fail', () => {
  // GIVEN
  const template = {
    $schema: '../cdk.schema.json',
    Resources: {
      VPC: {
        Type: 'aws-cdk-lib.aws_ec2.Vpc',
        Properties: {
          banana: true,
        },
      },
    },
  };

  // THEN
  const result = jsonschema.validate(template, schema);
  expect(result.valid).toBe(false);
});
