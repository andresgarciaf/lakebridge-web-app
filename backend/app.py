import json
import logging
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from configparser import ConfigParser
from pathlib import Path
from typing import Any, Callable

import yaml
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename

from .installer import CLI_PATH, cli_env, ensure_installed, is_installed

logging.getLogger("werkzeug").setLevel(logging.WARNING)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

# Static handling is done by the spa() catch-all; Flask's static route would
# shadow it and 404 on client-side routes.
app = Flask(__name__, static_folder=None)
# CORS is only needed for the Vite dev server; in production the SPA is same-origin.
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"])
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

JOBS_DIR = Path.home() / ".lakebridge-app" / "jobs"
RESULTS_WORKSPACE_BASE = "/Shared/lakebridge-app"
RESULTS_WORKSPACE_DIR = f"{RESULTS_WORKSPACE_BASE}/results"


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "unknown"


def _arg_value(args: list[str], flag: str) -> str | None:
    if flag in args:
        idx = args.index(flag)
        if idx + 1 < len(args):
            return args[idx + 1]
    return None


def _results_base(command: str, args: list[str]) -> str:
    # Outputs are grouped by utility and source technology:
    #   analyzer/<tech>, profiler/<tech>, morpheus-bb/<dialect>, switch/<dialect>
    if command == "analyzer":
        return f"{RESULTS_WORKSPACE_BASE}/analyzer/{_slug(_arg_value(args, '--source-tech') or 'unknown')}"
    if command == "converter":
        return f"{RESULTS_WORKSPACE_BASE}/morpheus-bb/{_slug(_arg_value(args, '--source-dialect') or 'unknown')}"
    return RESULTS_WORKSPACE_DIR
JOB_ID_RE = re.compile(r"^[0-9a-f]{12}$")
CRED_FILE = Path.home() / ".databricks" / "labs" / "lakebridge" / ".credentials.yml"
PROFILER_DATA_DIR = Path("/tmp/data")
TRANSPILERS_DIR = Path.home() / ".databricks" / "labs" / "remorph-transpilers"
LABS_VENV_DIR = Path.home() / ".databricks" / "labs" / "lakebridge" / "state" / "venv"

MAX_LOG_LINES = 1000

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _clean_line(line: str) -> str:
    return ANSI_RE.sub("", line.rstrip())


def _proc_lines(proc: subprocess.Popen, keepalive_seconds: int = 15):
    # Yields stdout lines; emits None during quiet stretches so SSE streams
    # can send keepalives (the Apps proxy times out idle connections).
    lines: queue.Queue[str | None] = queue.Queue()

    def pump():
        assert proc.stdout is not None
        for line in iter(proc.stdout.readline, ""):
            lines.put(line)
        lines.put(None)

    threading.Thread(target=pump, daemon=True).start()
    while True:
        try:
            line = lines.get(timeout=keepalive_seconds)
        except queue.Empty:
            yield None
            continue
        if line is None:
            return
        yield line

_state_lock = threading.Lock()
_install_state: dict[str, Any] = {
    "status": "pending",
    "logs": [],
    "error": None,
}
_install_started = False


def _append_log(line: str) -> None:
    with _state_lock:
        _install_state["logs"].append(_clean_line(line))
        del _install_state["logs"][:-MAX_LOG_LINES]


def _run_install() -> None:
    with _state_lock:
        _install_state["status"] = "running"
    try:
        ensure_installed(_append_log)
        with _state_lock:
            _install_state["status"] = "ready"
    except Exception as exc:  # noqa: BLE001
        with _state_lock:
            _install_state["status"] = "error"
            _install_state["error"] = str(exc)
            _install_state["logs"].append(f"ERROR: {exc}")


def kickoff_install() -> None:
    global _install_started
    with _state_lock:
        if _install_started:
            return
        _install_started = True
    if is_installed():
        with _state_lock:
            _install_state["status"] = "ready"
            if not _install_state["logs"]:
                _install_state["logs"].append("Setup already completed.")
        return
    threading.Thread(target=_run_install, daemon=True).start()


