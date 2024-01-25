#!/usr/bin/env bash

echo -n "Waiting for LocalStack (S3)"

until curl -sf 127.0.0.1:4566/_localstack/health | grep -q '"s3": *"running"'; do
  sleep 1
  echo -n "."
done

echo ""

echo -n "Waiting for LocalStack (DynamoDB)"

until curl -sf 127.0.0.1:4566/_localstack/health | grep -q '"dynamodb": *"running"'; do
  sleep 1
  echo -n "."
done

echo ""
