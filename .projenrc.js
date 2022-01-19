const { typescript } = require('projen');

const project = new typescript.TypeScriptProject({
  defaultReleaseBranch: 'main',
  name: 'decdk',
  description: 'Declarative CDK: a CloudFormation-like syntax for defining CDK stacks',
  authorName: 'Amazon Web Services',
  authorUrl: 'https://aws.amazon.com',
  authorOrganization: true,
  prerelease: 'pre',
  deps: [
    'aws-cdk-lib',
    'constructs@^10',
    'fs-extra@^8',
    'jsii-reflect',
    'jsonschema',
    'yaml',
    'yargs',
    'chalk@^4',
  ],
  devDeps: [
    '@types/fs-extra@^8',
    '@types/yaml',
    '@types/yargs',
    'jsii',
  ],
  releaseToNpm: true,
});

project.synth();