def _check_output(cmd: list[str], timeout: int = 8) -> str:
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=cli_env(),
        )
        return (out.stdout or out.stderr).strip()
    except Exception:  # noqa: BLE001
        return ""


def _python_version() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def _java_version() -> str:
    raw = _check_output(["java", "-version"])
    match = re.search(r'version "([^"]+)"', raw) or re.search(r"openjdk (\S+)", raw)
    return match.group(1) if match else ""


def _databricks_version() -> str:
    if not CLI_PATH.exists():
        return ""
    raw = _check_output([str(CLI_PATH), "--version"])
    match = re.search(r"v?(\d+\.\d+\.\d+)", raw)
    return match.group(1) if match else raw


def _lakebridge_version() -> str:
    version_file = Path.home() / ".databricks" / "labs" / "lakebridge" / "state" / "version.json"
    try:
        version = json.loads(version_file.read_text()).get("version", "")
    except (OSError, ValueError):
        return ""
    match = re.search(r"(\d+\.\d+\.\d+)", version)
    return match.group(1) if match else version


def _workspace_host() -> str:
    env_host = os.environ.get("DATABRICKS_HOST")
    if env_host:
        return _strip_host(env_host)
    cfg_path = Path.home() / ".databrickscfg"
    if not cfg_path.exists():
        return ""
    parser = ConfigParser()
    try:
        parser.read(cfg_path)
    except Exception:  # noqa: BLE001
        return ""
    profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
    if not parser.has_section(profile) and parser.has_section("DEFAULT"):
        profile = "DEFAULT"
    if not parser.has_option(profile, "host"):
        return ""
    return _strip_host(parser.get(profile, "host"))


def _strip_host(value: str) -> str:
    return re.sub(r"^https?://", "", value).rstrip("/")


@app.get("/api/status")
def status():
    kickoff_install()
    with _state_lock:
        return jsonify(
            {
                "status": _install_state["status"],
                "logs": _install_state["logs"][-500:],
                "error": _install_state["error"],
                "cli_path": str(CLI_PATH),
            }
        )


# Standard Unity Catalog layout provisioned for the app.
UC_CATALOG = "lakebridge"
UC_SCHEMA_PRIVILEGES = ["USE_SCHEMA", "CREATE_TABLE", "CREATE_VOLUME", "SELECT", "MODIFY"]
UC_SCHEMAS = ["analyzer", "profiler", "converter", "reconciler"]
UC_VOLUMES = [
    ("converter", "switch"),
    ("converter", "morpheus_bb"),
    ("reconciler", "reconcile_volume"),
]
# Switch stages uploads here; reconcile metadata lands in lakebridge.reconciler.
UC_SWITCH_SCHEMA = "converter"
UC_SWITCH_VOLUME = "switch"


def _uc_cli(args: list[str]) -> tuple[bool, str]:
    proc = subprocess.run(
        [str(CLI_PATH), *args, "-o", "json"],
        capture_output=True,
        text=True,
        timeout=60,
        env=cli_env(),
    )
    out = proc.stdout if proc.returncode == 0 else (proc.stderr or proc.stdout)
    return proc.returncode == 0, out.strip()


def _app_principal() -> str:
    return os.environ.get("DATABRICKS_CLIENT_ID", "")


def _probe_volume_write(schema: str, volume: str) -> bool:
    probe = f"dbfs:/Volumes/{UC_CATALOG}/{schema}/{volume}/.lakebridge-app-probe"
    ok, _ = _uc_cli(["fs", "mkdir", probe])
    if ok:
        _uc_cli(["fs", "rm", "-r", probe])
    return ok


