import {Logger} from '@slack/logger';
import {Installation, InstallationQuery, InstallationStore} from '@slack/oauth';
import {InstallationCodec} from './InstallationCodec';

export interface KeyGeneratorArgs {
  clientId: string;
  enterpriseId: string | undefined;
  teamId: string | undefined;
  userId: string | undefined;
}

export interface KeyGenerator<KEY, KEY_FOR_DELETION> {
  generate(args: KeyGeneratorArgs & {historyVersion?: string}): KEY;
  generateForDeletion(args: KeyGeneratorArgs): KEY_FOR_DELETION;
}

export interface Storage<KEY, KEY_FOR_DELETION> {
  store(
    key: KEY,
    data: Buffer,
    isBotToken: boolean,
    logger: Logger | undefined
  ): Promise<void>;
  fetch(key: KEY, logger: Logger | undefined): Promise<Buffer | undefined>;
  fetchMultiple(
    keys: KEY[],
    logger: Logger | undefined
  ): Promise<(Buffer | undefined)[]>;
  delete(key: KEY_FOR_DELETION, logger: Logger | undefined): Promise<void>;
}

export abstract class StorageBase<KEY, KEY_FOR_DELETION>
  implements Storage<KEY, KEY_FOR_DELETION>
{
  abstract store(
    key: KEY,
    data: Buffer,
    isBotToken: boolean,
    logger: Logger | undefined
  ): Promise<void>;
  abstract fetch(
    key: KEY,
    logger: Logger | undefined
  ): Promise<Buffer | undefined>;
  abstract delete(
    key: KEY_FOR_DELETION,
    logger: Logger | undefined
  ): Promise<void>;

  async fetchMultiple(
    keys: KEY[],
    logger: Logger | undefined
  ): Promise<(Buffer | undefined)[]> {
    return await Promise.all(keys.map(key => this.fetch(key, logger)));
  }
}

export class InstallationStoreBase<KEY, KEY_FOR_DELETION>
  implements InstallationStore
{
  constructor(
    private readonly clientId: string,
    private readonly keyGenerator: KeyGenerator<KEY, KEY_FOR_DELETION>,
    private readonly storage: Promise<Storage<KEY, KEY_FOR_DELETION>>,
    private readonly codec: InstallationCodec,
    private readonly historicalDataEnabled: boolean
  ) {}

  async storeInstallation<AuthVersion extends 'v1' | 'v2'>(
    installation: Installation<AuthVersion, boolean>,
    logger?: Logger
  ): Promise<void> {
    const argsForBot: KeyGeneratorArgs & {historyVersion?: string} = {
      clientId: this.clientId,
      enterpriseId: installation.enterprise?.id,
      teamId: installation.team?.id,
      userId: undefined,
    };
    const argsForUser = {
      ...argsForBot,
      userId: installation.user.id,
    };

    const data = this.codec.encode(installation);
    const storage = await this.storage;

    const promises: Promise<void>[] = [
      storage.store(this.keyGenerator.generate(argsForBot), data, true, logger),
      storage.store(
        this.keyGenerator.generate(argsForUser),
        data,
        false,
        logger
      ),
    ];

    if (this.historicalDataEnabled) {
      const historyVersion = Date.now().toString();
      promises.push(
        storage.store(
          this.keyGenerator.generate({...argsForBot, historyVersion}),
          data,
          true,
          logger
        ),
        storage.store(
          this.keyGenerator.generate({...argsForUser, historyVersion}),
          data,
          false,
          logger
        )
      );
    }

    await Promise.all(promises);
  }

  async fetchInstallation(
    query: InstallationQuery<boolean>,
    logger?: Logger
  ): Promise<Installation<'v1' | 'v2', boolean>> {
    const args: KeyGeneratorArgs = {
      clientId: this.clientId,
      enterpriseId: query.enterpriseId,
      teamId: query.teamId,
      userId: undefined,
    };
    const keys: KEY[] = [this.keyGenerator.generate(args)];

    if (query.userId) {
      keys.push(this.keyGenerator.generate({...args, userId: query.userId}));
    }

    const storage = await this.storage;
    const [app, user] = (await storage.fetchMultiple(keys, logger)).map(data =>
      data ? this.codec.decode(data) : undefined
    );

    if (app !== undefined) {
      if (user !== undefined) {
        app.user = user.user;
      } else {
        delete app.user.token;
        delete app.user.refreshToken;
        delete app.user.expiresAt;
        delete app.user.scopes;
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
    const key = this.keyGenerator.generateForDeletion({
      clientId: this.clientId,
      enterpriseId: query.enterpriseId,
      teamId: query.teamId,
      userId: query.userId,
    });

    const storage = await this.storage;
    await storage.delete(key, logger);
  }
}
