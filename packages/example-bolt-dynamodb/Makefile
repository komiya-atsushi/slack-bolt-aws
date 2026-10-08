build:
	sam build --build-in-source

# Invoked by `sam build` (BuildMethod: makefile in template.yaml). With
# --build-in-source, this runs in this directory, so it bundles the packages
# in this repository's workspace; run `npm run build` in the root beforehand.
build-SlackEventReceiver:
	npx rolldown src/index.ts --platform node --format cjs --sourcemap \
		--no-codeSplitting -o $(ARTIFACTS_DIR)/index.js

TEST_RESPONSE = .aws-sam/test-response.json

# Invokes the built function in the Lambda runtime image (requires Docker) with
# the dummy environment variables in events/env.json, and checks that
# GET /slack/install redirects to the authorization URL of Slack.
test: build
	sam local invoke SlackEventReceiver --event events/get-slack-install.json \
		--env-vars events/env.json > $(TEST_RESPONSE)
	@grep -Eq '"statusCode": ?302' $(TEST_RESPONSE) \
		&& grep -q 'https://slack.com/oauth/v2/authorize?[^"]*client_id=test-client-id' $(TEST_RESPONSE) \
		|| (echo 'Unexpected response:'; cat $(TEST_RESPONSE); exit 1)
	@echo 'OK: GET /slack/install redirects to the authorization URL of Slack'

deploy:
ifeq ("$(wildcard samconfig.toml)","")
	cp samconfig.example.toml samconfig.toml
	sam deploy --guided
else
	sam deploy
endif

.PHONY: build build-SlackEventReceiver test deploy
