import {App, ExpressReceiver, LogLevel} from '@slack/bolt';
import serverlessExpress from '@codegenie/serverless-express';
import {DynamoDB} from '@aws-sdk/client-dynamodb';
import {
  BinaryInstallationCodec,
  DynamoDbInstallationStore,
} from '@k11i/bolt-dynamodb';

const clientId = process.env.SLACK_CLIENT_ID ?? '';

const dynamoDb = new DynamoDB({region: process.env.AWS_REGION});

const installationCodec = BinaryInstallationCodec.createDefault(
  process.env.INSTALLATION_STORE_ENCRYPTION_PASSWORD ?? 'password',
  process.env.INSTALLATION_STORE_ENCRYPTION_SALT ?? 'salt'
);

const installationStore = DynamoDbInstallationStore.create({
  clientId,
  dynamoDb,
  tableName: process.env.DYNAMODB_TABLE_NAME ?? '',
  partitionKeyName: 'PK',
  sortKeyName: 'SK',
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
