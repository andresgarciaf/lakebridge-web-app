# Databricks notebook source
# MAGIC %md
# MAGIC # Lakebridge App — notebook installer
# MAGIC
# MAGIC Deploys the Lakebridge web app into this workspace without any local tooling:
# MAGIC no git clone, no Databricks CLI, no Node.
# MAGIC
# MAGIC **Online mode (default):** fetches the app source from GitHub and downloads the
# MAGIC runtime binaries (Databricks CLI, Temurin JRE, MS ODBC driver) directly.
# MAGIC
# MAGIC **Offline mode:** set `offline_zip_path` to a repo zip (made with `make offline-zip`,
# MAGIC or a GitHub "Download ZIP") uploaded to a UC Volume or workspace folder. The
# MAGIC offline zip must contain `vendor/` parts for fully offline installs.
# MAGIC
# MAGIC Run all cells. The last cell prints the app URL.

# COMMAND ----------

# MAGIC %pip install -q -U databricks-sdk zstandard
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

dbutils.widgets.text("app_name", "lakebridge", "App name (max 30 chars)")
dbutils.widgets.text("github_repo", "andresgarciaf/lakebridge-web-app", "GitHub repo (owner/name)")
dbutils.widgets.text("branch", "main", "Branch")
dbutils.widgets.text("offline_zip_path", "", "Offline zip path (optional, /Volumes/... or /Workspace/...)")

APP_NAME = dbutils.widgets.get("app_name").strip()
GITHUB_REPO = dbutils.widgets.get("github_repo").strip()
BRANCH = dbutils.widgets.get("branch").strip()
OFFLINE_ZIP = dbutils.widgets.get("offline_zip_path").strip()

# Only these paths are deployed; tests, frontend sources, and dev tooling are skipped.
RUNTIME_PREFIXES = ("backend/", "frontend/dist/", "vendor/")
RUNTIME_FILES = ("app.yml", "pyproject.toml", "uv.lock")

# COMMAND ----------

import io
import lzma
import string
import urllib.request
import zipfile
from pathlib import PurePosixPath

PART_SIZE = 9 * 1024 * 1024  # Apps rejects source files >10MB


UA = {"User-Agent": "lakebridge-app-installer"}


def fetch(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} fetching {url}") from e


