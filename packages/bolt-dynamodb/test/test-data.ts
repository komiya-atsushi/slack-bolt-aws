import {Installation} from '@slack/oauth/';

export type TestInstallation = Installation<'v2', false>;
export type OrgTestInstallation = Installation<'v2', true>;

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

export function generateEnterpriseTestData(): {
  installation: {
    // Organization-wide installation
    orgX: {
      teamA: {
        userX1: OrgTestInstallation;
        userX2: OrgTestInstallation;
      };
      teamB: {
        userX1: OrgTestInstallation;
      };
    };
    // Single-workspace installation
    orgY: {
      teamC: {
        userY1: TestInstallation;
      };
      teamD: {
        userY1: TestInstallation;
        userY2: TestInstallation;
      };
    };
  };
} {
  const orgXInstallation: Omit<OrgTestInstallation, 'user'> = {
    enterprise: {
      id: 'enterprise-org-x-id',
      name: 'Org. X',
    },
    isEnterpriseInstall: true,
    enterpriseUrl: 'https://org-x.enterprise.exmaple.com/',

    team: undefined,

    tokenType: 'bot',
    appId: 'app-id',
    authVersion: 'v2',
    bot: {
      scopes: ['channels:history', 'channels:read', 'chat:write'],
      token: 'xoxb-org-x-bot-token',
      userId: 'bot-user-id',
      id: 'bot-id',
    },
  };

  const orgYInstallation: Omit<TestInstallation, 'user' | 'team' | 'bot'> = {
    enterprise: {
      id: 'enterprise-org-y-id',
      name: 'Org. Y',
    },
    isEnterpriseInstall: false,

    tokenType: 'bot',
    appId: 'app-id',
    authVersion: 'v2',
  };

  const teamCInstallation: Omit<TestInstallation, 'user'> = {
    ...orgYInstallation,

    team: {id: 'org-y-team-c-id', name: 'Team C'},

    bot: {
      scopes: ['channels:history', 'channels:read', 'chat:write'],
      token: 'xoxb-team-c-bot-token',
      userId: 'bot-user-id',
      id: 'bot-id',
    },
  };

  const teamDInstallation: Omit<TestInstallation, 'user'> = {
    ...orgYInstallation,

    team: {id: 'org-y-team-d-id', name: 'Team D'},

    bot: {
      scopes: ['channels:history', 'channels:read', 'chat:write'],
      token: 'xoxb-team-d-bot-token',
      userId: 'bot-user-id',
      id: 'bot-id',
    },
  };

  const userX1: Pick<OrgTestInstallation, 'user'> = {
    user: {
      token: 'xoxp-org-x-user-x1-token',
      scopes: ['channels:read', 'chat:write'],
      id: 'org-x-user-x1-id',
    },
  };

  const userX2: Pick<OrgTestInstallation, 'user'> = {
    user: {
      token: 'xoxp-org-x-user-x2-token',
      scopes: ['channels:read', 'chat:write'],
      id: 'org-x-user-x2-id',
    },
  };

  return {
    installation: {
      orgX: {
        teamA: {
          userX1: {
            ...orgXInstallation,
            ...userX1,
          },
          userX2: {
            ...orgXInstallation,
            ...userX2,
          },
        },
        teamB: {
          userX1: {
            ...orgXInstallation,
            ...userX1,
          },
        },
      },
      orgY: {
        teamC: {
          userY1: {
            ...teamCInstallation,
            user: {
              token: 'xoxp-team-c-user-y1-token',
              scopes: ['channels:read', 'chat:write'],
              id: 'org-y-user-y1-id',
            },
          },
        },
        teamD: {
          userY1: {
            ...teamDInstallation,
            user: {
              token: 'xoxp-team-d-user-y1-token',
              scopes: ['channels:read', 'chat:write'],
              id: 'org-y-user-y1-id',
            },
          },
          userY2: {
            ...teamDInstallation,
            user: {
              token: 'xoxp-team-d-user-y2-token',
              scopes: ['channels:read', 'chat:write'],
              id: 'org-y-user-y2-id',
            },
          },
        },
      },
    },
  };
}
