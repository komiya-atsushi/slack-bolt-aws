# Bolt for JavaScript: DynamoDB InstallationStore

[![npm version](https://badge.fury.io/js/@k11i%2Fbolt-dynamodb.svg)](https://badge.fury.io/js/@k11i%2Fbolt-dynamodb)

This package provides a DynamoDB-backed InstallationStore implementation with a few additional functionalities.

## Features

- Encryption with AES-256-CTR (the key is derived with scrypt) using the `node:crypto` module.
- Compression with Brotli.
- Optionally keeps the history of installations (`historicalDataEnabled`).

## Requirements

- Node.js 22 or later
- [Bolt for JavaScript](https://github.com/slackapi/bolt-js) (`@slack/bolt`) v3, v4, or v5

`@slack/oauth` and `@slack/logger` are optional peer dependencies of this package, so the versions installed with `@slack/bolt` are shared instead of installing separate copies.

## Installation

```bash
npm install @k11i/bolt-dynamodb

# Your app also needs Bolt for JavaScript and the DynamoDB client of the AWS SDK.
npm install \
  @slack/bolt \
  @aws-sdk/client-dynamodb
```

## Basic usage

The DynamoDB table must have a partition key and a sort key, both of type String.
Their attribute names can be configured with `partitionKeyName` and `sortKeyName`.
See [template.yaml of the example](https://github.com/komiya-atsushi/slack-bolt-aws/blob/main/packages/example-bolt-dynamodb/template.yaml) for a table definition.

```typescript
import {App, ExpressReceiver, LogLevel} from '@slack/bolt';
import serverlessExpress from '@codegenie/serverless-express';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {
  BinaryInstallationCodec,
  DynamoDbInstallationStore,
} from '@k11i/bolt-dynamodb';

function ensureNotUndefined(envName: string): string {
  const result = process.env[envName];
  if (result === undefined) {
    throw new Error(`Environment variable '${envName}' is not defined`);
  }
  return result;
}

const clientId = ensureNotUndefined('SLACK_CLIENT_ID');

// You can compress and encrypt Installation using BinaryInstallationCodec.
const installationCodec = BinaryInstallationCodec.createDefault(
  ensureNotUndefined('INSTALLATION_STORE_ENCRYPTION_PASSWORD'),
  ensureNotUndefined('INSTALLATION_STORE_ENCRYPTION_SALT')
);

const installationStore = DynamoDbInstallationStore.create({
  clientId,
  dynamoDb: new DynamoDBClient(),
  tableName: ensureNotUndefined('DYNAMODB_TABLE_NAME'),
  // Specify the attribute name of the partition key.
  // In the default implementation, the combined string of Slack client ID,
  // enterprise ID, and team ID is used as the DynamoDB partition key.
  partitionKeyName: 'PK',
  // Specify the attribute name of the sort key.
  // In the default implementation, the combined string of Slack user ID
  // and version (UNIX time milliseconds) is used as the DynamoDB sort key.
  sortKeyName: 'SK',
  // Specify the attribute to store the Installation.
  attributeName: 'Installation',
  options: {
    installationCodec,
  },
});

const expressReceiver = new ExpressReceiver({
  logLevel: LogLevel.DEBUG,
  clientId,
  signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
  clientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
  stateSecret: process.env.SLACK_STATE_SECRET ?? '',
  scopes: ['channels:history', 'channels:read', 'chat:write'],
  installationStore,
  installerOptions: {
    directInstall: true,
  },
  processBeforeResponse: true,
});

const app = new App({receiver: expressReceiver});

app.message(async ({message, client}) => {
  if (message.subtype) {
    return;
  }

  await client.chat.postMessage({
    channel: message.channel,
    text: `${message.text}`,
  });
});

// To delete the Installation simultaneously when the Slack app is uninstalled,
// you need to subscribe to the app_uninstalled event and implement its event handler.
// Also, to delete individual user tokens, you need to subscribe to the tokens_revoked event.

export const handler = serverlessExpress({app: expressReceiver.app});
```

A complete example running on AWS Lambda (deployed with AWS SAM) is available in [packages/example-bolt-dynamodb](https://github.com/komiya-atsushi/slack-bolt-aws/tree/main/packages/example-bolt-dynamodb).

## License

MIT License.

Copyright (c) 2024 KOMIYA Atsushi.
