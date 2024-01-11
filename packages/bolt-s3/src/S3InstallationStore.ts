import {ListObjectsV2CommandInput, S3} from '@aws-sdk/client-s3';
import {Logger} from '@slack/logger';
import {Installation, InstallationQuery, InstallationStore} from '@slack/oauth';
import {InstallationCodec, JsonInstallationCodec} from './InstallationCodec';

class S3Client {
  private constructor(
    private readonly client: S3,
    private readonly bucketName: string
  ) {}

  static async create(
    s3: Promise<S3> | S3,
    bucketName: string
  ): Promise<S3Client> {
    if (s3 instanceof Promise) {
      return new S3Client(await s3, bucketName);
    }
    return new S3Client(s3, bucketName);
  }

  async store(key: string, data: Buffer, logger?: Logger): Promise<void> {
    const response = await this.client.putObject({
      Bucket: this.bucketName,
      Key: key,
      Body: data,
    });

    logger?.debug(
      `S3 putObject response: ${JSON.stringify(response.$metadata)}`
    );
  }

  async fetch(key: string, logger?: Logger): Promise<Buffer | undefined> {
    try {
      const response = await this.client.getObject({
        Bucket: this.bucketName,
        Key: key,
      });
      logger?.debug(
        `S3 getObject response: ${JSON.stringify(response.$metadata)}`
      );

      const body = response.Body;
      if (body === undefined) {
        return undefined;
      }

      const array = await body?.transformToByteArray();
      return Buffer.from(array);
    } catch (e) {
      logger?.warn(
        `Failed to get installation: bucket = ${this.bucketName}, key = ${key}:`,
        e
      );
      return undefined;
    }
  }

  async delete(keyPrefix: string, logger?: Logger): Promise<void> {
    const input: ListObjectsV2CommandInput = {
      Bucket: this.bucketName,
      Prefix: keyPrefix,
    };

    const objectKeys: string[] = [];
    let isTruncated;
    do {
      const response = await this.client.listObjectsV2(input);
      input.ContinuationToken = response.NextContinuationToken;
      isTruncated = response.IsTruncated;
      if (response.Contents) {
        objectKeys.push(
          ...response.Contents.map(({Key}) => Key).filter(
            (key): key is string => typeof key === 'string'
          )
        );
      }
    } while (isTruncated);

    // DeleteObjectsCommand can delete objects up to 1,000 per call
    const deletePromises: Promise<unknown>[] = [];
    const chunkSize = 1000;
    for (let i = 0; i < objectKeys.length; i += chunkSize) {
      const chunk = objectKeys.slice(i, i + chunkSize);
      logger?.info(`Going to delete installations: ${chunk.join(', ')}`);
      const promise = this.client.deleteObjects({
        Bucket: this.bucketName,
        Delete: {
          Objects: chunk.map(Key => ({Key})),
        },
      });
      deletePromises.push(promise);
    }

    await Promise.all(deletePromises);
  }
}

export class S3InstallationStore implements InstallationStore {
  private readonly s3Client: Promise<S3Client>;
  private readonly installationCodec: InstallationCodec;

  constructor(
    s3: Promise<S3> | S3,
    bucketName: string,
    private readonly clientId: string,
    private readonly options?: {
      historicalDataEnabled?: boolean;
      installationCodec?: InstallationCodec;
    }
  ) {
    this.s3Client = S3Client.create(s3, bucketName);
    this.installationCodec =
      options?.installationCodec ?? JsonInstallationCodec.INSTANCE;
  }

  private createBaseKey(
    enterpriseId: string | undefined,
    teamId: string | undefined
  ): string {
    const elements = [enterpriseId ?? 'none', teamId ?? 'none'];
    return `${this.clientId}/${elements.join('-')}`;
  }

  private createAppKey(baseKey: string, historyVersion = 'latest'): string {
    return `${baseKey}/installer-${historyVersion}`;
  }

  private createUserKey(
    baseKey: string,
    userId: string,
    historyVersion = 'latest'
  ): string {
    return `${baseKey}/installer-${userId}-${historyVersion}`;
  }

  private createHistoryVersion(): string {
    return Date.now().toString();
  }

  private encodeInstallation(installation: Installation): Buffer {
    return this.installationCodec.encode(installation);
  }

  private decodeInstallation(data: Buffer): Installation {
    return this.installationCodec.decode(data);
  }

  async storeInstallation<AuthVersion extends 'v1' | 'v2'>(
    installation: Installation<AuthVersion, boolean>,
    logger?: Logger
  ): Promise<void> {
    const baseKey = this.createBaseKey(
      installation.enterprise?.id,
      installation.team?.id
    );

    const keys: string[] = [
      this.createAppKey(baseKey),
      this.createUserKey(baseKey, installation.user.id),
    ];
    if (this.options?.historicalDataEnabled) {
      const historyVersion = this.createHistoryVersion();
      keys.push(
        this.createAppKey(baseKey, historyVersion),
        this.createUserKey(baseKey, installation.user.id, historyVersion)
      );
    }

    const data = this.encodeInstallation(installation);
    const s3Client = await this.s3Client;

    await Promise.all(keys.map(key => s3Client.store(key, data, logger)));
  }

  async fetchInstallation(
    query: InstallationQuery<boolean>,
    logger?: Logger
  ): Promise<Installation> {
    const baseKey = this.createBaseKey(query.enterpriseId, query.teamId);

    const keys = [this.createAppKey(baseKey)];
    if (query.userId) {
      keys.push(this.createUserKey(baseKey, query.userId));
    }

    const s3Client = await this.s3Client;
    const [app, user] = await Promise.all(
      keys.map(key =>
        s3Client
          .fetch(key, logger)
          .then(data => (data ? this.decodeInstallation(data) : undefined))
      )
    );

    if (app !== undefined) {
      if (user !== undefined) {
        app.user = user.user;
      }
      return app;
    }

    if (user !== undefined) {
      return user;
    }

    throw new Error(
      `No valid installation found: query = ${JSON.stringify(query)}`
    );
  }

  async deleteInstallation(
    query: InstallationQuery<boolean>,
    logger?: Logger
  ): Promise<void> {
    const baseKey = this.createBaseKey(query.enterpriseId, query.teamId);

    const keyPrefix = query.userId
      ? this.createUserKey(baseKey, query.userId, '')
      : this.createAppKey(baseKey, '');

    await (await this.s3Client).delete(keyPrefix, logger);
  }
}
