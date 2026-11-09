.DEFAULT_GOAL := help
SHELL := /bin/bash

PLUGIN_UUID  := com.robertw.fs24
SDPLUGIN_DIR := $(PLUGIN_UUID).sdPlugin
MAIN_BRANCH  := main
STREAMDECK   := npx --no-install streamdeck

.PHONY: help setup build deploy clean distclean test lint lint-fix format format-check check icons package cleanup_branches

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "; printf "Available targets:\n"} \
		/^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Install npm dependencies
	npm install

build: ## Compile TypeScript via rollup into <plugin>/bin/plugin.js
	npm run build

deploy: build ## Build, then restart the plugin in the Stream Deck app
	$(STREAMDECK) restart $(PLUGIN_UUID)

clean: ## Remove build output (bin, logs, packed plugin, generated icons) — keeps node_modules
	rm -rf $(SDPLUGIN_DIR)/bin $(SDPLUGIN_DIR)/logs
	rm -f $(PLUGIN_UUID).streamDeckPlugin
	rm -rf out

distclean: clean ## Like clean, plus wipe node_modules
	rm -rf node_modules

test: ## Type-check the source
	npx tsc --noEmit

lint: ## Run Biome lint + format check (read-only)
	npm run --silent lint

lint-fix: ## Apply safe lint fixes
	npm run --silent lint:fix

format: ## Format all sources in place via Biome
	npm run --silent format

format-check: ## Check formatting without writing
	npm run --silent format:check

check: lint test ## Run lint + type-check — required before every commit

icons: ## Generate button icons from scripts/icons/catalog.ts into out/icons/
	npm run --silent icons

package: build ## Build a distributable .streamDeckPlugin
	$(STREAMDECK) pack -f $(SDPLUGIN_DIR)

cleanup_branches: ## Delete local branches already merged into main
	git fetch --prune origin
	@git branch --merged $(MAIN_BRANCH) --format='%(refname:short)' \
		| grep -vE '^($(MAIN_BRANCH))$$' \
		| xargs -r -n1 git branch -d
