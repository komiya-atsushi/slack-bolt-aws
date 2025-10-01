import {
  type AttributeValue,
  BatchGetItemCommand,
  type BatchGetItemCommandOutput,
  DynamoDB,
  type DynamoDBClient,
  type PutItemCommandInput,
  type ScanCommandOutput,
} from '@aws-sdk/client-dynamodb';
import {ConsoleLogger, LogLevel} from '@slack/logger';
import type {Installation, InstallationQuery} from '@slack/oauth';
import {DynamoDbInstallationStore, SimpleKeyGenerator} from '../src';
import {
  generateEnterpriseTestData,
  generateTestData,
  type TestInstallation,
} from './test-data';

const logger = new ConsoleLogger();
logger.setLevel(LogLevel.DEBUG);

const dynamoDbClient = new DynamoDB({
  endpoint: 'http://127.0.0.1:4566',
  region: 'ap-northeast-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

function isOrganizationWideInstall(
  installation: Installation<'v2', boolean>,
): installation is Installation<'v2', true> {
  return installation.isEnterpriseInstall ?? false;
}

class TestContext {
  constructor(
    readonly slackClientId: string,
    readonly dynamoDbClient: DynamoDB,
    readonly tableName: string,
    readonly partitionKeyName: string,
    readonly sortKeyName: string,
    readonly attributeName: string,
  ) {}

  async recreateTable(): Promise<void> {
    const listTablesResponse = await this.dynamoDbClient.listTables({});
    if (
      listTablesResponse.TableNames !== undefined &&
      listTablesResponse.TableNames.indexOf(this.tableName) >= 0
    ) {
      await dynamoDbClient.deleteTable({TableName: this.tableName});
    }

    await dynamoDbClient.createTable({
      TableName: this.tableName,
      AttributeDefinitions: [
        {
          AttributeName: this.partitionKeyName,
          AttributeType: 'S',
        },
        {
          AttributeName: this.sortKeyName,
          AttributeType: 'S',
        },
      ],
      KeySchema: [
        {
          AttributeName: this.partitionKeyName,
          KeyType: 'HASH',
        },
        {
          AttributeName: this.sortKeyName,
          KeyType: 'RANGE',
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
  }

  async scanTable(): Promise<ScanCommandOutput> {
    return this.dynamoDbClient.scan({
      TableName: this.tableName,
      ConsistentRead: true,
    });
  }

  expectedPartitionKey(
    installation: Installation<'v2', true> | Installation<'v2', false>,
  ): string {
    if (isOrganizationWideInstall(installation)) {
      return `Client#${this.slackClientId}$Enterprise#${installation.enterprise.id}$Team#none`;
    } else {
      const enterpriseId = installation?.enterprise?.id ?? 'none';
      return `Client#${this.slackClientId}$Enterprise#${enterpriseId}$Team#${installation.team.id}`;
    }
  }

  expectedSortKeyForUser(installation: Installation<'v2', boolean>): string {
    return `Type#Token$User#${installation.user.id}$Version#latest`;
  }

  expectedSortKeyForBot(_: Installation<'v2', boolean>): string {
    return 'Type#Token$User#___bot___$Version#latest';
  }

  expectedInstallationInItem(): Record<string, AttributeValue> {
    return Object.fromEntries([
      [this.attributeName, {B: expect.any(Uint8Array)}],
    ]);
  }

  asItemOfUser(
    installation: Installation<'v2', true> | Installation<'v2', false>,
  ): Record<string, AttributeValue> {
    const key = Object.fromEntries([
      [this.partitionKeyName, {S: this.expectedPartitionKey(installation)}],
      [this.sortKeyName, {S: this.expectedSortKeyForUser(installation)}],
    ]);

    return {
      ...key,
      ...this.expectedInstallationInItem(),
    };
  }

  asItemOfBot(
    installation: Installation<'v2', true> | Installation<'v2', false>,
  ): Record<string, AttributeValue> {
    const key = Object.fromEntries([
      [this.partitionKeyName, {S: this.expectedPartitionKey(installation)}],
      [this.sortKeyName, {S: this.expectedSortKeyForBot(installation)}],
    ]);

    return {
      ...key,
      ...this.expectedInstallationInItem(),
    };
  }

  extractInstallationAttributeValue(
    item: Record<string, AttributeValue> | undefined,
  ): AttributeValue | undefined {
    if (Array.isArray(this.attributeName)) {
      const lastIndex = this.attributeName.length - 1;
      let current = item;

      for (let i = 0; i < lastIndex; i++) {
        const attrName = this.attributeName[i];
        const attrVal = current?.[attrName];
        if (attrVal === undefined || attrVal.M === undefined) {
          return undefined;
        }
        current = attrVal.M;
      }

      return current?.[this.attributeName[lastIndex]];
    }

    return item?.[this.attributeName];
  }

  decodeJsonInstallation(
    item: Record<string, AttributeValue>,
  ): TestInstallation {
    const attrVal = this.extractInstallationAttributeValue(item);
    if (attrVal === undefined) {
      throw new Error(`Item does not have attribute '${this.attributeName}'`);
    }

    if (attrVal.B === undefined) {
      throw new Error(
        `Data type of the attribute '${this.attributeName}' is not binary`,
      );
    }

    const buf = Buffer.from(attrVal.B);
    return JSON.parse(buf.toString());
  }

  findItems(
    items: Record<string, AttributeValue>[],
    conditions: [string, string][],
  ): (Record<string, AttributeValue> | undefined)[] {
    const result: (Record<string, AttributeValue> | undefined)[] = [];

    for (const [teamId, userId] of conditions) {
      let found: Record<string, AttributeValue> | undefined;

      for (const item of items) {
        const pk = item[this.partitionKeyName]?.S;
        const sk = item[this.sortKeyName]?.S;

        if (
          pk === undefined ||
          !pk.includes(teamId) ||
          sk === undefined ||
          !sk.includes(userId)
        ) {
          continue;
        }

        found = item;
        break;
      }

      result.push(found);
    }

    return result;
  }

  findInstallationsFromItems(
    items: Record<string, AttributeValue>[],
    conditions: [string, string][],
  ): (TestInstallation | undefined)[] {
    return this.findItems(items, conditions).map((itemOrUndefined) =>
      itemOrUndefined
        ? this.decodeJsonInstallation(itemOrUndefined)
        : itemOrUndefined,
    );
  }
}

function toBotQuery(
  installation: Installation<'v2', true> | Installation<'v2', false>,
): InstallationQuery<boolean> {
  return isOrganizationWideInstall(installation)
    ? {
        isEnterpriseInstall: true,
        enterpriseId: installation.enterprise?.id,
        teamId: undefined,
      }
    : {
        isEnterpriseInstall: false,
        enterpriseId: installation.enterprise?.id,
        teamId: installation.team?.id,
      };
}

function toUserQuery(
  installation: Installation<'v2', true> | Installation<'v2', false>,
): InstallationQuery<boolean> {
  return {
    ...toBotQuery(installation),
    userId: installation.user.id,
  };
}

function botInstallationOf(
  installation: Installation<'v2', true> | Installation<'v2', false>,
): Installation<'v2', boolean> {
  const {user, ...rest} = installation;

  return {
    ...rest,
    user: {
      id: user.id,
      token: undefined,
      scopes: undefined,
    },
  };
}

// ---

describe('DynamoDbInstallationStore', () => {
  describe('Basic operation', () => {
    const testContext = new TestContext(
      'bolt-dynamodb-test',
      dynamoDbClient,
      'BasicOperationTestTable',
      'PK',
      'SK',
      'Installation',
    );

    const sut = DynamoDbInstallationStore.create({
      clientId: testContext.slackClientId,
      dynamoDb: testContext.dynamoDbClient,
      tableName: testContext.tableName,
      partitionKeyName: testContext.partitionKeyName,
      sortKeyName: testContext.sortKeyName,
      attributeName: testContext.attributeName,
    });

    beforeEach(async () => {
      await testContext.recreateTable();
    });

    describe('storeInstallation()', () => {
      it('can store an installation', async () => {
        // arrange
        const installation = generateTestData().installation.teamA.userA1;

        // act
        await sut.storeInstallation(installation, logger);

        // assert
        const scanResponse = await testContext.scanTable();

        expect(scanResponse.ScannedCount).toEqual(2);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation),
            testContext.asItemOfBot(installation),
          ]),
        );

        const items = scanResponse.Items as Record<string, AttributeValue>[];
        const installations = items.map((item) =>
          testContext.decodeJsonInstallation(item),
        );

        expect(installations[0]).toEqual(installation);
        expect(installations[1]).toEqual(installation);
      });

      it('can store installations of the same team without overwriting them', async () => {
        // arrange
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation2 = testData.installation.teamA.userA2;

        // act
        await sut.storeInstallation(installation1, logger);
        await sut.storeInstallation(installation2, logger);

        // assert
        const scanResponse = await testContext.scanTable();

        expect(scanResponse.ScannedCount).toEqual(3);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation1),
            testContext.asItemOfUser(installation2),
            testContext.asItemOfBot(installation2),
          ]),
        );

        const [user1Installation, user2Installation, botInstallation] =
          testContext.findInstallationsFromItems(scanResponse.Items ?? [], [
            [installation1.team.id, installation1.user.id],
            [installation2.team.id, installation2.user.id],
            [installation1.team.id, '___bot___'],
          ]);

        expect(user1Installation).toEqual(installation1);
        expect(user2Installation).toEqual(installation2);
        expect(botInstallation).toEqual(installation2);
      });

      it('can store installations of the different teams', async () => {
        // arrange
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation3 = testData.installation.teamB.userB3;

        // act
        await sut.storeInstallation(installation1, logger);
        await sut.storeInstallation(installation3, logger);

        // assert
        const scanResponse = await testContext.scanTable();

        expect(scanResponse.ScannedCount).toEqual(4);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation1),
            testContext.asItemOfUser(installation3),
            testContext.asItemOfBot(installation1),
            testContext.asItemOfBot(installation3),
          ]),
        );

        const [
          user1Installation,
          user3Installation,
          botAInstallation,
          botBInstallation,
        ] = testContext.findInstallationsFromItems(scanResponse.Items ?? [], [
          [installation1.team.id, installation1.user.id],
          [installation3.team.id, installation3.user.id],
          [installation1.team.id, '___bot___'],
          [installation3.team.id, '___bot___'],
        ]);

        expect(user1Installation).toEqual(installation1);
        expect(user3Installation).toEqual(installation3);
        expect(botAInstallation).toEqual(installation1);
        expect(botBInstallation).toEqual(installation3);
      });
    });

    describe('fetchInstallation()', () => {
      it('can query user token and get user installation', async () => {
        // arrange
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation2 = testData.installation.teamA.userA2;
        const installation3 = testData.installation.teamB.userB3;

        await sut.storeInstallation(installation1);
        await sut.storeInstallation(installation2);
        await sut.storeInstallation(installation3);

        // act
        const fetchedUser1 = await sut.fetchInstallation(
          toUserQuery(installation1),
          logger,
        );
        const fetchedUser2 = await sut.fetchInstallation(
          toUserQuery(installation2),
          logger,
        );
        const fetchedUser3 = await sut.fetchInstallation(
          toUserQuery(installation3),
          logger,
        );

        // assert
        expect(fetchedUser1).toEqual(installation1);
        expect(fetchedUser2).toEqual(installation2);
        expect(fetchedUser3).toEqual(installation3);
      });

      it('can query bot token and get bot installation', async () => {
        // arrange
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation3 = testData.installation.teamB.userB3;

        await sut.storeInstallation(installation1);
        await sut.storeInstallation(installation3);

        // act
        const fetchedBotTeamA = await sut.fetchInstallation(
          toBotQuery(installation1),
          logger,
        );
        const fetchedBotTeamB = await sut.fetchInstallation(
          toBotQuery(installation3),
          logger,
        );

        // assert
        expect(fetchedBotTeamA).toEqual(botInstallationOf(installation1));
        expect(fetchedBotTeamB).toEqual(botInstallationOf(installation3));
      });

      it('can query user token and get bot installation instead of user installation', async () => {
        // arrange
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation2 = testData.installation.teamA.userA2;

        await sut.storeInstallation(installation1);

        // act
        const fetch = await sut.fetchInstallation(
          toUserQuery(installation2),
          logger,
        );

        // assert
        expect(fetch).toEqual(botInstallationOf(installation1));
      });

      it('throws error if neither user installation nor bot installation exists', async () => {
        // arrange
        const testData = generateTestData();
        const installation = testData.installation.teamA.userA1;

        // act/assert
        await expect(() =>
          sut.fetchInstallation(toUserQuery(installation), logger),
        ).rejects.toThrow(/No valid installation found/);
      });
    });

    describe('deleteInstallation()', () => {
      it('can delete user installation', async () => {
        // arrange
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation2 = testData.installation.teamA.userA2;

        await sut.storeInstallation(installation1);
        await sut.storeInstallation(installation2);

        // act
        await sut.deleteInstallation(toUserQuery(installation1), logger);

        // assert
        const scanResponse = await testContext.scanTable();
        expect(scanResponse.ScannedCount).toEqual(2);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation2),
            testContext.asItemOfBot(installation2),
          ]),
        );

        const items = scanResponse.Items as Record<string, AttributeValue>[];
        const installations = items.map((item) =>
          testContext.decodeJsonInstallation(item),
        );

        expect(installations[0]).toEqual(installation2);
        expect(installations[1]).toEqual(installation2);
      });

      it('can delete all user installations of specified team', async () => {
        const testData = generateTestData();
        const installation1 = testData.installation.teamA.userA1;
        const installation2 = testData.installation.teamA.userA2;
        const installation3 = testData.installation.teamB.userB3;

        await sut.storeInstallation(installation1);
        await sut.storeInstallation(installation2);
        await sut.storeInstallation(installation3);

        // act
        await sut.deleteInstallation(toBotQuery(installation1), logger);

        // assert
        const scanResponse = await testContext.scanTable();
        expect(scanResponse.ScannedCount).toEqual(2);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation3),
            testContext.asItemOfBot(installation3),
          ]),
        );

        const items = scanResponse.Items as Record<string, AttributeValue>[];
        const installations = items.map((item) =>
          testContext.decodeJsonInstallation(item),
        );

        expect(installations[0]).toEqual(installation3);
        expect(installations[1]).toEqual(installation3);
      });

      it('can delete 25+ installations', async () => {
        // arrange
        const testData = generateTestData();
        const installation = testData.installation.teamA.userA1;
        const pk = testContext.expectedPartitionKey(installation);
        const sk = testContext.expectedSortKeyForUser(installation);

        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < 64; i++) {
          const input: PutItemCommandInput = {
            TableName: testContext.tableName,
            Item: Object.fromEntries([
              [testContext.partitionKeyName, {S: pk}],
              [
                testContext.sortKeyName,
                {S: sk.replace('latest', `version-${i}`)},
              ],
              [
                testContext.attributeName,
                {B: Buffer.from(JSON.stringify(installation))},
              ],
            ]),
          };

          promises.push(testContext.dynamoDbClient.putItem(input));
        }
        await Promise.all(promises);

        const scanResponseBefore = await testContext.scanTable();

        // act
        await sut.deleteInstallation(toUserQuery(installation), logger);

        // assert
        const scanResponseAfter = await testContext.scanTable();
        expect(scanResponseBefore.ScannedCount).toEqual(64);
        expect(scanResponseAfter.ScannedCount).toEqual(0);
      });
    });
  });

  describe('Additional features', () => {
    describe('deletionOption = DELETE_ATTRIBUTE', () => {
      const testContext = new TestContext(
        'bolt-dynamodb-test',
        dynamoDbClient,
        'DeleteAttributeTestTable',
        'PK',
        'SK',
        'Installation',
      );

      const sut = DynamoDbInstallationStore.create({
        clientId: testContext.slackClientId,
        dynamoDb: testContext.dynamoDbClient,
        tableName: testContext.tableName,
        partitionKeyName: testContext.partitionKeyName,
        sortKeyName: testContext.sortKeyName,
        attributeName: testContext.attributeName,
        deletionOption: 'DELETE_ATTRIBUTE',
      });

      beforeEach(async () => {
        await testContext.recreateTable();
      });

      it('should delete only the specific attribute that holds installation while keeping the item', async () => {
        // arrange
        const testData = generateTestData();
        const installation = testData.installation.teamA.userA1;

        await sut.storeInstallation(installation);

        // act
        await sut.deleteInstallation(toUserQuery(installation), logger);

        // assert
        const scanResponse = await testContext.scanTable();
        expect(scanResponse.ScannedCount).toEqual(2);

        const [user, bot] = testContext.findItems(scanResponse.Items ?? [], [
          [installation.team.id, installation.user.id],
          [installation.team.id, '___bot___'],
        ]);

        expect(user).not.toBeUndefined();
        expect(
          testContext.extractInstallationAttributeValue(user),
        ).toBeUndefined();

        expect(bot).not.toBeUndefined();
        expect(
          testContext.extractInstallationAttributeValue(bot),
        ).not.toBeUndefined();
      });
    });
  });

  describe('Behavior of the fetchMultiple', () => {
    const testData = generateTestData();
    const userInstallation = testData.installation.teamA.userA1;
    const botLatestInstallation = testData.installation.teamA.userA2;

    const clientId = 'bolt-dynamodb-test';
    const tableName = 'FetchMultipleTestTable';
    const teamId = userInstallation.team.id;
    const userId = userInstallation.user.id;

    const itemOfUser: Record<string, AttributeValue> = {
      PK: {S: `Client#${clientId}$Enterprise#none$Team#${teamId}`},
      SK: {S: `Type#Token$User#${userId}$Version#latest`},
      Installation: {B: Buffer.from(JSON.stringify(userInstallation))},
    };
    const itemOfBot: Record<string, AttributeValue> = {
      PK: {S: `Client#${clientId}$Enterprise#none$Team#${teamId}`},
      SK: {S: 'Type#Token$User#___bot___$Version#latest'},
      Installation: {B: Buffer.from(JSON.stringify(botLatestInstallation))},
    };

    const fetchQuery: InstallationQuery<false> = {
      isEnterpriseInstall: false,
      enterpriseId: undefined,
      teamId,
      userId,
    };

    function setUp(
      ...items: Record<string, AttributeValue>[]
    ): DynamoDbInstallationStore {
      const mockedSend: (command: unknown) => Promise<unknown> = jest.fn(
        (command) => {
          if (!(command instanceof BatchGetItemCommand)) {
            throw new Error('Unexpected command');
          }

          return new Promise((resolve) =>
            resolve({
              Responses: Object.fromEntries([[tableName, items]]),
            } as BatchGetItemCommandOutput),
          );
        },
      );

      const mockedDynamoDbClient = {
        send: mockedSend,
      } as DynamoDBClient;

      return DynamoDbInstallationStore.create({
        clientId: 'bolt-dynamodb-test',
        dynamoDb: mockedDynamoDbClient,
        tableName: 'FetchMultipleTestTable',
        partitionKeyName: 'PK',
        sortKeyName: 'SK',
        attributeName: 'Installation',
      });
    }

    test.each([[[itemOfUser, itemOfBot]], [[itemOfBot, itemOfUser]]])(
      'fetchInstallation() handles BatchGetItem response regardless of item order',
      async (items) => {
        // arrange
        const sut = setUp(...items);

        // act
        const result = await sut.fetchInstallation(fetchQuery);

        // assert
        expect(result.user.id).toEqual(userId);
      },
    );
  });

  describe('Enterprise Grid', () => {
    const testContext = new TestContext(
      'bolt-dynamodb-test',
      dynamoDbClient,
      'EnterpriseGridTestTable',
      'PK',
      'SK',
      'Installation',
    );

    const sut = DynamoDbInstallationStore.create({
      clientId: testContext.slackClientId,
      dynamoDb: testContext.dynamoDbClient,
      tableName: testContext.tableName,
      partitionKeyName: testContext.partitionKeyName,
      sortKeyName: testContext.sortKeyName,
      attributeName: testContext.attributeName,
    });

    beforeEach(async () => {
      await testContext.recreateTable();
    });

    describe('Organization-wide installation', () => {
      it('can store an installation', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgX.teamA.userX1;

        // act
        await sut.storeInstallation(installation, logger);

        // assert
        const scanResponse = await testContext.scanTable();

        expect(scanResponse.ScannedCount).toEqual(2);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation),
            testContext.asItemOfBot(installation),
          ]),
        );
      });

      it('can query bot token and get bot installation', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgX.teamA.userX1;
        await sut.storeInstallation(installation, logger);

        // act
        const result = await sut.fetchInstallation(toBotQuery(installation));

        // assert
        expect(result).toStrictEqual(botInstallationOf(installation));
      });

      it('can query user token and get user installation', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgX.teamA.userX1;
        await sut.storeInstallation(installation, logger);

        // act
        const result = await sut.fetchInstallation(toUserQuery(installation));

        // assert
        expect(result).toStrictEqual(installation);
      });

      it('can query user token and get bot installation instead of user installation', async () => {
        // arrange
        const orgX = generateEnterpriseTestData().installation.orgX;
        const installationX2 = orgX.teamA.userX2;
        await sut.storeInstallation(installationX2, logger);

        // act
        const result = await sut.fetchInstallation(
          toUserQuery(orgX.teamB.userX1),
        );

        // assert
        expect(result).toStrictEqual(botInstallationOf(installationX2));
      });

      it('can query user token and get user installation even if teamId is specified', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgX.teamA.userX1;
        await sut.storeInstallation(installation, logger);

        // act
        const result = await sut.fetchInstallation({
          ...toUserQuery(installation),
          teamId: 'team-a',
        });

        // assert
        expect(result).toStrictEqual(installation);
      });
    });

    describe('Single-workspace installation', () => {
      it('can store an installation', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgY.teamC.userY1;

        // act
        await sut.storeInstallation(installation, logger);

        // assert
        const scanResponse = await testContext.scanTable();

        expect(scanResponse.ScannedCount).toEqual(2);
        expect(scanResponse.Items).toEqual(
          expect.arrayContaining([
            testContext.asItemOfUser(installation),
            testContext.asItemOfBot(installation),
          ]),
        );
      });

      it('can query bot token and get bot installation', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgY.teamC.userY1;
        await sut.storeInstallation(installation, logger);

        // act
        const result = await sut.fetchInstallation(toBotQuery(installation));

        // assert
        expect(result).toStrictEqual(botInstallationOf(installation));
      });

      it('can query user token and get user installation', async () => {
        // arrange
        const installation =
          generateEnterpriseTestData().installation.orgY.teamC.userY1;
        await sut.storeInstallation(installation, logger);

        // act
        const result = await sut.fetchInstallation(toUserQuery(installation));

        // assert
        expect(result).toStrictEqual(installation);
      });

      it('can query user token and get bot installation instead of user installation', async () => {
        // arrange
        const orgY = generateEnterpriseTestData().installation.orgY;
        const installationY2 = orgY.teamD.userY2;
        await sut.storeInstallation(installationY2, logger);

        // act
        const result = await sut.fetchInstallation(
          toUserQuery(orgY.teamD.userY1),
        );

        // assert
        expect(result).toStrictEqual(botInstallationOf(installationY2));
      });

      it('cannot get bot installation instead of user installation if user is not the same workspace', async () => {
        // arrange
        const orgY = generateEnterpriseTestData().installation.orgY;
        const installationY2 = orgY.teamD.userY2;
        await sut.storeInstallation(installationY2, logger);

        // act
        await expect(() =>
          sut.fetchInstallation(toUserQuery(orgY.teamC.userY1)),
        ).rejects.toThrow(/No valid installation found/);
      });
    });
  });
});

