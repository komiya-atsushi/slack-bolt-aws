import {Installation} from '@slack/oauth';
import {ConsoleLogger, LogLevel} from '@slack/logger';
import {
  DeleteObjectsCommandInput,
  ListObjectsV2CommandInput,
  S3,
} from '@aws-sdk/client-s3';
import {BinaryInstallationCodec, S3InstallationStore} from '../src';
import {installation} from './test-data';

const s3Client = new S3({
  endpoint: 'http://127.0.0.1:4566',
  region: 'ap-northeast-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

const logger = new ConsoleLogger();
logger.setLevel(LogLevel.DEBUG);

const installationCodec = BinaryInstallationCodec.createDefault(
  'test-password',
  'test-salt'
);

const slackClientId = 'slack-client-id';
const bucketName = 'bolt-s3-test';
const teamId = installation.team.id;
const userId = installation.user.id;
const anotherUserId = 'another-user-id';

const anotherInstallation: Installation = {
  ...installation,
  user: {
    ...installation.user,
    id: anotherUserId,
  },
};

async function deleteObjects(keyPrefix: string): Promise<void> {
  const listCommand: ListObjectsV2CommandInput = {
    Bucket: bucketName,
    Prefix: keyPrefix,
  };
  const deleteCommand: DeleteObjectsCommandInput = {
    Bucket: bucketName,
    Delete: {
      Objects: [],
    },
  };

  let isTruncated: boolean | undefined;
  do {
    const response = await s3Client.listObjectsV2(listCommand);
    listCommand.ContinuationToken = response.NextContinuationToken;
    isTruncated = response.IsTruncated;

    const objects = response.Contents?.map(({Key}) => ({Key}))?.filter(
      (o): o is {Key: string} => o.Key !== undefined
    );

    if (objects) {
      deleteCommand.Delete!.Objects = objects;
      await s3Client.deleteObjects(deleteCommand);
    }
  } while (isTruncated);
}

async function listObjectKeys(keyPrefix: string): Promise<string[]> {
  const listCommand: ListObjectsV2CommandInput = {
    Bucket: bucketName,
    Prefix: keyPrefix,
  };

  const result: string[] = [];
  let isTruncated: boolean | undefined;
  do {
    const response = await s3Client.listObjectsV2(listCommand);
    listCommand.ContinuationToken = response.NextContinuationToken;
    isTruncated = response.IsTruncated;

    const keys = response.Contents?.map(({Key}) => Key)?.filter(
      (key): key is string => key !== undefined
    );

    if (keys) {
      result.push(...keys);
    }
  } while (isTruncated);

  return result;
}

async function getObject(key: string): Promise<Buffer | undefined> {
  const response = await s3Client.getObject({Bucket: bucketName, Key: key});
  const body = response.Body;
  if (body === undefined) {
    return body;
  }
  return Buffer.from(await body.transformToByteArray());
}

// ---

describe('S3InstallationStore', () => {
  beforeEach(async () => {
    await deleteObjects(`${slackClientId}/`);
  });

  describe('historicalDataEnabled: true', () => {
    const sut = S3InstallationStore.create({
      s3: s3Client,
      bucketName,
      clientId: slackClientId,
      options: {
        historicalDataEnabled: true,
        installationCodec,
      },
    });

    describe('storeInstallation()', () => {
      test('can store installations with histories', async () => {
        await sut.storeInstallation(installation, logger);

        const keys = await listObjectKeys(`${slackClientId}/`);

        expect(keys.length).toStrictEqual(4);
        expect(keys).toEqual(
          expect.arrayContaining([
            `${slackClientId}/none-${teamId}/installer-latest`,
            `${slackClientId}/none-${teamId}/installer-${userId}-latest`,
            expect.stringMatching(
              `${slackClientId}/none-${teamId}/installer-\\d+`
            ),
            expect.stringMatching(
              `${slackClientId}/none-${teamId}/installer-${userId}-\\d+`
            ),
          ])
        );
      });

      test('can update installer-latest', async () => {
        const anotherUserId = 'another-user-id';
        await sut.storeInstallation(installation, logger);
        await sut.storeInstallation(anotherInstallation, logger);

        const data = await getObject(
          `${slackClientId}/none-${teamId}/installer-latest`
        );

        expect(data).not.toBeUndefined();

        const decoded = installationCodec.decode(data!);
        expect(decoded.user.id).toStrictEqual(anotherUserId);
      });
    });

    describe('fetchInstallation()', () => {
      test('can fetch installation which only contains bot token if userId is not specified', async () => {
        await sut.storeInstallation(installation, logger);

        const fetched = await sut.fetchInstallation(
          {
            enterpriseId: undefined,
            teamId,
            isEnterpriseInstall: false,
          },
          logger
        );

        const {user: _ignore1, ...fetchedWithoutUser} = fetched;
        const {user: _ignore2, ...expectedWithoutUser} = installation;

        expect(fetchedWithoutUser).toEqual(expectedWithoutUser);
      });

      test('can fetch installation which only contains bot token if installation object is not found for the user', async () => {
        await sut.storeInstallation(installation, logger);

        const fetched = await sut.fetchInstallation({
          enterpriseId: undefined,
          teamId,
          userId: anotherUserId,
          isEnterpriseInstall: false,
        });

        expect(fetched).not.toEqual(installation);
        expect(fetched.bot).toEqual(installation.bot);
        expect(fetched.user).toStrictEqual({
          id: installation.user.id,
          token: undefined,
          scopes: undefined,
        });
      });

      test('can fetch installer-USERID-latest', async () => {
        await sut.storeInstallation(installation, logger);
        await sut.storeInstallation(anotherInstallation, logger);

        const fetched = await sut.fetchInstallation(
          {
            enterpriseId: undefined,
            teamId,
            userId,
            isEnterpriseInstall: false,
          },
          logger
        );
        const fetchedAnotherUser = await sut.fetchInstallation(
          {
            enterpriseId: undefined,
            teamId,
            userId: anotherUserId,
            isEnterpriseInstall: false,
          },
          logger
        );

        expect(fetched).toEqual(installation);
        expect(fetchedAnotherUser).toHaveProperty('user.id', anotherUserId);
      });

      test('throws error if installation does not exist', async () => {
        await expect(
          async () =>
            await sut.fetchInstallation(
              {
                enterpriseId: undefined,
                teamId: 'team-id-does-not-exist',
                userId: 'user-id-does-not-exist',
                isEnterpriseInstall: false,
              },
              logger
            )
        ).rejects.toThrow();
      });
    });

    describe('deleteInstallation()', () => {
      test('can delete latest installation and histories by userId', async () => {
        await sut.storeInstallation(installation, logger);
        await sut.storeInstallation(anotherInstallation, logger);

        await sut.deleteInstallation(
          {
            enterpriseId: undefined,
            teamId,
            userId,
            isEnterpriseInstall: false,
          },
          logger
        );

        const keys = await listObjectKeys(`${slackClientId}/`);

        expect(keys).toHaveLength(5);
        expect(keys).toEqual(
          expect.arrayContaining([
            `${slackClientId}/none-${teamId}/installer-latest`,
            `${slackClientId}/none-${teamId}/installer-${anotherUserId}-latest`,
            expect.stringMatching(
              `${slackClientId}/none-${teamId}/installer-\\d+`
            ),
            expect.stringMatching(
              `${slackClientId}/none-${teamId}/installer-${anotherUserId}-\\d+`
            ),
          ])
        );

        expect(keys).not.toEqual(
          expect.arrayContaining([
            `${slackClientId}/none-${teamId}/installer-${userId}-latest`,
            expect.stringMatching(
              `${slackClientId}/none-${teamId}/installer-${userId}-\\d+`
            ),
          ])
        );
      });

      test('can delete all installations by team', async () => {
        await sut.storeInstallation(installation, logger);

        await sut.deleteInstallation(
          {
            enterpriseId: undefined,
            teamId,
            isEnterpriseInstall: false,
          },
          logger
        );

        const keys = await listObjectKeys(`${slackClientId}/`);

        expect(keys).toStrictEqual([]);
      });
    });
  });

  describe('historicalDataEnabled: false', () => {
    const sut = S3InstallationStore.create({
      s3: s3Client,
      bucketName,
      clientId: slackClientId,
      options: {
        historicalDataEnabled: false,
        installationCodec,
      },
    });
    // todo remove
    // const sut = new S3InstallationStore(
    //   new Promise(resolve => resolve(s3Client)),
    //   bucketName,
    //   slackClientId,
    //   {
    //     historicalDataEnabled: false,
    //     installationCodec,
    //   }
    // );

    describe('storeInstallation()', () => {
      test('can store installations without histories', async () => {
        await sut.storeInstallation(installation);

        const keys = await listObjectKeys(`${slackClientId}/`);

        expect(keys.length).toStrictEqual(2);
        expect(keys).toEqual(
          expect.arrayContaining([
            `${slackClientId}/none-${teamId}/installer-latest`,
            `${slackClientId}/none-${teamId}/installer-${userId}-latest`,
          ])
        );
      });
    });
  });
});
