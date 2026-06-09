import json
import logging
import os
import re
import subprocess
import sys
import threading
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
RESULTS_WORKSPACE_DIR = "/Shared/lakebridge-app/results"
JOB_ID_RE = re.compile(r"^[0-9a-f]{12}$")
CRED_FILE = Path.home() / ".databricks" / "labs" / "lakebridge" / ".credentials.yml"
PROFILER_DATA_DIR = Path("/tmp/data")

MAX_LOG_LINES = 1000

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _clean_line(line: str) -> str:
    return ANSI_RE.sub("", line.rstrip())

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


UC_CATALOG = "lakebridge"
UC_SCHEMAS = {
    "switch": ["USE_SCHEMA", "CREATE_TABLE", "SELECT", "MODIFY"],
    "analyzer": ["USE_SCHEMA", "CREATE_TABLE", "SELECT", "MODIFY"],
    "transpile": ["USE_SCHEMA", "CREATE_TABLE", "SELECT", "MODIFY"],
}
UC_VOLUME_SCHEMA = "switch"
UC_VOLUME = "switch_volume"


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


def _probe_volume_write() -> bool:
    probe = (
        f"dbfs:/Volumes/{UC_CATALOG}/{UC_VOLUME_SCHEMA}/{UC_VOLUME}/.lakebridge-app-probe"
    )
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
    for schema, required in UC_SCHEMAS.items():
        items.append(
            _check_uc_object(
                "schema",
                f"{UC_CATALOG}.{schema}",
                ["schemas", "get", f"{UC_CATALOG}.{schema}"],
                ["schemas", "create", schema, UC_CATALOG],
                lambda s=schema: _uc_cli(["tables", "list", UC_CATALOG, s])[0],
                required,
            )
        )
    volume_full = f"{UC_CATALOG}.{UC_VOLUME_SCHEMA}.{UC_VOLUME}"
    items.append(
        _check_uc_object(
            "volume",
            volume_full,
            ["volumes", "read", volume_full],
            ["volumes", "create", UC_CATALOG, UC_VOLUME_SCHEMA, UC_VOLUME, "MANAGED"],
            _probe_volume_write,
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
            "transpilers": (
                sorted(p.name for p in transpilers_dir.iterdir())
                if transpilers_dir.is_dir()
                else []
            ),
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


@app.post("/api/profiler/configure")
def profiler_configure():
    body = request.get_json(silent=True) or {}
    if body.get("source") != "mssql":
        return jsonify({"error": "unsupported source; only mssql is supported for now"}), 400
    missing = [k for k in ("server", "port", "user", "password") if not body.get(k)]
    if missing:
        return jsonify({"error": f"missing fields: {', '.join(missing)}"}), 400
    try:
        port = int(body["port"])
    except (TypeError, ValueError):
        return jsonify({"error": "port must be a number"}), 400
    credential = {
        "secret_vault_type": "local",
        "secret_vault_name": None,
        "mssql": {
            "auth_type": "sql_authentication",
            "fetch_size": str(body.get("fetch_size") or "1000"),
            "login_timeout": str(body.get("login_timeout") or "30"),
            "server": body["server"],
            "port": port,
            "user": body["user"],
            "password": body["password"],
            "tz_info": body.get("tz_info") or "UTC",
            "driver": body.get("driver") or "ODBC Driver 18 for SQL Server",
        },
    }
    CRED_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CRED_FILE, "w", encoding="utf-8") as f:
        yaml.dump(credential, f, default_flow_style=False)
    return jsonify({"ok": True})


@app.post("/api/upload")
def upload():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "no files provided"}), 400
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


def _workspace_cli(args: list[str]) -> None:
    proc = subprocess.run(
        [str(CLI_PATH), *args],
        capture_output=True,
        text=True,
        timeout=120,
        env=cli_env(),
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())


def _export_results(job_id: str) -> dict[str, Any] | None:
    output_dir = JOBS_DIR / job_id / "output"
    files = sorted(p for p in output_dir.rglob("*") if p.is_file())
    if not files:
        return None
    ws_dir = f"{RESULTS_WORKSPACE_DIR}/{job_id}"
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


def _export_profiler_results() -> dict[str, Any] | None:
    extracts = sorted(PROFILER_DATA_DIR.glob("*_assessment/profiler_extract.db"))
    if not extracts:
        return None
    ws_dir = f"{RESULTS_WORKSPACE_DIR}/profiler-{uuid.uuid4().hex[:12]}"
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
        assert proc.stdout is not None
        saw_error = False
        try:
            for line in iter(proc.stdout.readline, ""):
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
                        results = _export_profiler_results()
                    elif command == "llm-converter":
                        results = _llm_results(extra_args)
                    elif job_id:
                        results = _export_results(job_id)
                    else:
                        results = None
                except Exception as exc:  # noqa: BLE001
                    yield f"data: Failed to export results to workspace: {exc}\n\n"
                else:
                    if results:
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
