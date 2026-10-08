# Bolt for JavaScript: S3 InstallationStore

[![npm version](https://badge.fury.io/js/@k11i%2Fbolt-s3.svg)](https://badge.fury.io/js/@k11i%2Fbolt-s3)

This package provides an S3-backed InstallationStore implementation with a few additional functionalities.

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
npm install @k11i/bolt-s3

# Your app also needs Bolt for JavaScript and the S3 client of the AWS SDK.
npm install \
  @slack/bolt \
  @aws-sdk/client-s3
```

## Basic usage

```typescript
import {App, ExpressReceiver, LogLevel} from '@slack/bolt';
import serverlessExpress from '@codegenie/serverless-express';
import {S3Client} from '@aws-sdk/client-s3';
import {BinaryInstallationCodec, S3InstallationStore} from '@k11i/bolt-s3';

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
  ensureNotUndefined('S3_INSTALLATION_STORE_ENCRYPTION_PASSWORD'),
  ensureNotUndefined('S3_INSTALLATION_STORE_ENCRYPTION_SALT')
);

const installationStore = S3InstallationStore.create({
  clientId,
  s3: new S3Client(),
  bucketName: ensureNotUndefined('S3_BUCKET_NAME'),
  options: {
    // Keep the history of installations in addition to the latest ones.
    historicalDataEnabled: true,
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

A complete example running on AWS Lambda (deployed with AWS SAM) is available in [packages/example-bolt-s3](https://github.com/komiya-atsushi/slack-bolt-aws/tree/main/packages/example-bolt-s3).

## License

MIT License.

Copyright (c) 2024 KOMIYA Atsushi.
