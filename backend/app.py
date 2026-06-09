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
from typing import Any

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
    "profiler": ["labs", "lakebridge", "configure-database-profiler"],
    "analyzer": ["labs", "lakebridge", "analyze"],
    "converter": ["labs", "lakebridge", "transpile"],
}


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
        try:
            for line in iter(proc.stdout.readline, ""):
                yield f"data: {_clean_line(line)}\n\n"
        finally:
            proc.wait()
            if job_id and proc.returncode == 0:
                try:
                    results = _export_results(job_id)
                except Exception as exc:  # noqa: BLE001
                    yield f"data: Failed to export results to workspace: {exc}\n\n"
                else:
                    if results:
                        yield f"data: Results exported to {results['workspace_dir']}\n\n"
                        yield f"event: results\ndata: {json.dumps(results)}\n\n"
                    else:
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
