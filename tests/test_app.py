import io
import tarfile
import zipfile

import pytest

from backend import app as app_module
from backend import installer


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "kickoff_install", lambda: None)
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def test_status_returns_install_state(client):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = resp.get_json()
    assert {"status", "logs", "error", "cli_path"} <= data.keys()


def test_env_returns_versions(client):
    resp = client.get("/api/env")
    assert resp.status_code == 200
    data = resp.get_json()
    assert {"python", "java", "databricks", "lakebridge", "host"} <= data.keys()


def test_run_unknown_command_404(client):
    resp = client.post("/api/run/nope", json={"args": []})
    assert resp.status_code == 404


def test_run_before_install_409(client, monkeypatch):
    monkeypatch.setattr(app_module, "is_installed", lambda: False)
    resp = client.post("/api/run/analyzer", json={"args": []})
    assert resp.status_code == 409


def test_run_rejects_non_string_args(client, monkeypatch):
    monkeypatch.setattr(app_module, "is_installed", lambda: True)
    resp = client.post("/api/run/analyzer", json={"args": [1, 2]})
    assert resp.status_code == 400


def test_run_rejects_invalid_job_id(client, monkeypatch):
    monkeypatch.setattr(app_module, "is_installed", lambda: True)
    resp = client.post("/api/run/analyzer", json={"args": [], "job_id": "../../etc"})
    assert resp.status_code == 400


