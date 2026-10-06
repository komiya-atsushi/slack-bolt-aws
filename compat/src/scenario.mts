import {randomUUID} from 'node:crypto';
import {
  App,
  ExpressReceiver,
  type Installation,
  type InstallationQuery,
  type InstallationStore,
} from '@slack/bolt';
import {describe, expect, test} from 'vitest';

// The bucket and table are created by localstack/init/ready.d in us-east-1.
export const awsClientConfig = {
  endpoint: 'http://127.0.0.1:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
};

function createInstallation(teamId: string): Installation<'v2', false> {
  return {
    team: {id: teamId, name: 'team-name'},
    enterprise: undefined,
    user: {
      id: 'U0123456789',
      token: 'xoxp-user-token',
      scopes: ['chat:write'],
    },
    bot: {
      id: 'B0123456789',
      userId: 'U9876543210',
      token: 'xoxb-bot-token',
      scopes: ['chat:write'],
    },
    tokenType: 'bot',
    isEnterpriseInstall: false,
    appId: 'A0123456789',
    authVersion: 'v2',
  };
}

export function describeInstallationStore(
  name: string,
  createInstallationStore: (clientId: string) => InstallationStore,
): void {
  describe(name, () => {
    test('works as the installation store of @slack/bolt', async () => {
      const clientId = `compat-${randomUUID()}`;
      const installationStore = createInstallationStore(clientId);

      const receiver = new ExpressReceiver({
        signingSecret: 'signing-secret',
        clientId,
        clientSecret: 'client-secret',
        stateSecret: 'state-secret',
        scopes: ['chat:write'],
        installationStore,
      });
      expect(new App({receiver})).toBeInstanceOf(App);

      const installer = receiver.installer;
      if (installer === undefined) {
        expect.unreachable('ExpressReceiver should have an installer');
      }

      const installation = createInstallation(`T${randomUUID()}`);
      await installationStore.storeInstallation(installation);

      const query: InstallationQuery<false> = {
        teamId: installation.team.id,
        enterpriseId: undefined,
        isEnterpriseInstall: false,
      };

      await expect(
        installer.authorize({...query, userId: installation.user.id}),
      ).resolves.toMatchObject({
        botToken: installation.bot?.token,
        botId: installation.bot?.id,
        botUserId: installation.bot?.userId,
        userToken: installation.user.token,
        teamId: installation.team.id,
      });

      await installationStore.deleteInstallation?.(query);
      await expect(installer.authorize(query)).rejects.toThrow();
    });
  });
}
