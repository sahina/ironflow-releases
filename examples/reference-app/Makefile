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
#   make test-reference-app-live       the live gate + crash proof (in `make ci-full`)
#   make load-reference-app            the opt-in load gate (in no CI gate)

PNPM ?= pnpm
PYTHON ?= python3

# The notification service's own virtualenv. It holds the pinned `ironflow-py`
# wheel from PyPI, and its interpreter is the one scripts/dev.mjs starts.
NOTIFICATIONS_DIR := services/notifications-python
VENV := $(NOTIFICATIONS_DIR)/.venv

.DEFAULT_GOAL := help

.PHONY: help install contracts supervisor apps orders-build orders-test payments-build notifications-install notifications-test lint typecheck build check clean reinstall

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	$(PNPM) install

contracts: ## Validate every fixture against the shared JSON Schemas
	$(PNPM) run test:contracts

supervisor: ## Run the launcher unit tests (scripts/)
	$(PNPM) run test:supervisor

apps: ## Run the test suite of every workspace package that has one
	$(PNPM) --filter "./apps/**" --filter "./services/**" --if-present test

orders-build: ## Build the Go ordering service binary the supervisor starts
	cd services/orders-go && go build -o bin/orders ./cmd/orders

orders-test: ## Vet and test the Go ordering service
	cd services/orders-go && go vet ./... && go test ./...

payments-build: ## Build the Node payment worker the supervisor starts
	$(PNPM) --filter @reference-app/payments build

notifications-install: ## Create the Python virtualenv the supervisor starts the subscriber from
	@$(PYTHON) -m venv $(VENV)
	@$(VENV)/bin/pip install --quiet --upgrade pip
	@$(VENV)/bin/pip install --quiet -e "$(NOTIFICATIONS_DIR)[dev]"

# `cd` first, and deliberately: mypy and ruff look for their configuration in
# the working directory, so running them from here silently ignored
# services/notifications-python/pyproject.toml — which is how a settings-only
# difference between this gate and a contributor's own run got through once.
notifications-test: notifications-install ## Contract, store and delivery tests for the Python subscriber
	@cd $(NOTIFICATIONS_DIR) && .venv/bin/python -m pytest -q
	@cd $(NOTIFICATIONS_DIR) && .venv/bin/ruff check .
	@cd $(NOTIFICATIONS_DIR) && .venv/bin/mypy src

lint: ## Lint every workspace package that defines a lint script
	$(PNPM) run lint

typecheck: ## Typecheck every workspace package that defines a typecheck script
	$(PNPM) run typecheck

build: ## Build every workspace package that defines a build script
	$(PNPM) run build

check: contracts supervisor apps orders-test notifications-test lint typecheck build ## Every workspace-only check; the root fast gate is a subset

clean: ## Remove build output and caches
	rm -rf .data apps/*/.next apps/*/out services/orders-go/bin $(VENV) $(NOTIFICATIONS_DIR)/src/*.egg-info

reinstall: ## Wipe node_modules and reinstall
	rm -rf node_modules apps/*/node_modules services/*/node_modules
	$(PNPM) install
