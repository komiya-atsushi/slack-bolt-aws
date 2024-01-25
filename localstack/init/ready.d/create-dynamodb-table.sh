#!/usr/bin/env bash

awslocal dynamodb create-table \
  --cli-input-json file:///etc/localstack/init/ready.d/data/dynamodb-table.json
