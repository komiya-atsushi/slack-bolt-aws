import {Logger} from '@slack/logger';
import {
  AttributeValue,
  BatchGetItemCommand,
  BatchGetItemCommandInput,
  BatchWriteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  QueryCommandInput,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {InstallationCodec, JsonInstallationCodec} from './InstallationCodec';
import {
  InstallationStoreBase,
  KeyGenerator,
  KeyGeneratorArgs,
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
  readonly keyAttributeNames: string[];

  extractKeyFrom(item: Record<string, AttributeValue>): DynamoDbKey;

  equals(key1: DynamoDbKey, key2: DynamoDbKey): boolean;
}

export class SimpleKeyGenerator implements DynamoDbKeyGenerator {
  readonly keyAttributeNames: string[];

  private constructor(
    private readonly partitionKeyName: string,
    private readonly sortKeyName: string
  ) {
    this.keyAttributeNames = [partitionKeyName, sortKeyName];
  }

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

  equals(key1: DynamoDbKey, key2: DynamoDbKey): boolean {
    const pk1 = key1[this.partitionKeyName]?.S;
    const pk2 = key2[this.partitionKeyName]?.S;
    if (pk1 === undefined || pk2 === undefined || pk1 !== pk2) {
      return false;
    }

    const sk1 = key1[this.sortKeyName]?.S;
    const sk2 = key2[this.sortKeyName]?.S;
    return !(sk1 === undefined || sk2 === undefined || sk1 !== sk2);
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
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
    private readonly keyGenerator: DynamoDbKeyGenerator,
    private readonly attributeName: string,
    private readonly deletionOption: DeletionOption
  ) {
    super();
  }

  static async create(
    client: DynamoDBClient | Promise<DynamoDBClient>,
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
    const response = await this.client.send(
      new UpdateItemCommand({
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
      })
    );

    logger?.debug(
      '[store] UpdateItem consumed capacity',
      response.ConsumedCapacity
    );
  }

  // ---

  async fetch(key: DynamoDbKey, logger?: Logger): Promise<Buffer | undefined> {
    const response = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: key,
        ProjectionExpression: '#attrName',
        ExpressionAttributeNames: {
          '#attrName': this.attributeName,
        },
        ReturnConsumedCapacity: 'TOTAL',
      })
    );

    logger?.debug(
      '[fetch] GetItem consumed capacity',
      response.ConsumedCapacity
    );

    if (response.Item === undefined) {
      logger?.debug('Item not found', key);
      return undefined;
    }

    return this.extractInstallation(response.Item);
  }

  private extractInstallation(
    item: Record<string, AttributeValue>
  ): Buffer | undefined {
    const b = item[this.attributeName]?.B;
    return b ? Buffer.from(b) : undefined;
  }

  // ---

  async fetchMultiple(
    keys: DynamoDbKey[],
    logger: Logger | undefined
  ): Promise<(Buffer | undefined)[]> {
    if (keys.length === 1) {
      return [await this.fetch(keys[0], logger)];
    }

    const entries = this.keyGenerator.keyAttributeNames.map(
      (attrName, index) => {
        return [`#key${index}`, attrName];
      }
    );

    const input: BatchGetItemCommandInput = {
      RequestItems: Object.fromEntries([
        [
          this.tableName,
          {
            Keys: keys,
            ProjectionExpression: `#inst, ${entries
              .map(([expAttrName]) => expAttrName)
              .join(', ')}`,
            ExpressionAttributeNames: {
              '#inst': this.attributeName,
              ...Object.fromEntries(entries),
            },
          },
        ],
      ]),
      ReturnConsumedCapacity: 'TOTAL',
    };

    const response = await this.client.send(new BatchGetItemCommand(input));
    logger?.debug(
      '[fetchMultiple] BatchGetItem consumed capacity',
      response.ConsumedCapacity
    );

    if (
      response.Responses === undefined ||
      response.Responses[this.tableName] === undefined
    ) {
      return [];
    }
    const items = response.Responses[this.tableName];

    const result: (Buffer | undefined)[] = [];

    for (const key of keys) {
      let found: Record<string, AttributeValue> | undefined;
      for (const item of items) {
        const keyFromItem = this.keyGenerator.extractKeyFrom(item);
        if (this.keyGenerator.equals(keyFromItem, key)) {
          found = item;
          break;
        }
      }

      if (found) {
        result.push(this.extractInstallation(found));
      } else {
        logger?.debug('Item not found', key);
        result.push(undefined);
      }
    }

    return result;
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

    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        ProjectionExpression: keyAttributeNames.join(','),
        ...key,
        ReturnConsumedCapacity: 'TOTAL',
      })
    );

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

      const promise = this.client
        .send(
          new BatchWriteItemCommand({
            RequestItems: Object.fromEntries([
              [this.tableName, chunk.map(key => ({DeleteRequest: {Key: key}}))],
            ]),
            ReturnConsumedCapacity: 'TOTAL',
          })
        )
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
      const promise = this.client
        .send(
          new UpdateItemCommand({
            TableName: this.tableName,
            Key: key,
            UpdateExpression: 'REMOVE #attrName',
            ExpressionAttributeNames: {
              '#attrName': this.attributeName,
            },
            ReturnConsumedCapacity: 'TOTAL',
          })
        )
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
    dynamoDb: Promise<DynamoDBClient> | DynamoDBClient;
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
