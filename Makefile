clean:
	rm -rf coverage
	rm -rf packages/bolt-s3/{dist,build}
	rm -rf packages/bolt-dynamodb/{dist,build}

test:
	docker compose up -d
	docker compose exec localstack /home/localstack/wait-for-localstack.sh
	npm run test
	docker compose down

publish:
	npm -w packages/bolt-s3 run build
	npm -w packages/bolt-s3 publish --provenance --access public
	npm -w packages/bolt-dynamodb run build
	npm -w packages/bolt-dynamodb publish --provenance --access public

.PHONY: clean test publish