def test_upload_saves_files(client, monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "JOBS_DIR", tmp_path)
    resp = client.post(
        "/api/upload",
        data={"files": [(io.BytesIO(b"SELECT 1;"), "query.sql")]},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["files"] == ["query.sql"]
    assert (tmp_path / data["job_id"] / "input" / "query.sql").read_bytes() == b"SELECT 1;"
    assert (tmp_path / data["job_id"] / "output").is_dir()


def test_upload_prunes_old_jobs(client, monkeypatch, tmp_path):
    import os

    monkeypatch.setattr(app_module, "JOBS_DIR", tmp_path)
    stale = tmp_path / "deadbeef0000"
    stale.mkdir()
    old = app_module.time.time() - 48 * 3600
    os.utime(stale, (old, old))
    resp = client.post(
        "/api/upload",
        data={"files": [(io.BytesIO(b"SELECT 1;"), "q.sql")]},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    assert not stale.exists()


def test_upload_without_files_400(client):
    resp = client.post("/api/upload", data={}, content_type="multipart/form-data")
    assert resp.status_code == 400


def test_profiler_configure_writes_credentials(client, monkeypatch, tmp_path):
    cred = tmp_path / ".credentials.yml"
    monkeypatch.setattr(app_module, "CRED_FILE", cred)
    resp = client.post(
        "/api/profiler/configure",
        json={
            "source": "mssql",
            "server": "db.example.com",
            "port": "1433",
            "database": "demo",
            "user": "sa",
            "password": "secret",
        },
    )
    assert resp.status_code == 200
    import yaml

    data = yaml.safe_load(cred.read_text())
    assert data["mssql"]["server"] == "db.example.com"
    assert data["mssql"]["port"] == 1433
    assert data["mssql"]["driver"] == "ODBC Driver 18 for SQL Server"


def test_profiler_configure_rejects_unknown_source(client):
    resp = client.post("/api/profiler/configure", json={"source": "oracle"})
    assert resp.status_code == 400


def test_profiler_configure_synapse(client, monkeypatch, tmp_path):
    cred = tmp_path / ".credentials.yml"
    monkeypatch.setattr(app_module, "CRED_FILE", cred)
    resp = client.post(
        "/api/profiler/configure",
        json={
            "source": "synapse",
            "workspace_name": "myws",
            "development_endpoint": "https://myws.dev.azuresynapse.net",
            "user": "sa",
            "password": "secret",
        },
    )
    assert resp.status_code == 200
    import yaml

    data = yaml.safe_load(cred.read_text())
    assert data["synapse"]["workspace"]["dedicated_sql_endpoint"] == "myws.sql.azuresynapse.net"
    assert data["synapse"]["jdbc"]["auth_type"] == "sql_authentication"
    assert data["synapse"]["profiler"]["exclude_spark_pools"] is False


def test_dialects_reads_installed_configs(client, monkeypatch, tmp_path):
    transpilers = tmp_path / "transpilers"
    (transpilers / "morpheus" / "lib").mkdir(parents=True)
    (transpilers / "morpheus" / "lib" / "config.yml").write_text(
        "remorph:\n  dialects:\n    - snowflake\n    - tsql\n"
        "options:\n"
        "  all:\n"
        "    - flag: overrides-file\n"
        "      method: QUESTION\n"
        "      default: <none>\n"
        "  tsql:\n"
        "    - flag: target-tech\n"
        "      method: CHOICE\n"
        "      prompt: Specify which technology should be generated\n"
        "      choices: [SPARKSQL, PYSPARK]\n"
    )
    venv = tmp_path / "venv"
    switch_dir = venv / "lib" / "python3.11" / "site-packages" / "databricks" / "labs" / "switch" / "lsp"
    switch_dir.mkdir(parents=True)
    (switch_dir / "config.yml").write_text("remorph:\n  dialects:\n    - snowflake\n    - python\n")
    monkeypatch.setattr(app_module, "TRANSPILERS_DIR", transpilers)
    monkeypatch.setattr(app_module, "LABS_VENV_DIR", venv)
    data = client.get("/api/dialects").get_json()
    assert data["standard"] == ["snowflake", "tsql"]
    assert data["switch"] == ["python", "snowflake"]
    assert list(data["standard_options"]) == ["tsql"]
    assert data["standard_options"]["tsql"][0]["flag"] == "target-tech"
    assert data["standard_options"]["tsql"][0]["choices"] == ["SPARKSQL", "PYSPARK"]


def test_models_lists_foundation_endpoints(client, monkeypatch):
    payload = (
        '[{"name": "databricks-claude-sonnet-4-5", "endpoint_type": "FOUNDATION_MODEL_API",'
        ' "task": "llm/v1/chat"},'
        ' {"name": "databricks-gte-large-en", "endpoint_type": "FOUNDATION_MODEL_API",'
        ' "task": "llm/v1/embeddings"},'
        ' {"name": "my-custom-endpoint", "endpoint_type": "SERVING", "task": "llm/v1/chat"}]'
    )
    monkeypatch.setattr(app_module, "_uc_cli", lambda args: (True, payload))
    data = client.get("/api/models").get_json()
    assert data["models"] == ["databricks-claude-sonnet-4-5"]


def test_results_base_groups_by_utility_and_tech():
    assert (
        app_module._results_base("analyzer", ["--source-tech", "MS SQL Server"])
        == "/Shared/lakebridge-app/analyzer/ms-sql-server"
    )
    assert (
        app_module._results_base("converter", ["--source-dialect", "informatica (desktop edition)"])
        == "/Shared/lakebridge-app/morpheus-bb/informatica-desktop-edition"
    )
    assert app_module._results_base("analyzer", []) == "/Shared/lakebridge-app/analyzer/unknown"


def test_reconcile_setup_validates_input(client):
    resp = client.post("/api/reconcile/setup", json={"data_source": "mongodb"})
    assert resp.status_code == 400
    resp = client.post(
        "/api/reconcile/setup",
        json={"data_source": "snowflake", "report_type": "all", "source_catalog": "db"},
    )
    assert resp.status_code == 400
    assert "uc_connection_name" in resp.get_json()["error"]


def test_reconcile_status_unconfigured(client, monkeypatch):
    monkeypatch.setattr(app_module, "_workspace_read", lambda path: None)
    data = client.get("/api/reconcile/status").get_json()
    assert data["configured"] is False
    assert data["job_id"] is None


def test_reconcile_table_config_name():
    config = {
        "report_type": "all",
        "source": {"dialect": "snowflake", "catalog": "db", "uc_connection_name": "conn"},
    }
    assert app_module._recon_table_config_name(config) == "recon_config_snowflake_conn_all.json"
    config["source"]["uc_connection_name"] = None
    assert app_module._recon_table_config_name(config) == "recon_config_snowflake_db_all.json"


def test_reconcile_run_requires_deployed_job(client, monkeypatch):
    monkeypatch.setattr(app_module, "_recon_job_id", lambda: None)
    resp = client.post("/api/reconcile/run", json={"operation": "reconcile"})
    assert resp.status_code == 409


def test_uc_status_all_ok(client, monkeypatch):
    monkeypatch.setattr(app_module, "_uc_cli", lambda args: (True, "{}"))
    data = client.get("/api/uc-status").get_json()
    assert data["ok"] is True
    assert data["fix_sql"] == []
    # catalog + 4 schemas + 4 volumes
    assert len(data["items"]) == 9
    assert {i["name"] for i in data["items"] if i["type"] == "volume"} == {
        "lakebridge.analyzer.runs",
        "lakebridge.converter.switch",
        "lakebridge.converter.morpheus_bb",
        "lakebridge.reconciler.reconcile_volume",
    }


def test_uc_status_missing_objects_produces_fix_sql(client, monkeypatch):
    monkeypatch.setattr(app_module, "_uc_cli", lambda args: (False, "denied"))
    data = client.get("/api/uc-status").get_json()
    assert data["ok"] is False
    assert any(s.startswith("CREATE CATALOG") for s in data["fix_sql"])
    assert any("GRANT" in s for s in data["fix_sql"])


def test_install_cli_reassembles_bundled_parts(monkeypatch, tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("databricks", b"#!/bin/sh\necho cli\n" * 1000)
    payload = buf.getvalue()

    vendor = tmp_path / "vendor"
    vendor.mkdir()
    base = f"databricks_cli_9.9.9_{installer._platform_suffix()}.zip"
    mid = len(payload) // 2
    (vendor / f"{base}.part-aa").write_bytes(payload[:mid])
    (vendor / f"{base}.part-ab").write_bytes(payload[mid:])

    target_dir = tmp_path / "bin"
    monkeypatch.setattr(installer, "VENDOR_DIR", vendor)
    monkeypatch.setattr(installer, "CLI_TARGET_DIR", target_dir)
    monkeypatch.setattr(installer, "CLI_PATH", target_dir / "databricks")

    logs: list[str] = []
    installer.install_cli(logs.append)

    assert (target_dir / "databricks").read_bytes() == b"#!/bin/sh\necho cli\n" * 1000
    assert any("bundled" in line for line in logs)


def test_install_java_from_bundled_parts(monkeypatch, tmp_path):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        data = b"#!/bin/sh\necho java\n"
        info = tarfile.TarInfo("jdk-17-jre/bin/java")
        info.size = len(data)
        info.mode = 0o755
        tf.addfile(info, io.BytesIO(data))
    payload = buf.getvalue()

    vendor = tmp_path / "vendor"
    vendor.mkdir()
    mid = len(payload) // 2
    (vendor / "temurin_jre_17_linux_x64.tar.gz.part-aa").write_bytes(payload[:mid])
    (vendor / "temurin_jre_17_linux_x64.tar.gz.part-ab").write_bytes(payload[mid:])

    monkeypatch.setattr(installer, "VENDOR_DIR", vendor)
    monkeypatch.setattr(installer, "JAVA_TARGET_DIR", tmp_path / "java")

    logs: list[str] = []
    installer.install_java(logs.append)

    assert (tmp_path / "java" / "jdk-17-jre" / "bin" / "java").exists()
    assert installer.java_bin_dir() == tmp_path / "java" / "jdk-17-jre" / "bin"


def test_spa_fallback_without_build(client, monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "FRONTEND_DIST", tmp_path)
    resp = client.get("/some/route")
    assert resp.status_code == 200
    assert b"Frontend not built" in resp.data
