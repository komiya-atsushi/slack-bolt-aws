# Bolt for JavaScript: S3 InstallationStore

[![npm version](https://badge.fury.io/js/@k11i%2Fbolt-s3.svg)](https://badge.fury.io/js/@k11i%2Fbolt-s3)
[![codecov](https://codecov.io/gh/komiya-atsushi/slack-bolt-s3/graph/badge.svg?token=TXWAYL4LMZ)](https://codecov.io/gh/komiya-atsushi/slack-bolt-s3)

This package provides an S3-backed InstallationStore implementation with a few additional functionalities.

## Features

- Encryption using node:crypto module.
- Compression with Brotli.

## Installation

```bash
npm install @k11i/bolt-s3
```

You also need to install `@aws-sdk/client-s3` package to create an S3 client.

## Basic usage

```typescript
import {App} from '@slack/bolt';
import {S3} from '@aws-sdk/client-s3';
import {S3InstallationStore} from '@k11i/bolt-s3';

const s3 = new S3({ region: 'us-east-2' });

const installationStore = new S3InstallationStore(
  s3,
  // An S3 bucket needs to be created.
  'bucket-name-where-installations-are-stored',
  process.env.SLACK_CLIENT_ID,
  {
    historicalDataEnabled: true,
    // Omit the following line if you prefer not to encrypt and/or compress installations.
    installationCodec: BinaryInstallationCodec.createDefault(
      'your-encryption-password',
      'your-encryption-salt',
    ),
  }
);

const app = new App({
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: ['chat:write'],
  installerOptions: {
    directInstall: true,
  },
  installationStore,
});

// ...

// To delete installations correctly, we should handle tokens_revoked/app_uninstalled events manually.
// See https://github.com/slackapi/bolt-js/issues/1203
app.event('tokens_revoked', async ({context, event, logger}) => {
  const userIds = event.tokens.oauth;
  if (!userIds) {
    return;
  }

  const promises = userIds
    .map(userId => ({
      teamId: context.teamId,
      enterpriseId: context.enterpriseId,
      userId: userId,
      isEnterpriseInstall: context.isEnterpriseInstall,
    }))
    .map(query => installationStore.deleteInstallation(query, logger));

  await Promise.all(promises);
});

app.event('app_uninstalled', async ({context, logger}) => {
  await installationStore.deleteInstallation(
    {
      teamId: context.teamId,
      enterpriseId: context.enterpriseId,
      isEnterpriseInstall: context.isEnterpriseInstall,
    },
    logger
  );
});

(async () => {
  await app.start();
  console.log('⚡️ Bolt app is running!');
})();
```

## License

MIT License.

Copyright (c) 2024 KOMIYA Atsushi.