def _check_uc_object(
    securable: str,
    full_name: str,
    get_args: list[str],
    create_args: list[str],
    probe: Callable[[], bool],
    required: list[str],
) -> dict[str, Any]:
    # A grantee can't read its own grants, so usability is verified with a
    # functional probe instead of grants get-effective.
    exists, _ = _uc_cli(get_args)
    created = False
    if not exists:
        created, _ = _uc_cli(create_args)
        exists = created or _uc_cli(get_args)[0]
    usable = exists and (created or probe())
    return {
        "type": securable,
        "name": full_name,
        "exists": exists,
        "created": created,
        "missing_privileges": [] if usable else required,
        "ok": usable,
    }


@app.get("/api/uc-status")
def uc_status():
    sp = _app_principal()
    items = [
        _check_uc_object(
            "catalog",
            UC_CATALOG,
            ["catalogs", "get", UC_CATALOG],
            ["catalogs", "create", UC_CATALOG],
            lambda: _uc_cli(["schemas", "list", UC_CATALOG])[0],
            ["USE_CATALOG"],
        )
    ]
    for schema in UC_SCHEMAS:
        items.append(
            _check_uc_object(
                "schema",
                f"{UC_CATALOG}.{schema}",
                ["schemas", "get", f"{UC_CATALOG}.{schema}"],
                ["schemas", "create", schema, UC_CATALOG],
                lambda s=schema: _uc_cli(["tables", "list", UC_CATALOG, s])[0],
                UC_SCHEMA_PRIVILEGES,
            )
        )
    for schema, volume in UC_VOLUMES:
        volume_full = f"{UC_CATALOG}.{schema}.{volume}"
        items.append(
            _check_uc_object(
                "volume",
                volume_full,
                ["volumes", "read", volume_full],
                ["volumes", "create", UC_CATALOG, schema, volume, "MANAGED"],
                lambda s=schema, v=volume: _probe_volume_write(s, v),
                ["READ_VOLUME", "WRITE_VOLUME"],
            )
        )

    fix_sql: list[str] = []
    for item in items:
        kind = item["type"].upper()
        if not item["exists"]:
            if item["type"] == "catalog":
                fix_sql.append(f"CREATE CATALOG IF NOT EXISTS {item['name']};")
            elif item["type"] == "schema":
                fix_sql.append(f"CREATE SCHEMA IF NOT EXISTS {item['name']};")
            else:
                fix_sql.append(f"CREATE VOLUME IF NOT EXISTS {item['name']};")
        if item["missing_privileges"] or not item["exists"]:
            privs = ", ".join(
                (item["missing_privileges"] or ["ALL PRIVILEGES"])
            ).replace("_", " ")
            fix_sql.append(f"GRANT {privs} ON {kind} {item['name']} TO `{sp}`;")

    return jsonify(
        {
            "ok": all(item["ok"] for item in items),
            "principal": sp,
            "items": items,
            "fix_sql": fix_sql,
        }
    )


