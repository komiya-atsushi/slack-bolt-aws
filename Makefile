test:
	docker compose up -d
	docker compose exec localstack /home/localstack/wait-for-s3.sh
	npm run test
	docker compose down

.PHONY: test
