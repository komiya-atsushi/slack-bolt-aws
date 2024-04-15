import {App, ExpressReceiver, LogLevel} from '@slack/bolt';
import serverlessExpress from '@codegenie/serverless-express';
import {S3} from '@aws-sdk/client-s3';
import {BinaryInstallationCodec, S3InstallationStore} from '@k11i/bolt-s3';

function ensureNotUndefined(envName: string): string {
  const result = process.env[envName];
  if (result === undefined) {
    throw new Error(`Environment variable '${envName}' is not defined`);
  }
  return result;
}

const clientId = ensureNotUndefined('SLACK_CLIENT_ID');

const s3Client = new S3({region: process.env.S3_REGION});

const installationCodec = BinaryInstallationCodec.createDefault(
  ensureNotUndefined('S3_INSTALLATION_STORE_ENCRYPTION_PASSWORD'),
  ensureNotUndefined('S3_INSTALLATION_STORE_ENCRYPTION_SALT')
);

const installationStore = S3InstallationStore.create({
  clientId,
  s3: s3Client,
  bucketName: ensureNotUndefined('S3_BUCKET_NAME'),
  options: {
    historicalDataEnabled: true,
    installationCodec,
  },
});

const expressReceiver = new ExpressReceiver({
  logLevel: LogLevel.DEBUG,
  clientId,
  signingSecret: ensureNotUndefined('SLACK_SIGNING_SECRET'),
  clientSecret: ensureNotUndefined('SLACK_CLIENT_SECRET'),
  stateSecret: ensureNotUndefined('SLACK_STATE_SECRET'),
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

export const handler = serverlessExpress({app: expressReceiver.app});