def _load_lsp_config(cfg_path: Path) -> dict[str, Any]:
    try:
        return yaml.safe_load(cfg_path.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return {}


@app.get("/api/dialects")
def dialects():
    standard: set[str] = set()
    # Required per-dialect transpiler options (e.g. BladeBridge target-tech);
    # without them the CLI falls back to an interactive prompt and EOFs.
    standard_options: dict[str, list[dict[str, Any]]] = {}
    for cfg_path in TRANSPILERS_DIR.glob("*/lib/config.yml"):
        cfg = _load_lsp_config(cfg_path)
        standard.update(cfg.get("remorph", {}).get("dialects", []) or [])
        for dialect, opts in (cfg.get("options") or {}).items():
            if dialect == "all":
                continue
            required = [
                {
                    "flag": o.get("flag"),
                    "prompt": o.get("prompt"),
                    "choices": o.get("choices") or [],
                }
                for o in opts or []
                if o.get("default") != "<none>"
            ]
            if required:
                standard_options[dialect] = required
    switch: list[str] = []
    for cfg_path in LABS_VENV_DIR.glob(
        "lib/python3.*/site-packages/databricks/labs/switch/lsp/config.yml"
    ):
        switch = _load_lsp_config(cfg_path).get("remorph", {}).get("dialects", []) or []
        break
    return jsonify(
        {
            "standard": sorted(standard),
            "switch": sorted(switch),
            "standard_options": standard_options,
        }
    )


LAKEBRIDGE_VENV_PY = (
    Path.home() / ".databricks" / "labs" / "lakebridge" / "state" / "venv" / "bin" / "python3"
)
RECON_DRIVER = Path(__file__).resolve().parent / "recon_driver.py"
RECON_SOURCES = {"databricks", "snowflake", "oracle", "mssql", "synapse", "redshift"}
RECON_REPORTS = {"data", "schema", "row", "all"}


def _lakebridge_ws_folder() -> str:
    return f"/Users/{_app_principal()}/.lakebridge"


def _workspace_read(path: str) -> str | None:
    proc = subprocess.run(
        [str(CLI_PATH), "workspace", "export", path],
        capture_output=True,
        text=True,
        timeout=60,
        env=cli_env(),
    )
    return proc.stdout if proc.returncode == 0 else None


def _recon_config() -> dict[str, Any] | None:
    raw = _workspace_read(f"{_lakebridge_ws_folder()}/reconcile.yml")
    if raw is None:
        return None
    try:
        return yaml.safe_load(raw) or None
    except yaml.YAMLError:
        return None


def _recon_job_id() -> str | None:
    raw = _workspace_read(f"{_lakebridge_ws_folder()}/state.json")
    if raw is None:
        return None
    try:
        return json.loads(raw).get("resources", {}).get("jobs", {}).get("Reconciliation Runner")
    except ValueError:
        return None


def _recon_table_config_name(config: dict[str, Any]) -> str:
    source = config.get("source", {})
    connection_or_catalog = source.get("uc_connection_name") or source.get("catalog")
    return f"recon_config_{source.get('dialect')}_{connection_or_catalog}_{config.get('report_type')}.json"


def _stream_subprocess(cmd: list[str]) -> Response:
    env = cli_env()

    def generate():
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            bufsize=1,
        )
        try:
            for line in _proc_lines(proc):
                if line is None:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {_clean_line(line)}\n\n"
        finally:
            proc.wait()
            yield f"event: end\ndata: {proc.returncode}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


@app.get("/api/reconcile/status")
def reconcile_status():
    config = _recon_config()
    job_id = _recon_job_id()
    table_config_path = None
    table_config_exists = False
    if config:
        table_config_path = f"{_lakebridge_ws_folder()}/{_recon_table_config_name(config)}"
        table_config_exists = _workspace_read(table_config_path) is not None
    return jsonify(
        {
            "configured": bool(config and job_id),
            "config": config,
            "job_id": job_id,
            "table_config_path": table_config_path,
            "table_config_exists": table_config_exists,
        }
    )


@app.post("/api/reconcile/setup")
def reconcile_setup():
    body = request.get_json(silent=True) or {}
    if body.get("data_source") not in RECON_SOURCES:
        return jsonify({"error": f"data_source must be one of {sorted(RECON_SOURCES)}"}), 400
    if body.get("report_type") not in RECON_REPORTS:
        return jsonify({"error": f"report_type must be one of {sorted(RECON_REPORTS)}"}), 400
    required = ["source_catalog", "source_schema", "target_catalog", "target_schema"]
    if body["data_source"] != "databricks":
        required.append("uc_connection_name")
    missing = [k for k in required if not body.get(k)]
    if missing:
        return jsonify({"error": f"missing fields: {', '.join(missing)}"}), 400
    if not LAKEBRIDGE_VENV_PY.exists():
        return jsonify({"error": "lakebridge is not installed yet"}), 409
    params_path = JOBS_DIR / f"recon-setup-{uuid.uuid4().hex[:8]}.json"
    params_path.parent.mkdir(parents=True, exist_ok=True)
    params_path.write_text(json.dumps(body))
    return _stream_subprocess([str(LAKEBRIDGE_VENV_PY), str(RECON_DRIVER), str(params_path)])


