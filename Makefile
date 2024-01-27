test:
	docker compose up -d
	docker compose exec localstack /home/localstack/wait-for-localstack.sh
	npm run test
	docker compose down

publish: test
	npm -w packages/bolt-s3 run compile
	npm -w packages/bolt-s3 publish --provenance --access public
	npm -w packages/bolt-dynamodb run compile
	npm -w packages/bolt-dynamodb publish --provenance --access public

.PHONY: test
