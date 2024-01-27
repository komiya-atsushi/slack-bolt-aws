build:
	sam build

deploy:
ifeq ("$(wildcard samconfig.toml)","")
	cp samconfig.example.toml samconfig.toml
	sam deploy --guided
else
	sam deploy
endif

.PHONY: build deploy