@app.post("/api/reconcile/table-config")
def reconcile_table_config():
    body = request.get_json(silent=True) or {}
    table_config = body.get("config")
    if not isinstance(table_config, dict):
        return jsonify({"error": "config must be a JSON object"}), 400
    config = _recon_config()
    if not config:
        return jsonify({"error": "reconcile is not configured yet"}), 409
    target = f"{_lakebridge_ws_folder()}/{_recon_table_config_name(config)}"
    local = JOBS_DIR / f"recon-tables-{uuid.uuid4().hex[:8]}.json"
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(json.dumps(table_config, indent=2))
    try:
        _workspace_cli(
            ["workspace", "import", target, "--file", str(local), "--format", "AUTO", "--overwrite"]
        )
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    finally:
        local.unlink(missing_ok=True)
    return jsonify({"ok": True, "path": target})


def _ensure_recon_job_serverless(job_id: str) -> None:
    # lakebridge deploys the job on a classic job cluster, which (a) egresses
    # from non-deterministic VNet SNAT IPs that SQL firewalls can't allowlist
    # and (b) runs an LTS DBR too old for remote_query. Serverless compute
    # fixes both: published egress ranges and a current runtime.
    ok, out = _uc_cli(["jobs", "get", job_id])
    if not ok:
        return
    try:
        settings = json.loads(out).get("settings", {})
    except ValueError:
        return
    if not settings.get("job_clusters"):
        return
    tasks = []
    wheels: list[str] = []
    for task in settings.get("tasks") or []:
        wheels.extend(
            lib["whl"] for lib in task.get("libraries") or [] if lib.get("whl")
        )
        converted = {
            k: v
            for k, v in task.items()
            if k not in ("job_cluster_key", "libraries", "new_cluster")
        }
        converted["environment_key"] = "lakebridge_serverless"
        tasks.append(converted)
    # Full replacement via jobs reset: a partial update can't detach tasks
    # from classic compute.
    settings.pop("job_clusters", None)
    settings["tasks"] = tasks
    settings["environments"] = [
        {
            "environment_key": "lakebridge_serverless",
            "spec": {"client": "4", "dependencies": wheels},
        }
    ]
    _uc_cli(
        ["jobs", "reset", "--json", json.dumps({"job_id": int(job_id), "new_settings": settings})]
    )


@app.post("/api/reconcile/run")
def reconcile_run():
    body = request.get_json(silent=True) or {}
    operation = body.get("operation", "reconcile")
    if operation not in ("reconcile", "aggregates-reconcile"):
        return jsonify({"error": "operation must be reconcile or aggregates-reconcile"}), 400
    job_id = _recon_job_id()
    if not job_id:
        return jsonify({"error": "reconcile job not deployed; run setup first"}), 409
    _ensure_recon_job_serverless(job_id)
    payload = json.dumps({"job_id": int(job_id), "job_parameters": {"operation_name": operation}})
    return _stream_subprocess([str(CLI_PATH), "jobs", "run-now", "--json", payload])


@app.get("/api/models")
def list_models():
    ok, out = _uc_cli(["serving-endpoints", "list"])
    if not ok:
        return jsonify({"models": []})
    try:
        endpoints = json.loads(out)
    except ValueError:
        endpoints = []
    models = sorted(
        e["name"]
        for e in endpoints
        if e.get("task") == "llm/v1/chat"
        and (
            e.get("endpoint_type") == "FOUNDATION_MODEL_API"
            or e.get("name", "").startswith("databricks-")
        )
    )
    return jsonify({"models": models})


