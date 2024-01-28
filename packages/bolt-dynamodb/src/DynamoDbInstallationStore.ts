import {Logger} from '@slack/logger';
import {
  AttributeValue,
  BatchWriteItemCommandInput,
  DynamoDB,
  GetItemCommandInput,
  QueryCommandInput,
  UpdateItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import {InstallationCodec, JsonInstallationCodec} from './InstallationCodec';
import {
  InstallationStoreBase,
  KeyGenerator,
  KeyGeneratorArgs,
  Storage,
  StorageBase,
} from './InstallationStoreBase';

type DynamoDbKey = Record<string, AttributeValue>;
type DynamoDbDeletionKey = Required<
  Pick<
    QueryCommandInput,
    | 'KeyConditionExpression'
    | 'ExpressionAttributeNames'
    | 'ExpressionAttributeValues'
  >
>;

type DeletionOption = 'DELETE_ITEM' | 'DELETE_ATTRIBUTE';

export interface DynamoDbKeyGenerator
  extends KeyGenerator<DynamoDbKey, DynamoDbDeletionKey> {
  extractKeyFrom(item: Record<string, AttributeValue>): DynamoDbKey;
}

export class SimpleKeyGenerator implements DynamoDbKeyGenerator {
  private constructor(
    private readonly partitionKeyName: string,
    private readonly sortKeyName: string
  ) {}

  static create(
    partitionKeyName = 'PK',
    sortKeyName = 'SK'
  ): SimpleKeyGenerator {
    return new SimpleKeyGenerator(partitionKeyName, sortKeyName);
  }

  generate(args: KeyGeneratorArgs & {historyVersion?: string}): DynamoDbKey {
    return Object.fromEntries([
      [this.partitionKeyName, {S: this.generatePartitionKey(args)}],
      [this.sortKeyName, {S: this.generateSortKey(args, false)}],
    ]);
  }

  generateForDeletion(args: KeyGeneratorArgs): DynamoDbDeletionKey {
    return {
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: {
        '#pk': this.partitionKeyName,
        '#sk': this.sortKeyName,
      },
      ExpressionAttributeValues: {
        ':pk': {
          S: this.generatePartitionKey(args),
        },
        ':sk': {
          S: this.generateSortKey(args, true),
        },
      },
    };
  }

  extractKeyFrom(item: Record<string, AttributeValue>): DynamoDbKey {
    return Object.fromEntries([
      [this.partitionKeyName, item[this.partitionKeyName]],
      [this.sortKeyName, item[this.sortKeyName]],
    ]);
  }

  private generatePartitionKey(args: KeyGeneratorArgs): string {
    return [
      `Client#${args.clientId}`,
      `Enterprise#${args.enterpriseId ?? 'none'}`,
      `Team#${args.teamId ?? 'none'}`,
    ].join('$');
  }

  private generateSortKey(
    args: KeyGeneratorArgs & {historyVersion?: string},
    forDeletion: boolean
  ): string {
    const parts = [
      'Type#Token',
      this.sortKeyUserPart(args.userId, forDeletion),
    ];

    if (!forDeletion) {
      parts.push(this.sortKeyVersionPart(args.historyVersion));
    }

    return parts.join('$');
  }

  private sortKeyUserPart(
    userId: string | undefined,
    forDeletion: boolean
  ): string {
    if (userId === undefined && forDeletion) {
      return 'User#';
    }
    return `User#${userId ?? '___bot___'}`;
  }

  private sortKeyVersionPart(version: string | undefined): string {
    return `Version#${version ?? 'latest'}`;
  }
}

class DynamoDbStorage extends StorageBase<DynamoDbKey, DynamoDbDeletionKey> {
  constructor(
    private readonly client: DynamoDB,
    private readonly tableName: string,
    private readonly keyGenerator: DynamoDbKeyGenerator,
    private readonly attributeName: string,
    private readonly deletionOption: DeletionOption
  ) {
    super();
  }

  static async create(
    client: DynamoDB | Promise<DynamoDB>,
    tableName: string,
    keyGenerator: DynamoDbKeyGenerator,
    attributeName: string,
    deletionOption: DeletionOption = 'DELETE_ITEM'
  ): Promise<DynamoDbStorage> {
    const client_ = client instanceof Promise ? await client : client;
    return new DynamoDbStorage(
      client_,
      tableName,
      keyGenerator,
      attributeName,
      deletionOption
    );
  }

  async store(
    key: DynamoDbKey,
    data: Buffer,
    isBotToken: boolean,
    logger?: Logger
  ): Promise<void> {
    const input: UpdateItemCommandInput = {
      TableName: this.tableName,
      Key: key,
      UpdateExpression: 'SET #attrName = :d',
      ExpressionAttributeNames: {
        '#attrName': this.attributeName,
      },
      ExpressionAttributeValues: {
        ':d': {B: data},
      },
      ReturnConsumedCapacity: 'TOTAL',
    };

    const response = await this.client.updateItem(input);
    logger?.debug(
      '[store] UpdateItem consumed capacity',
      response.ConsumedCapacity
    );
  }

  // ---

  async fetch(key: DynamoDbKey, logger?: Logger): Promise<Buffer | undefined> {
    const input: GetItemCommandInput = {
      TableName: this.tableName,
      Key: key,
      ProjectionExpression: '#attrName',
      ExpressionAttributeNames: {
        '#attrName': this.attributeName,
      },
      ReturnConsumedCapacity: 'TOTAL',
    };

    const response = await this.client.getItem(input);
    logger?.debug(
      '[fetch] GetItem consumed capacity',
      response.ConsumedCapacity
    );

    if (response.Item === undefined) {
      logger?.debug('Item not found', key);
      return undefined;
    }

    const b = response.Item[this.attributeName].B;
    return b ? Buffer.from(b) : undefined;
  }

  // ---

  async delete(
    key: DynamoDbDeletionKey,
    logger: Logger | undefined
  ): Promise<void> {
    const keysToDelete = await this.listKeysToDelete(key, logger);

    switch (this.deletionOption) {
      case 'DELETE_ITEM':
        await this.deleteItems(keysToDelete, logger);
        break;
      case 'DELETE_ATTRIBUTE':
        await this.deleteAttributes(keysToDelete, logger);
        break;
    }
  }

  private async listKeysToDelete(
    key: DynamoDbDeletionKey,
    logger: Logger | undefined
  ): Promise<DynamoDbKey[]> {
    const keyAttributeNames = Object.values(key.ExpressionAttributeNames);

    const input: QueryCommandInput = {
      TableName: this.tableName,
      ProjectionExpression: keyAttributeNames.join(','),
      ...key,
      ReturnConsumedCapacity: 'TOTAL',
    };

    const response = await this.client.query(input);
    logger?.debug(
      '[delete] Query consumed capacity',
      response.ConsumedCapacity
    );

    const items = response.Items ?? [];
    if (items.length === 0) {
      logger?.warn('No items found to be deleted');
      return [];
    }

    return items.map(item => this.keyGenerator.extractKeyFrom(item));
  }

  private async deleteItems(
    keys: DynamoDbKey[],
    logger: Logger | undefined
  ): Promise<void> {
    const BATCH_WRITE_ITEM_MAX_ITEMS = 25;

    const promises: Promise<void>[] = [];
    for (let i = 0; i < keys.length; i += BATCH_WRITE_ITEM_MAX_ITEMS) {
      const chunk = keys.slice(i, i + BATCH_WRITE_ITEM_MAX_ITEMS);

      const input: BatchWriteItemCommandInput = {
        RequestItems: Object.fromEntries([
          [this.tableName, chunk.map(key => ({DeleteRequest: {Key: key}}))],
        ]),
        ReturnConsumedCapacity: 'TOTAL',
      };

      const promise = this.client
        .batchWriteItem(input)
        .then(
          res =>
            logger?.debug(
              '[delete] BatchWriteItem consumed capacity',
              res.ConsumedCapacity
            )
        );

      promises.push(promise);
    }

    await Promise.all(promises);
  }

  private async deleteAttributes(
    keys: DynamoDbKey[],
    logger: Logger | undefined
  ): Promise<void> {
    const promises = [];
    for (const key of keys) {
      const input: UpdateItemCommandInput = {
        TableName: this.tableName,
        Key: key,
        UpdateExpression: 'REMOVE #attrName',
        ExpressionAttributeNames: {
          '#attrName': this.attributeName,
        },
        ReturnConsumedCapacity: 'TOTAL',
      };

      const promise = this.client
        .updateItem(input)
        .then(
          res =>
            logger?.debug(
              '[delete] UpdateItem consumed capacity',
              res.ConsumedCapacity
            )
        );

      promises.push(promise);
    }

    await Promise.all(promises);
  }
}

export class DynamoDbInstallationStore extends InstallationStoreBase<
  DynamoDbKey,
  DynamoDbDeletionKey
> {
  constructor(
    clientId: string,
    keyGenerator: DynamoDbKeyGenerator,
    storage: Promise<DynamoDbStorage>,
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
    dynamoDb: Promise<DynamoDB> | DynamoDB;
    tableName: string;
    partitionKeyName: string;
    sortKeyName: string;
    attributeName: string;
    deletionOption?: DeletionOption;
    options?: {
      historicalDataEnabled?: boolean;
      installationCodec?: InstallationCodec;
    };
  }): DynamoDbInstallationStore {
    const keyGenerator = SimpleKeyGenerator.create(
      args.partitionKeyName,
      args.sortKeyName
    );
    const storage = DynamoDbStorage.create(
      args.dynamoDb,
      args.tableName,
      keyGenerator,
      args.attributeName,
      args.deletionOption
    );

    return new DynamoDbInstallationStore(
      args.clientId,
      keyGenerator,
      storage,
      args.options
    );
  }
}
