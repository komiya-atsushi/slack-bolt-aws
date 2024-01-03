#!/usr/bin/env bash

echo -n "Waiting for s3 service"

until curl -sf 127.0.0.1:4566/_localstack/health | grep -q '"s3": *"running"'; do
  sleep 1
  echo -n "."
done

echo ""