@app.get("/api/diagnostics")
def diagnostics():
    labs_venv = Path.home() / ".databricks" / "labs" / "lakebridge" / "state" / "venv"
    transpilers_dir = Path.home() / ".databricks" / "labs" / "remorph-transpilers"
    return jsonify(
        {
            "sys_executable": sys.executable,
            "sys_version": sys.version,
            "base_executable": getattr(sys, "_base_executable", None),
            "ensurepip_available": bool(__import__("importlib.util").util.find_spec("ensurepip")),
            "labs_venv_cfg": (
                (labs_venv / "pyvenv.cfg").read_text()
                if (labs_venv / "pyvenv.cfg").exists()
                else None
            ),
            "transpilers": {
                p.parent.parent.name: (json.loads(p.read_text()).get("version", "?"))
                for p in sorted(transpilers_dir.glob("*/state/version.json"))
            },
        }
    )


@app.get("/api/env")
def env_info():
    return jsonify(
        {
            "python": _python_version(),
            "java": _java_version(),
            "databricks": _databricks_version(),
            "lakebridge": _lakebridge_version(),
            "host": _workspace_host(),
            "user_initials": _user_initials(),
        }
    )


def _user_initials() -> str:
    user = os.environ.get("DATABRICKS_USER") or os.environ.get("USER") or ""
    parts = [p for p in re.split(r"[.\s_-]+", user) if p]
    if len(parts) >= 2:
        return (parts[0][:1] + parts[1][:1]).upper()
    if parts:
        return parts[0][:2].upper()
    return "AG"


BASE_COMMANDS = {
    "analyzer": ["labs", "lakebridge", "analyze"],
    "converter": ["labs", "lakebridge", "transpile"],
    "llm-converter": ["labs", "lakebridge", "llm-transpile"],
    "profiler-test": ["labs", "lakebridge", "test-profiler-connection"],
    "profiler-run": ["labs", "lakebridge", "execute-database-profiler"],
}


def _mssql_credential(body: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    missing = [k for k in ("server", "port", "database", "user", "password") if not body.get(k)]
    if missing:
        return None, f"missing fields: {', '.join(missing)}"
    try:
        port = int(body["port"])
    except (TypeError, ValueError):
        return None, "port must be a number"
    return {
        "auth_type": "sql_authentication",
        "database": body["database"],
        "fetch_size": str(body.get("fetch_size") or "1000"),
        "login_timeout": str(body.get("login_timeout") or "30"),
        "server": body["server"],
        "port": port,
        "user": body["user"],
        "password": body["password"],
        "tz_info": body.get("tz_info") or "UTC",
        "driver": body.get("driver") or "ODBC Driver 18 for SQL Server",
    }, None


def _synapse_credential(body: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    required = ("workspace_name", "development_endpoint", "user", "password")
    missing = [k for k in required if not body.get(k)]
    if missing:
        return None, f"missing fields: {', '.join(missing)}"
    auth_type = body.get("auth_type") or "sql_authentication"
    if auth_type not in ("sql_authentication", "ad_passwd_authentication", "spn_authentication"):
        return None, f"invalid auth_type: {auth_type}"
    name = body["workspace_name"]
    return {
        "workspace": {
            "name": name,
            "dedicated_sql_endpoint": f"{name}.sql.azuresynapse.net",
            "serverless_sql_endpoint": f"{name}-ondemand.sql.azuresynapse.net",
            "sql_user": body["user"],
            "sql_password": body["password"],
            "tz_info": body.get("tz_info") or "UTC",
            "driver": body.get("driver") or "ODBC Driver 18 for SQL Server",
        },
        "azure_api_access": {"development_endpoint": body["development_endpoint"]},
        "jdbc": {
            "auth_type": auth_type,
            "fetch_size": str(body.get("fetch_size") or "1000"),
            "login_timeout": str(body.get("login_timeout") or "30"),
        },
        "profiler": {
            "exclude_serverless_sql_pool": bool(body.get("exclude_serverless_sql_pool")),
            "exclude_dedicated_sql_pools": bool(body.get("exclude_dedicated_sql_pools")),
            "exclude_spark_pools": bool(body.get("exclude_spark_pools")),
            "exclude_monitoring_metrics": bool(body.get("exclude_monitoring_metrics")),
            "redact_sql_pools_sql_text": bool(body.get("redact_sql_pools_sql_text")),
        },
    }, None


PROFILER_SOURCES = {"mssql": _mssql_credential, "synapse": _synapse_credential}


@app.post("/api/profiler/configure")
def profiler_configure():
    body = request.get_json(silent=True) or {}
    source = body.get("source")
    builder = PROFILER_SOURCES.get(source)
    if builder is None:
        return jsonify({"error": f"unsupported source; expected one of {sorted(PROFILER_SOURCES)}"}), 400
    source_credential, error = builder(body)
    if error:
        return jsonify({"error": error}), 400
    credential = {
        "secret_vault_type": "local",
        "secret_vault_name": None,
        source: source_credential,
    }
    CRED_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CRED_FILE, "w", encoding="utf-8") as f:
        yaml.dump(credential, f, default_flow_style=False)
    return jsonify({"ok": True})


def _prune_old_jobs(max_age_hours: int = 24) -> None:
    # Containers are long-lived between deployments; without pruning, uploads
    # and outputs accumulate until the disk fills.
    if not JOBS_DIR.is_dir():
        return
    cutoff = time.time() - max_age_hours * 3600
    for job_dir in JOBS_DIR.iterdir():
        try:
            if job_dir.is_dir() and job_dir.stat().st_mtime < cutoff:
                shutil.rmtree(job_dir, ignore_errors=True)
        except OSError:
            continue


@app.post("/api/upload")
def upload():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "no files provided"}), 400
    _prune_old_jobs()
    job_id = uuid.uuid4().hex[:12]
    input_dir = JOBS_DIR / job_id / "input"
    output_dir = JOBS_DIR / job_id / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        name = secure_filename(f.filename or "")
        if not name:
            continue
        f.save(input_dir / name)
        saved.append(name)
    if not saved:
        return jsonify({"error": "no valid filenames"}), 400
    return jsonify(
        {
            "job_id": job_id,
            "input_dir": str(input_dir),
            "output_dir": str(output_dir),
            "files": saved,
        }
    )


