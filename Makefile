.DEFAULT_GOAL := help
SHELL := /bin/bash

PLUGIN_UUID  := com.robertw.fs24
SDPLUGIN_DIR := $(PLUGIN_UUID).sdPlugin
MAIN_BRANCH  := main
STREAMDECK   := npx --no-install streamdeck

.PHONY: help setup build deploy clean distclean test lint lint-fix format format-check check icons package gh-build cleanup_branches cleanup_builds sdk wasm wasm-package wasm-probes bridge-ping

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
	$(MAKE) -C wasm clean

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

sdk: ## Download the MSFS 2024 SDK subset for the WASM build into sdk/ (needs msitools)
	scripts/fetch-sdk.sh

wasm: ## Compile the WASM bridge (wasm/build/*.wasm)
	$(MAKE) -C wasm

wasm-package: wasm ## Assemble the bridge Community package in wasm/out/
	npx --no-install tsx scripts/build-bridge-package.ts

wasm-probes: ## Build loader-probe packages in wasm/out/ (M03 diagnosis)
	$(MAKE) -C wasm probes
	@for p in fs24-probe-empty24 fs24-probe-empty20 fs24-probe-bridge20; do \
		npx --no-install tsx scripts/build-bridge-package.ts $$p || exit 1; done

bridge-ping: ## Smoke-test the bridge over SimConnect (FS24_HOST, FS24_PORT, FS24_HEVENT, FS24_RPN)
	npx --no-install tsx scripts/bridge-ping.ts

package: build ## Build a distributable .streamDeckPlugin
	$(STREAMDECK) pack -f $(SDPLUGIN_DIR)

gh-build: ## Run the GitHub build (manual workflow) on origin/main, wait, print the artifact link
	@test -z "$$(git status --porcelain)" || { echo "Uncommitted changes — commit first."; exit 1; }
	@git fetch -q origin $(MAIN_BRANCH)
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/$(MAIN_BRANCH))" || { echo "Local HEAD differs from origin/$(MAIN_BRANCH) — push first."; exit 1; }
	gh workflow run build.yml --ref $(MAIN_BRANCH)
	@sleep 5
	@id=$$(gh run list --workflow build.yml --limit 1 --json databaseId -q '.[0].databaseId'); \
		gh run watch $$id --exit-status && \
		echo "Artifact: $$(gh run view $$id --json url -q .url) → Artifacts"

cleanup_builds: ## Delete all GitHub Actions runs except the latest one per workflow
	@ids=$$(gh run list --limit 1000 --json databaseId,workflowName,createdAt \
		-q 'group_by(.workflowName) | map(sort_by(.createdAt) | reverse | .[1:]) | flatten | .[].databaseId'); \
	if [ -z "$$ids" ]; then echo "Nothing to delete."; exit 0; fi; \
	echo "Deleting $$(echo "$$ids" | wc -l | tr -d ' ') run(s)…"; \
	for id in $$ids; do gh run delete $$id >/dev/null && echo "  deleted $$id"; done

cleanup_branches: ## Delete local branches already merged into main
	git fetch --prune origin
	@git branch --merged $(MAIN_BRANCH) --format='%(refname:short)' \
		| grep -vE '^($(MAIN_BRANCH))$$' \
		| xargs -r -n1 git branch -d
