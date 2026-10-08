import {createRequire} from 'node:module';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import * as esm from '@k11i/bolt-dynamodb';
import {expect, test} from 'vitest';
import {awsClientConfig, describeInstallationStore} from './scenario.mjs';

// Vitest runs test files as ESM, so load the CJS entry point via require().
const cjs: typeof esm = createRequire(import.meta.url)('@k11i/bolt-dynamodb');

test('CJS and ESM entry points are loaded separately', () => {
  expect(cjs.DynamoDbInstallationStore).not.toBe(esm.DynamoDbInstallationStore);
});

for (const [format, {DynamoDbInstallationStore}] of [
  ['ESM', esm],
  ['CJS', cjs],
] as const) {
  describeInstallationStore(`@k11i/bolt-dynamodb (${format})`, (clientId) =>
    DynamoDbInstallationStore.create({
      clientId,
      dynamoDb: new DynamoDBClient(awsClientConfig),
      tableName: 'TestTable',
      partitionKeyName: 'PK',
      sortKeyName: 'SK',
      attributeName: 'Installation',
    }),
  );
}