def _workspace_cli(args: list[str], attempts: int = 3) -> None:
    last_error = ""
    for attempt in range(attempts):
        proc = subprocess.run(
            [str(CLI_PATH), *args],
            capture_output=True,
            text=True,
            timeout=120,
            env=cli_env(),
        )
        if proc.returncode == 0:
            return
        last_error = (proc.stderr or proc.stdout).strip()
        if attempt < attempts - 1:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_error)


def _export_results(job_id: str, base_dir: str = RESULTS_WORKSPACE_DIR) -> dict[str, Any] | None:
    output_dir = JOBS_DIR / job_id / "output"
    files = sorted(p for p in output_dir.rglob("*") if p.is_file())
    if not files:
        return None
    ws_dir = f"{base_dir}/{job_id}"
    _workspace_cli(["workspace", "mkdirs", ws_dir])
    exported = []
    for path in files:
        target = f"{ws_dir}/{path.relative_to(output_dir)}".replace("//", "/")
        parent = target.rsplit("/", 1)[0]
        if parent != ws_dir:
            _workspace_cli(["workspace", "mkdirs", parent])
        _workspace_cli(
            ["workspace", "import", target, "--file", str(path), "--format", "AUTO", "--overwrite"]
        )
        exported.append(target)
    return {
        "workspace_dir": ws_dir,
        "files": exported,
        "url": f"https://{_workspace_host()}/#workspace{ws_dir}",
    }


def _export_profiler_results(tech: str) -> dict[str, Any] | None:
    extracts = sorted(PROFILER_DATA_DIR.glob("*_assessment/profiler_extract.db"))
    if not extracts:
        return None
    ws_dir = f"{RESULTS_WORKSPACE_BASE}/profiler/{tech}/{uuid.uuid4().hex[:12]}"
    _workspace_cli(["workspace", "mkdirs", ws_dir])
    exported = []
    for path in extracts:
        target = f"{ws_dir}/{path.parent.name}-{path.name}"
        _workspace_cli(
            ["workspace", "import", target, "--file", str(path), "--format", "AUTO", "--overwrite"]
        )
        exported.append(target)
    return {
        "workspace_dir": ws_dir,
        "files": exported,
        "url": f"https://{_workspace_host()}/#workspace{ws_dir}",
    }


