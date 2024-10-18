# Bolt for JavaScript: DynamoDB InstallationStore

[![npm version](https://badge.fury.io/js/@k11i%2Fbolt-dynamodb.svg)](https://badge.fury.io/js/@k11i%2Fbolt-dynamodb)

This package provides a DynamoDB-backed InstallationStore implementation with a few additional functionalities.

## Features

- Encryption using node:crypto module.
- Compression with Brotli.

## Installation

```bash
npm install @k11i/bolt-dynamodb
```

You also need to install `@aws-sdk/client-dynamodb` package to create a DynamoDB client.

## Basic usage

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
    stateVerification: false,
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

## License

MIT License.

Copyright (c) 2024 KOMIYA Atsushi.
