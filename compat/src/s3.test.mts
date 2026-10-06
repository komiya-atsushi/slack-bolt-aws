import {createRequire} from 'node:module';
import {S3Client} from '@aws-sdk/client-s3';
import * as esm from '@k11i/bolt-s3';
import {expect, test} from 'vitest';
import {awsClientConfig, describeInstallationStore} from './scenario.mjs';

// Vitest runs test files as ESM, so load the CJS entry point via require().
const cjs: typeof esm = createRequire(import.meta.url)('@k11i/bolt-s3');

test('CJS and ESM entry points are loaded separately', () => {
  expect(cjs.S3InstallationStore).not.toBe(esm.S3InstallationStore);
});

for (const [format, {BinaryInstallationCodec, S3InstallationStore}] of [
  ['ESM', esm],
  ['CJS', cjs],
] as const) {
  describeInstallationStore(`@k11i/bolt-s3 (${format})`, (clientId) =>
    S3InstallationStore.create({
      clientId,
      s3: new S3Client({...awsClientConfig, forcePathStyle: true}),
      bucketName: 'bolt-s3-test',
      options: {
        installationCodec: BinaryInstallationCodec.createDefault(
          'compat-password',
          'compat-salt',
        ),
      },
    }),
  );
}
