import logging
import os
import re
import subprocess
import sys
import threading
from configparser import ConfigParser
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from flask_cors import CORS

from .installer import CLI_PATH, cli_env, ensure_installed, is_installed

logging.getLogger("werkzeug").setLevel(logging.WARNING)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

# Static handling is done by the spa() catch-all; Flask's static route would
# shadow it and 404 on client-side routes.
app = Flask(__name__, static_folder=None)
# CORS is only needed for the Vite dev server; in production the SPA is same-origin.
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

MAX_LOG_LINES = 1000

_state_lock = threading.Lock()
_install_state: dict[str, Any] = {
    "status": "pending",
    "logs": [],
    "error": None,
}
_install_started = False


def _append_log(line: str) -> None:
    with _state_lock:
        _install_state["logs"].append(line)
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
    if not CLI_PATH.exists():
        return ""
    raw = _check_output([str(CLI_PATH), "labs", "show", "lakebridge"])
    match = re.search(r"(\d+\.\d+\.\d+)", raw)
    return match.group(1) if match else ""


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
                yield f"data: {line.rstrip()}\n\n"
        finally:
            proc.wait()
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
