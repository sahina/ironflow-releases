# ironflow reference app — common targets
# Usage: make <target>
#
# These cover this workspace only. The whole-system commands live in the
# repository root Makefile, because the two that start a server build the
# engine first:
#
#   make reference-app                 build and run everything
#   make reference-app-crash-payment   crash and restart only the payment worker
#   make reference-app-reset           delete this example's .data and nothing else
#   make test-reference-app            the fast gate (also reached by `make ci`)
#   make test-reference-app-live       the live gate (in `make ci-full`)

PNPM ?= pnpm

.DEFAULT_GOAL := help

.PHONY: help install contracts supervisor lint typecheck build check clean reinstall

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	$(PNPM) install

contracts: ## Validate every fixture against the shared JSON Schemas
	$(PNPM) run test:contracts

supervisor: ## Run the launcher unit tests (scripts/)
	$(PNPM) run test:supervisor

lint: ## Lint every workspace package that defines a lint script
	$(PNPM) run lint

typecheck: ## Typecheck every workspace package that defines a typecheck script
	$(PNPM) run typecheck

build: ## Build every workspace package that defines a build script
	$(PNPM) run build

check: contracts supervisor lint typecheck build ## Every workspace-only check; the root fast gate is a subset

clean: ## Remove build output and caches
	rm -rf .data apps/*/.next apps/*/out

reinstall: ## Wipe node_modules and reinstall
	rm -rf node_modules apps/*/node_modules services/*/node_modules
	$(PNPM) install
