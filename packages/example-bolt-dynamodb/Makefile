build:
	sam build --build-in-source

# Invoked by `sam build` (BuildMethod: makefile in template.yaml). With
# --build-in-source, this runs in this directory, so it bundles the packages
# in this repository's workspace; run `npm run build` in the root beforehand.
build-SlackEventReceiver:
	npx rolldown src/index.ts --platform node --format cjs --sourcemap \
		--no-codeSplitting -o $(ARTIFACTS_DIR)/index.js

deploy:
ifeq ("$(wildcard samconfig.toml)","")
	cp samconfig.example.toml samconfig.toml
	sam deploy --guided
else
	sam deploy
endif

.PHONY: build build-SlackEventReceiver deploy