def latest_cli_version() -> str:
    # The release page redirect avoids api.github.com, whose unauthenticated
    # rate limit (60/hr per IP) is often exhausted on shared egress IPs.
    req = urllib.request.Request(
        "https://github.com/databricks/cli/releases/latest", headers=UA
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.url.rsplit("/v", 1)[1]


def get_source_zip() -> zipfile.ZipFile:
    if OFFLINE_ZIP:
        path = OFFLINE_ZIP
        if path.startswith("/Workspace") or path.startswith("/Volumes"):
            data = open(path, "rb").read()
        else:
            raise ValueError("offline_zip_path must start with /Volumes or /Workspace")
        print(f"Using offline zip: {path} ({len(data)//1024} KB)")
    else:
        url = f"https://codeload.github.com/{GITHUB_REPO}/zip/refs/heads/{BRANCH}"
        print(f"Fetching {url}")
        data = fetch(url)
        print(f"Downloaded {len(data)//1024} KB")
    return zipfile.ZipFile(io.BytesIO(data))


def runtime_members(zf: zipfile.ZipFile) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for info in zf.infolist():
        if info.is_dir():
            continue
        parts = PurePosixPath(info.filename).parts
        rel = "/".join(parts[1:]) if len(parts) > 1 and "/" in info.filename else info.filename
        # GitHub zips nest under <repo>-<branch>/; offline zips may not.
        if rel not in RUNTIME_FILES and not rel.startswith(RUNTIME_PREFIXES):
            if info.filename in RUNTIME_FILES or info.filename.startswith(RUNTIME_PREFIXES):
                rel = info.filename
            else:
                continue
        files[rel] = zf.read(info)
    return files


source = get_source_zip()
files = runtime_members(source)
print(f"{len(files)} runtime files selected")
assert any(f.startswith("backend/") for f in files), "backend/ missing from source"
assert "frontend/dist/index.html" in files, "frontend/dist missing — zip must contain the built UI"

# COMMAND ----------

# MAGIC %md ## Vendor runtime binaries (skipped if already present in the source zip)


# COMMAND ----------

def split_parts(name: str, data: bytes) -> dict[str, bytes]:
    letters = string.ascii_lowercase
    out = {}
    for i in range(0, len(data), PART_SIZE):
        idx = i // PART_SIZE
        suffix = letters[idx // 26] + letters[idx % 26]
        out[f"vendor/{name}.part-{suffix}"] = data[i : i + PART_SIZE]
    return out


def ar_members(deb: bytes) -> dict[str, bytes]:
    assert deb[:8] == b"!<arch>\n", "not an ar archive"
    out, off = {}, 8
    while off < len(deb):
        header = deb[off : off + 60]
        if len(header) < 60:
            break
        name = header[:16].decode().strip().rstrip("/")
        size = int(header[48:58].decode().strip())
        out[name] = deb[off + 60 : off + 60 + size]
        off += 60 + size + (size % 2)
    return out


def deb_data_files(deb: bytes) -> dict[str, bytes]:
    import tarfile

    import zstandard

    members = ar_members(deb)
    data_name = next(n for n in members if n.startswith("data.tar"))
    raw = members[data_name]
    if data_name.endswith(".zst"):
        raw = zstandard.ZstdDecompressor().decompress(raw, max_output_size=512 * 1024 * 1024)
        tar = tarfile.open(fileobj=io.BytesIO(raw), mode="r:")
    elif data_name.endswith(".xz"):
        tar = tarfile.open(fileobj=io.BytesIO(lzma.decompress(raw)), mode="r:")
    else:
        tar = tarfile.open(fileobj=io.BytesIO(raw), mode="r:*")
    out = {}
    for m in tar.getmembers():
        if m.isfile() or m.issym():
            out[m.name.lstrip("./")] = (
                tar.extractfile(m).read() if m.isfile() else m.linkname.encode()
            )
    return out


def latest_from_listing(base: str, prefix: str, suffix: str) -> str:
    listing = fetch(base).decode("utf-8", "replace")
    import re

    names = sorted(set(re.findall(rf"{prefix}[^\"']*{re.escape(suffix)}", listing)))
    assert names, f"no match for {prefix}*{suffix} at {base}"
    return names[-1]


if any(f.startswith("vendor/") for f in files):
    print("vendor/ present in source zip — skipping downloads (offline install)")
else:
    print("Downloading Databricks CLI...")
    version = latest_cli_version()
    cli = fetch(
        f"https://github.com/databricks/cli/releases/download/v{version}/databricks_cli_{version}_linux_amd64.zip"
    )
    files.update(split_parts(f"databricks_cli_{version}_linux_amd64.zip", cli))

    print("Downloading Temurin JRE 17...")
    jre = fetch("https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jre/hotspot/normal/eclipse")
    files.update(split_parts("temurin_jre_17_linux_x64.tar.gz", jre))

    print("Downloading ODBC driver libs...")
    import tarfile

    root: dict[str, bytes] = {}
    ubuntu = "http://archive.ubuntu.com/ubuntu/pool/main"
    for base, prefix in [
        (f"{ubuntu}/u/unixodbc/", "libodbc2_2.3.9"),
        (f"{ubuntu}/u/unixodbc/", "libodbcinst2_2.3.9"),
        (f"{ubuntu}/libt/libtool/", "libltdl7_2.4.6"),
        ("https://packages.microsoft.com/ubuntu/22.04/prod/pool/main/m/msodbcsql18/", "msodbcsql18_"),
    ]:
        name = latest_from_listing(base, prefix, "_amd64.deb")
        print(f"  {name}")
        root.update(deb_data_files(fetch(base + name)))
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path, content in root.items():
            if not (path.startswith("usr") or path.startswith("opt")):
                continue
            info = tarfile.TarInfo(path)
            info.size = len(content)
            info.mode = 0o755
            tf.addfile(info, io.BytesIO(content))
    files.update(split_parts("odbc_libs_linux_x64.tar.gz", buf.getvalue()))

print(f"{len(files)} files ready, total {sum(len(v) for v in files.values())//(1024*1024)} MB")

# COMMAND ----------

# MAGIC %md ## Upload source to the workspace and deploy the app

# COMMAND ----------

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.workspace import ImportFormat

w = WorkspaceClient()
me = w.current_user.me().user_name
target = f"/Workspace/Users/{me}/lakebridge-app-source"
print(f"Uploading {len(files)} files to {target} ...")

made_dirs: set[str] = set()
for rel, content in sorted(files.items()):
    path = f"{target}/{rel}"
    parent = path.rsplit("/", 1)[0]
    if parent not in made_dirs:
        w.workspace.mkdirs(parent)
        made_dirs.add(parent)
    w.workspace.upload(path, io.BytesIO(content), format=ImportFormat.AUTO, overwrite=True)
print("Upload complete.")

# COMMAND ----------

from databricks.sdk.service.apps import App, AppDeployment

try:
    app = w.apps.get(name=APP_NAME)
    print(f"App '{APP_NAME}' already exists — deploying new source to it.")
except Exception:
    print(f"Creating app '{APP_NAME}' (takes a few minutes)...")
    app = w.apps.create_and_wait(app=App(name=APP_NAME, description="Lakebridge UI"))

print("Deploying source code...")
w.apps.deploy_and_wait(app_name=APP_NAME, app_deployment=AppDeployment(source_code_path=target))
app = w.apps.get(name=APP_NAME)
SP = app.service_principal_client_id

UC_SCHEMAS = ["analyzer", "profiler", "converter", "reconciler"]
UC_VOLUMES = [("converter", "switch"), ("converter", "morpheus_bb"), ("reconciler", "reconcile_volume")]

option_a = (
    f"CREATE CATALOG IF NOT EXISTS lakebridge;\n"
    f"GRANT USE CATALOG, CREATE SCHEMA ON CATALOG lakebridge TO `{SP}`;"
)
option_b_lines = ["CREATE CATALOG IF NOT EXISTS lakebridge;"]
option_b_lines += [f"CREATE SCHEMA IF NOT EXISTS lakebridge.{s};" for s in UC_SCHEMAS]
option_b_lines += [f"CREATE VOLUME IF NOT EXISTS lakebridge.{s}.{v};" for s, v in UC_VOLUMES]
option_b_lines += [f"GRANT USE CATALOG ON CATALOG lakebridge TO `{SP}`;"]
option_b_lines += [
    f"GRANT USE SCHEMA, CREATE TABLE, CREATE VOLUME, SELECT, MODIFY ON SCHEMA lakebridge.{s} TO `{SP}`;"
    for s in UC_SCHEMAS
]
option_b_lines += [
    f"GRANT READ VOLUME, WRITE VOLUME ON VOLUME lakebridge.{s}.{v} TO `{SP}`;" for s, v in UC_VOLUMES
]
option_b = "\n".join(option_b_lines)

print(f"\n✅ App deployed: {app.url}")
print(f"   App service principal: {SP}\n")
print("=" * 78)
print(
    "UNITY CATALOG SETUP — the app uses catalog `lakebridge` with schemas\n"
    "analyzer / profiler / converter / reconciler and volumes switch,\n"
    "morpheus_bb, reconcile_volume. The app CREATES these itself on first use\n"
    "if its service principal has the grants below.\n"
)
print("Option A — let the app self-provision (run in a SQL editor):\n")
print(option_a)
print(
    "\nOption B — if you do NOT have permission to create catalogs or grant\n"
    "privileges, send this block to a workspace admin and ask them to run it\n"
    "BEFORE the app is used, so all objects exist and the app is granted access:\n"
)
print(option_b)
print("=" * 78)
print(
    f"\nNext: open {app.url} — first load runs the in-container setup\n"
    "(CLI, JRE, ODBC driver, lakebridge). The Converter's LLM panel and the\n"
    "Instructions page show live Unity Catalog status and any missing grants."
)