describe('SimpleKeyGenerator', () => {
  const sut = SimpleKeyGenerator.create('PK', 'SK');

  describe('equals()', () => {
    it('returns true when two objects are equal', () => {
      const result = sut.equals(
        {
          PK: {S: 'PartitionKey-0'},
          SK: {S: 'SortKey-0'},
        },
        {
          PK: {S: 'PartitionKey-0'},
          SK: {S: 'SortKey-0'},
        },
      );

      expect(result).toEqual(true);
    });

    it('returns false when partition keys of two objects are not equal', () => {
      const result = sut.equals(
        {
          PK: {S: 'PartitionKey-0'},
          SK: {S: 'SortKey-0'},
        },
        {
          PK: {S: 'PartitionKey-99999'},
          SK: {S: 'SortKey-0'},
        },
      );
      expect(result).toEqual(false);
    });

    it('return false when sort keys of two objects are not equal', () => {
      const result = sut.equals(
        {
          PK: {S: 'PartitionKey-0'},
          SK: {S: 'SortKey-0'},
        },
        {
          PK: {S: 'PartitionKey-0'},
          SK: {S: 'SortKey-99999'},
        },
      );

      expect(result).toEqual(false);
    });

    it('returns false when two objects are equal but the data type of the partition key is not string', () => {
      const result = sut.equals(
        {
          PK: {N: '0'},
          SK: {S: 'SortKey-0'},
        },
        {
          PK: {N: '0'},
          SK: {S: 'SortKey-0'},
        },
      );

      expect(result).toEqual(false);
    });

    it('returns false when two objects are equal but the data type of the sort key is not string', () => {
      const result = sut.equals(
        {
          PK: {S: 'PartitionKey-0'},
          SK: {N: '0'},
        },
        {
          PK: {S: 'PartitionKey-0'},
          SK: {N: '0'},
        },
      );

      expect(result).toEqual(false);
    });
  });
});