def _llm_results(args: list[str]) -> dict[str, Any] | None:
    if "--output-ws-folder" not in args:
        return None
    out = args[args.index("--output-ws-folder") + 1]
    ws_dir = out.removeprefix("/Workspace")
    return {
        "workspace_dir": ws_dir,
        "files": [],
        "url": f"https://{_workspace_host()}/#workspace{ws_dir}",
        # The Switch job runs async; output appears when the job completes.
        "pending": True,
    }


@app.post("/api/run/<command>")
def run_command(command: str):
    if command not in BASE_COMMANDS:
        return jsonify({"error": f"unknown command: {command}"}), 404
    if not is_installed():
        return jsonify({"error": "setup not complete"}), 409

    body = request.get_json(silent=True) or {}
    extra_args = body.get("args") or []
    if not isinstance(extra_args, list) or not all(isinstance(a, str) for a in extra_args):
        return jsonify({"error": "args must be a list of strings"}), 400
    job_id = body.get("job_id")
    if job_id is not None and not (isinstance(job_id, str) and JOB_ID_RE.match(job_id)):
        return jsonify({"error": "invalid job_id"}), 400

    if command == "llm-converter":
        out = _llm_results(extra_args)
        if out:
            # The Switch job exports into this folder but does not create it.
            try:
                _workspace_cli(["workspace", "mkdirs", out["workspace_dir"]])
            except RuntimeError as exc:
                return jsonify({"error": f"cannot create output folder: {exc}"}), 502

    full_args = [*BASE_COMMANDS[command], *extra_args]
    env = cli_env()

    def generate():
        proc = subprocess.Popen(
            [str(CLI_PATH), *full_args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            bufsize=1,
        )
        saw_error = False
        try:
            for line in _proc_lines(proc):
                if line is None:
                    yield ": keepalive\n\n"
                    continue
                cleaned = _clean_line(line)
                # lakebridge often exits 0 after logging ERROR lines; track
                # them so we don't report results for failed LLM runs.
                if " ERROR [" in cleaned:
                    saw_error = True
                yield f"data: {cleaned}\n\n"
        finally:
            proc.wait()
            if proc.returncode == 0 and not (command == "llm-converter" and saw_error):
                try:
                    if command == "profiler-run":
                        tech = _slug(_arg_value(extra_args, "--source-tech") or "unknown")
                        results = _export_profiler_results(tech)
                    elif command == "llm-converter":
                        results = _llm_results(extra_args)
                    elif job_id:
                        results = _export_results(job_id, _results_base(command, extra_args))
                    else:
                        results = None
                except Exception as exc:  # noqa: BLE001
                    yield f"data: Failed to export results to workspace: {exc}\n\n"
                else:
                    if results:
                        if results.get("pending"):
                            yield (
                                f"data: Results will be saved to {results['workspace_dir']} "
                                "when the Switch job completes.\n\n"
                            )
                        else:
                            yield f"data: Results available at {results['workspace_dir']}\n\n"
                        yield f"event: results\ndata: {json.dumps(results)}\n\n"
                    elif job_id or command == "profiler-run":
                        yield "data: No output files produced.\n\n"
            yield f"event: end\ndata: {proc.returncode}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def spa(path: str):
    if path and (FRONTEND_DIST / path).exists():
        return send_from_directory(str(FRONTEND_DIST), path)
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return (
            "<h1>Frontend not built</h1>"
            "<p>Run <code>cd frontend && npm install && npm run build</code>, "
            "or use <code>npm run dev</code> in development.</p>",
            200,
        )
    return send_from_directory(str(FRONTEND_DIST), "index.html")
