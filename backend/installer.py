import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

MARKER_DIR = Path.home() / ".lakebridge-app"
MARKER_FILE = MARKER_DIR / "installed"
CLI_TARGET_DIR = Path.home() / "bin"
CLI_PATH = CLI_TARGET_DIR / ("databricks.exe" if platform.system() == "Windows" else "databricks")
VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor"
JAVA_TARGET_DIR = Path.home() / "java"
# Morpheus (the converter's transpiler) needs Java 11+; Temurin 17 is LTS.
JRE_URL = "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jre/hotspot/normal/eclipse"

Log = Callable[[str], None]


def java_bin_dir() -> Path | None:
    if not JAVA_TARGET_DIR.is_dir():
        return None
    matches = sorted(JAVA_TARGET_DIR.glob("*/bin/java"))
    return matches[0].parent if matches else None


def is_installed() -> bool:
    ok = MARKER_FILE.exists() and CLI_PATH.exists()
    if _in_databricks_app():
        ok = ok and java_bin_dir() is not None
    return ok


def _latest_cli_version() -> str:
    req = urllib.request.Request(
        "https://api.github.com/repos/databricks/cli/releases/latest",
        headers={"Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    return data["tag_name"].lstrip("v")


def _platform_suffix() -> str:
    system = platform.system()
    if system == "Linux":
        os_part = "linux"
    elif system == "Darwin":
        os_part = "darwin"
    elif system == "Windows":
        os_part = "windows"
    else:
        raise RuntimeError(f"Unsupported OS: {system}")

    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        arch = "amd64"
    elif machine in ("arm64", "aarch64"):
        arch = "arm64"
    elif machine == "i386":
        arch = "386"
    elif machine.startswith("arm"):
        arch = "arm"
    else:
        raise RuntimeError(f"Unsupported architecture: {machine}")

    return f"{os_part}_{arch}"


def _bundled_parts(pattern: str) -> list[Path]:
    # Vendored archives are split into <10MB .part-* chunks: the Apps platform
    # rejects larger source files and workspace import auto-extracts *.zip.
    if not VENDOR_DIR.is_dir():
        return []
    whole = sorted(VENDOR_DIR.glob(pattern))
    if whole:
        return [whole[-1]]
    return sorted(VENDOR_DIR.glob(f"{pattern}.part-*"))


def _reassemble(parts: list[Path], dest: Path) -> None:
    with open(dest, "wb") as out:
        for part in parts:
            out.write(part.read_bytes())


def _extract_cli(zip_path: Path, log: Log) -> None:
    CLI_TARGET_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmpdir)
        binary_name = "databricks.exe" if platform.system() == "Windows" else "databricks"
        src = Path(tmpdir) / binary_name
        if CLI_PATH.exists():
            CLI_PATH.unlink()
        shutil.copy2(src, CLI_PATH)
        if platform.system() != "Windows":
            CLI_PATH.chmod(0o755)
    log(f"Installed Databricks CLI at {CLI_PATH}")


def install_cli(log: Log) -> None:
    parts = _bundled_parts(f"databricks_cli_*_{_platform_suffix()}.zip")
    if parts:
        log(f"Installing Databricks CLI from bundled {parts[0].name} ({len(parts)} part(s))...")
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = Path(tmpdir) / "databricks_cli.zip"
            _reassemble(parts, zip_path)
            _extract_cli(zip_path, log)
        return
    version = _latest_cli_version()
    log(f"Installing Databricks CLI v{version}...")
    asset = f"databricks_cli_{version}_{_platform_suffix()}"
    url = f"https://github.com/databricks/cli/releases/download/v{version}/{asset}.zip"
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = Path(tmpdir) / f"{asset}.zip"
        log(f"Downloading {url}")
        urllib.request.urlretrieve(url, zip_path)
        _extract_cli(zip_path, log)


def install_java(log: Log) -> None:
    if java_bin_dir():
        log("Java already installed.")
        return
    JAVA_TARGET_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpdir:
        tar_path = Path(tmpdir) / "jre.tar.gz"
        parts = _bundled_parts("temurin_jre_*.tar.gz")
        if parts:
            log(f"Installing Java from bundled {parts[0].name} ({len(parts)} part(s))...")
            _reassemble(parts, tar_path)
        else:
            log(f"Downloading Temurin JRE 17 from {JRE_URL}")
            urllib.request.urlretrieve(JRE_URL, tar_path)
        with tarfile.open(tar_path) as tf:
            tf.extractall(JAVA_TARGET_DIR, filter="tar")
    java = java_bin_dir()
    if not java:
        raise RuntimeError("Java install failed: no */bin/java under ~/java")
    log(f"Installed Java at {java / 'java'}")


def cli_env() -> dict[str, str]:
    env = os.environ.copy()
    # Put the app's own interpreter first so `databricks labs` resolves a
    # python3 that can create venvs (the system python lacks ensurepip).
    entries = [str(CLI_TARGET_DIR), str(Path(sys.executable).parent)]
    java = java_bin_dir()
    if java:
        entries.append(str(java))
        env.setdefault("JAVA_HOME", str(java.parent))
    env["PATH"] = os.pathsep.join([*entries, env.get("PATH", "")])
    if _in_databricks_app():
        # The Apps runtime sets DATABRICKS_TOKEN_AUDIENCE, which the SDK reads
        # as github-oidc auth and rejects alongside the OAuth M2M credentials.
        env.pop("DATABRICKS_TOKEN_AUDIENCE", None)
        env.setdefault("DATABRICKS_AUTH_TYPE", "oauth-m2m")
    return env


def _in_databricks_app() -> bool:
    return bool(os.environ.get("DATABRICKS_APP_NAME"))


def _write_python_shim(log: Log) -> None:
    # `databricks labs install` creates its venv with `<python> -m venv` and
    # then needs pip inside it, but the app interpreter is a uv-managed build
    # whose venvs come up without pip. This shim forwards to the app
    # interpreter and bootstraps pip into any venv it creates.
    uv = shutil.which("uv") or "uv"
    shim = CLI_TARGET_DIR / "python3"
    shim.write_text(
        f"""#!/bin/sh
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
    "{sys.executable}" "$@" || exit $?
    for last; do :; done
    exec "{uv}" pip install --quiet --python "$last/bin/python3" pip
fi
exec "{sys.executable}" "$@"
"""
    )
    shim.chmod(0o755)
    log(f"Wrote python3 shim at {shim}")


def _install_env() -> dict[str, str]:
    # `databricks labs install` scans every PATH dir for python3* and picks the
    # LOWEST version >= the project minimum, so Ubuntu's /usr/bin/python3.10
    # (no ensurepip -> `-m venv` fails) wins over the app's working 3.11.
    # Hide every interpreter except the ~/bin shim from the detector.
    env = cli_env()
    entries = []
    for entry in env["PATH"].split(os.pathsep):
        p = Path(entry)
        if p != CLI_TARGET_DIR and any(p.glob("python3*")):
            continue
        entries.append(entry)
    env["PATH"] = os.pathsep.join(entries)
    return env


def install_lakebridge(log: Log) -> None:
    log("Installing databricks labs lakebridge...")
    env = cli_env()
    if _in_databricks_app():
        _write_python_shim(log)
        env = _install_env()
    proc = subprocess.Popen(
        [str(CLI_PATH), "labs", "install", "lakebridge"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        bufsize=1,
    )
    assert proc.stdout is not None
    for line in iter(proc.stdout.readline, ""):
        log(line.rstrip())
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"lakebridge install exited with code {proc.returncode}")
    log("Lakebridge installed.")


def _lakebridge_installed() -> bool:
    state = Path.home() / ".databricks" / "labs" / "lakebridge" / "state" / "version.json"
    return state.exists()


def ensure_installed(log: Log) -> None:
    if is_installed():
        log("Setup already completed.")
        return
    MARKER_DIR.mkdir(parents=True, exist_ok=True)
    install_cli(log)
    if _in_databricks_app():
        install_java(log)
    if _lakebridge_installed():
        log("Lakebridge already installed.")
    else:
        install_lakebridge(log)
    MARKER_FILE.write_text("ok\n")
    log("Setup complete.")
