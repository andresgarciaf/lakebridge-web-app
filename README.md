# lakebridge-app

Vite + React frontend with a Flask backend. On first use the backend downloads
the latest Databricks CLI to `~/bin/databricks` and installs the lakebridge
labs project. Subsequent runs skip the install (gated by
`~/.lakebridge-app/installed`).

## Layout

```
backend/          Flask app + installer
frontend/         Vite + React + TS + Tailwind (index.html, vite.config.ts, tsconfig.json, src/, public/)
main.py           Local dev entrypoint (Flask built-in server)
app.yml           Databricks Apps manifest (gunicorn command)
databricks.yml    Databricks Asset Bundle (DAB) config
pyproject.toml    Python deps (uv) — the Apps runtime installs them via `uv sync` from uv.lock
Makefile          Dev + deploy targets
tests/            API smoke tests
```

## Local development

```sh
make install   # uv sync + npm install
make dev       # backend (:8000) + Vite dev (:5173) in parallel
```

Open <http://localhost:5173>. While the CLI + lakebridge install runs you see
a progress screen; once ready the Home view renders.

Single-process production-style run (Flask serves the built SPA):

```sh
make start     # build frontend, then run on :8000
```

Checks and one-offs:

```sh
make lint      # ruff
make test      # pytest
make reinstall # clear ~/.lakebridge-app/installed → re-run install on next boot
make clean     # remove node_modules / dist / .venv / .databricks
```

## Deploy to Databricks (Asset Bundle + Apps)

The frontend is built **locally** before every deploy; only `frontend/dist`
plus the Python backend, `pyproject.toml`, `uv.lock`, and `app.yml` are
uploaded. Node manifests are excluded from sync so the Apps runtime treats the
app as a plain Python app: it installs dependencies with `uv sync` from the
lockfile and runs the gunicorn command from `app.yml` — no npm install at
container start.

1. Edit `databricks.yml` and set `workspace.host` for `dev` and `prod` targets.
2. Authenticate the Databricks CLI: `databricks auth login --host https://<workspace>`.
3. Build, validate, deploy, and start (default target: `dev`):

   ```sh
   make bundle-validate     # builds frontend, validates config
   make bundle-deploy       # builds frontend, deploys the bundle
   make bundle-run          # deploys the app source code and starts the App
   make bundle-summary      # show resources incl. the App URL
   ```

4. Promote to prod with `make bundle-deploy-prod` (or pass `TARGET=prod` to
   any bundle target). Use `PROFILE=<name>` to select a CLI auth profile.

### Caveats on the Apps runtime

- The first-use install fetches the Databricks CLI from GitHub releases at
  `api.github.com`. If the workspace blocks egress, that call fails and the
  setup screen shows the error. Either allow egress or pre-bundle the CLI
  binary with the app source.
- App containers are stateless — the install marker lives in `~/.lakebridge-app/`
  inside the container, so the install repeats after every restart unless you
  persist it (e.g. to a volume mount).
- gunicorn runs a single worker (install state is in-process) with threads for
  concurrent SSE streams.

## Endpoints

- `GET  /api/status` — install status + last 500 log lines (first call kicks off the install)
- `GET  /api/env`    — python / java / databricks / lakebridge versions + host
- `POST /api/upload` — multipart `files`; saves to a per-job input dir and
  returns `{job_id, input_dir, output_dir, files}`
- `GET  /api/reconcile/status` — reconcile deployment state (config, job id, table config)
- `POST /api/reconcile/setup` — deploys lakebridge reconcile (job, metadata, dashboards)
  via a non-interactive driver in the lakebridge venv; streams progress as SSE
- `POST /api/reconcile/table-config` — uploads the table mappings JSON to the
  workspace path the Reconciliation job reads
- `POST /api/reconcile/run` — triggers the Reconciliation job
  (`reconcile` or `aggregates-reconcile`) and streams until completion
- `POST /api/profiler/configure` — writes the lakebridge profiler credentials
  file (`~/.databricks/labs/lakebridge/.credentials.yml`). Body: `{"source":
  "mssql", "server": ..., "port": ..., "user": ..., "password": ...}`.
- `POST /api/run/<command>` — runs the matching `databricks labs lakebridge`
  command, streaming stdout as Server-Sent Events. Commands: `analyzer`
  (analyze), `converter` (transpile), `llm-converter` (llm-transpile via
  Switch), `profiler-test` (test-profiler-connection), `profiler-run`
  (execute-database-profiler). Body: `{"args": [...], "job_id": "..."}`.
  On success, results land in `/Shared/lakebridge-app/results/...` (job
  outputs, profiler extracts) or directly in the `--output-ws-folder` for the
  LLM converter, and an `event: results` SSE event carries the workspace paths.

## Container setup (first use)

On the first `/api/status` call inside the Apps container the backend installs,
in order: the Databricks CLI (from vendored split parts, see `make fetch-cli`),
a Temurin JRE 17 (`make fetch-jre`, required by the Morpheus transpiler),
unixODBC + MS ODBC Driver 18 (`make fetch-odbc`, required by the SQL Server
and Azure Synapse profilers), lakebridge itself, and the transpilers including the Switch LLM
transpiler (`install-transpile --interactive false --include-llm-transpiler
true`, which deploys the Switch job to the workspace).

## Unity Catalog prerequisites

After setup the UI checks (and tries to create) catalog `lakebridge`, schemas
`switch` / `analyzer` / `transpile`, and volume `lakebridge.switch.switch_volume`,
then verifies the app service principal can use them with functional probes
(`GET /api/uc-status`). If anything is missing the UI shows the exact
CREATE/GRANT SQL for an admin to run, with a recheck button; Analyzer and
standard conversion work without UC access.
