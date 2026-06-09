.PHONY: install install-backend install-frontend dev backend frontend build start \
	fetch-cli lint test clean reinstall \
	bundle-validate bundle-deploy bundle-deploy-prod bundle-run bundle-summary bundle-destroy

TARGET ?= dev
PROFILE ?=
DB_FLAGS = -t $(TARGET) $(if $(PROFILE),--profile $(PROFILE))

install: install-backend install-frontend

install-backend:
	uv sync

install-frontend:
	npm install

dev:
	@$(MAKE) -j2 backend frontend

backend:
	uv run python main.py

frontend:
	npm run dev

build:
	npm run build

# Vendors the linux-amd64 Databricks CLI so the deployed app installs it
# without hitting github.com at runtime. The zip is split into <10MB .part-*
# chunks: Databricks Apps rejects source files over 10MB, and workspace import
# auto-extracts files named *.zip. Re-run to pick up a newer CLI.
fetch-cli:
	mkdir -p vendor
	@VERSION=$$(curl -fsSL https://api.github.com/repos/databricks/cli/releases/latest \
		| python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'].lstrip('v'))"); \
	echo "Fetching Databricks CLI v$$VERSION (linux_amd64)"; \
	rm -f vendor/databricks_cli_*; \
	curl -fsSL -o vendor/cli.zip \
		https://github.com/databricks/cli/releases/download/v$$VERSION/databricks_cli_$${VERSION}_linux_amd64.zip; \
	split -b 9m -a 2 vendor/cli.zip vendor/databricks_cli_$${VERSION}_linux_amd64.zip.part-; \
	rm vendor/cli.zip; \
	ls -lh vendor/

start: build
	uv run python main.py

lint:
	uv run ruff check .

test:
	uv run pytest

clean:
	rm -rf node_modules frontend/node_modules frontend/dist .venv .databricks

reinstall:
	rm -f $$HOME/.lakebridge-app/installed
	@echo "Marker cleared. Next backend start will re-install Databricks CLI + lakebridge."

# Databricks Asset Bundles ---------------------------------------------------
# Default target is dev; override with TARGET=prod and optionally PROFILE=<name>.

bundle-validate: build
	databricks bundle validate $(DB_FLAGS)

bundle-deploy: build
	databricks bundle deploy $(DB_FLAGS)

bundle-deploy-prod:
	@$(MAKE) bundle-deploy TARGET=prod

bundle-run:
	databricks bundle run lakebridge $(DB_FLAGS)

bundle-summary:
	databricks bundle summary $(DB_FLAGS)

bundle-destroy:
	databricks bundle destroy $(DB_FLAGS)
