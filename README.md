# AWS integrations for Bolt for JavaScript

[![codecov](https://codecov.io/gh/komiya-atsushi/slack-bolt-aws/graph/badge.svg?token=TXWAYL4LMZ)](https://codecov.io/gh/komiya-atsushi/slack-bolt-aws)

This repository provides several packages to simplify the integration of [Bolt for JavaScript](https://github.com/slackapi/bolt-js) with various AWS services.

- [@k11i/bolt-dynamodb](/packages/bolt-dynamodb) provides an implementation of the `InstallationStore` that uses Amazon DynamoDB as a persistent storage.
- [@k11i/bolt-s3](/packages/bolt-s3) also provides an implementation of the `InstallationStore`, but it uses Amazon S3 as the persistent storage.

All packages are distributed under the MIT License.
