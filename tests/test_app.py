import io
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


def test_spa_fallback_without_build(client, monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "FRONTEND_DIST", tmp_path)
    resp = client.get("/some/route")
    assert resp.status_code == 200
    assert b"Frontend not built" in resp.data
