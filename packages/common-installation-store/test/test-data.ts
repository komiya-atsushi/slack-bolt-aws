import {Installation} from '@slack/oauth/';

export const installation: Installation<'v2', false> = {
  team: {
    id: 'T01234567',
    name: 'team-name',
  },
  user: {
    token:
      'xoxp-1234567890-1234567890123-1234567890123-1234567890abcdef1234567890abcdef',
    scopes: ['channels:read', 'chat:write'],
    id: 'U0123456789',
  },
  tokenType: 'bot',
  isEnterpriseInstall: false,
  enterprise: undefined,
  appId: 'A0123456789',
  authVersion: 'v2',
  bot: {
    scopes: ['channels:history', 'channels:read', 'chat:write'],
    token: 'xoxb-1234567890-1234567890123-1234567890ABCDEFGHIJKLMN',
    userId: 'U0123456789',
    id: 'B0123456789',
  },
};
