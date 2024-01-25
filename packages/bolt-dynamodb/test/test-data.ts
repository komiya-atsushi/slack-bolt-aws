import {Installation} from '@slack/oauth/';

export type TestInstallation = Installation<'v2', false>;

const teamAInstallation: Omit<TestInstallation, 'user'> = {
  team: {
    id: 'team-a-id',
    name: 'Team A',
  },
  tokenType: 'bot',
  isEnterpriseInstall: false,
  enterprise: undefined,
  appId: 'app-id',
  authVersion: 'v2',
  bot: {
    scopes: ['channels:history', 'channels:read', 'chat:write'],
    token: 'xoxb-team-a-bot-token',
    userId: '',
    id: 'bot-id',
  },
};

const teamBInstallation: Omit<TestInstallation, 'user'> = {
  team: {
    id: 'team-b-id',
    name: 'Team B',
  },
  tokenType: 'bot',
  isEnterpriseInstall: false,
  enterprise: undefined,
  appId: 'app-id',
  authVersion: 'v2',
  bot: {
    scopes: ['channels:history', 'channels:read', 'chat:write'],
    token: 'xoxb-team-b-bot-token',
    userId: 'bot-user-id',
    id: 'bot-id',
  },
};

export function generateTestData(): {
  installation: {
    teamA: {
      userA1: TestInstallation;
      userA2: TestInstallation;
    };
    teamB: {
      userB3: TestInstallation;
    };
  };
} {
  return {
    installation: {
      teamA: {
        userA1: {
          ...teamAInstallation,
          user: {
            token: 'team-a-user-1-token',
            scopes: ['channels:read', 'chat:write'],
            id: 'team-a-user-1-id',
          },
        },
        userA2: {
          ...teamAInstallation,
          user: {
            token: 'team-a-user-2-token',
            scopes: ['channels:read', 'chat:write'],
            id: 'team-a-user-2-id',
          },
        },
      },
      teamB: {
        userB3: {
          ...teamBInstallation,
          user: {
            token: 'team-b-user-3-token',
            scopes: ['channels:read', 'chat:write'],
            id: 'team-b-user-3-id',
          },
        },
      },
    },
  };
}
