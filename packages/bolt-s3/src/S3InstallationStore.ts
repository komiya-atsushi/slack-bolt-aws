import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {Logger} from '@slack/logger';
import {InstallationCodec, JsonInstallationCodec} from './InstallationCodec';
import {
  InstallationStoreBase,
  KeyGenerator,
  KeyGeneratorArgs,
  StorageBase,
} from './InstallationStoreBase';

type S3Key = string;
type S3DeletionKey = string;

export type S3KeyGenerator = KeyGenerator<S3Key, S3DeletionKey>;

export class SimpleKeyGenerator implements S3KeyGenerator {
  static create() {
    return new SimpleKeyGenerator();
  }

  generate(args: KeyGeneratorArgs & {historyVersion?: string}): string {
    const base = `${args.clientId}/${args.enterpriseId ?? 'none'}-${
      args.teamId ?? 'none'
    }`;
    const historyVersion = args.historyVersion ?? 'latest';
    return args.userId !== undefined
      ? `${base}/installer-${args.userId}-${historyVersion}`
      : `${base}/installer-${historyVersion}`;
  }

  generateForDeletion(args: KeyGeneratorArgs): string {
    const base = `${args.clientId}/${args.enterpriseId ?? 'none'}-${
      args.teamId ?? 'none'
    }`;
    return args.userId !== undefined
      ? `${base}/installer-${args.userId}-`
      : `${base}/installer-`;
  }
}

class S3Storage extends StorageBase<S3Key, S3DeletionKey> {
  constructor(
    private readonly client: S3Client,
    private readonly bucketName: string
  ) {
    super();
  }

  static async create(
    s3: Promise<S3Client> | S3Client,
    bucketName: string
  ): Promise<S3Storage> {
    const client = s3 instanceof Promise ? await s3 : s3;
    return new S3Storage(client, bucketName);
  }

  async store(
    key: S3Key,
    data: Buffer,
    isBotToken: boolean,
    logger: Logger | undefined
  ): Promise<void> {
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: data,
      })
    );

    logger?.debug('[store] PutObject response', key, response.$metadata);
  }

  async fetch(
    key: S3Key,
    logger: Logger | undefined
  ): Promise<Buffer | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );

      logger?.debug('[fetch] GetObject response', key, response.$metadata);

      const byteArray = await response.Body?.transformToByteArray();
      return byteArray !== undefined ? Buffer.from(byteArray) : undefined;
    } catch (e) {
      logger?.debug('Object not found', key);
      return undefined;
    }
  }

  async delete(key: S3DeletionKey, logger: Logger | undefined): Promise<void> {
    const keysToDelete = await this.listKeysToDelete(key, logger);

    const promises: Promise<unknown>[] = [];

    // DeleteObjectsCommand can delete objects up to 1,000 per call
    const chunkSize = 1000;
    for (let i = 0; i < keysToDelete.length; i += chunkSize) {
      const chunk = keysToDelete.slice(i, i + chunkSize);

      logger?.debug('[delete] Going to delete installations', chunk);

      const promise = this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: chunk.map(Key => ({Key})),
          },
        })
      );

      promises.push(promise);
    }

    await Promise.all(promises);
  }

  private async listKeysToDelete(
    key: S3DeletionKey,
    logger: Logger | undefined
  ): Promise<S3Key[]> {
    const input: ListObjectsV2CommandInput = {
      Bucket: this.bucketName,
      Prefix: key,
    };
    const result: S3Key[] = [];
    let isTruncated: boolean | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command(input));

      input.ContinuationToken = response.NextContinuationToken;
      isTruncated = response.IsTruncated;

      logger?.debug('[delete] ListObjectsV2 response', response);

      if (response.Contents) {
        result.push(
          ...response.Contents.map(({Key}) => Key).filter(
            (key): key is string => typeof key === 'string'
          )
        );
      }
    } while (isTruncated);

    return result;
  }
}

export class S3InstallationStore extends InstallationStoreBase<
  S3Key,
  S3DeletionKey
> {
  constructor(
    clientId: string,
    keyGenerator: S3KeyGenerator,
    storage: Promise<S3Storage>,
    options?: {
      historicalDataEnabled?: boolean;
      installationCodec?: InstallationCodec;
    }
  ) {
    super(
      clientId,
      keyGenerator,
      storage,
      options?.installationCodec ?? JsonInstallationCodec.INSTANCE,
      !!options?.historicalDataEnabled
    );
  }

  static create(args: {
    clientId: string;
    s3: Promise<S3Client> | S3Client;
    bucketName: string;
    options?: {
      historicalDataEnabled?: boolean;
      installationCodec?: InstallationCodec;
    };
  }): S3InstallationStore {
    const keyGenerator = SimpleKeyGenerator.create();

    const storage = S3Storage.create(args.s3, args.bucketName);

    return new S3InstallationStore(
      args.clientId,
      keyGenerator,
      storage,
      args.options
    );
  }
}
