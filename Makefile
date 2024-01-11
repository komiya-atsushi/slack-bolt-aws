test:
	docker compose up -d
	docker compose exec localstack /home/localstack/wait-for-s3.sh
	npm run test
	docker compose down

publish: test
	cp README.md LICENSE packages/bolt-s3/
	npm -w packages/bolt-s3 publish --provenance --access public

.PHONY: test
