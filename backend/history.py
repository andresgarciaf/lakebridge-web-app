"""Analyzer run history: ingests analysis-report.json into Delta tables.

Tables live in lakebridge.analyzer (owned by the app SP); raw reports are
staged in the lakebridge.analyzer.runs volume. Statements run through the SQL
Statements API on a warehouse the app can use (DATABRICKS_WAREHOUSE_ID env or
the first visible warehouse).
"""

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from .installer import CLI_PATH, cli_env

CATALOG = "lakebridge"
SCHEMA = "analyzer"
VOLUME_DIR = f"/Volumes/{CATALOG}/{SCHEMA}/runs"

_DDL = [
    f"""CREATE TABLE IF NOT EXISTS {CATALOG}.{SCHEMA}.runs (
        run_id STRING, run_ts TIMESTAMP, source_tech STRING, workspace_dir STRING,
        file_count INT, total_lines BIGINT, total_statements BIGINT,
        complexity_json STRING)""",
    f"""CREATE TABLE IF NOT EXISTS {CATALOG}.{SCHEMA}.inventory (
        run_id STRING, source_file STRING, script_type STRING, complexity_level STRING,
        line_count INT, statement_count INT, proc_function_count INT,
        categories_json STRING, function_calls_json STRING)""",
    f"""CREATE TABLE IF NOT EXISTS {CATALOG}.{SCHEMA}.object_relations (
        run_id STRING, source_file STRING, object STRING, action STRING, cnt INT)""",
]

_warehouse_id: str | None = None


def _api(method: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    proc = subprocess.run(
        [str(CLI_PATH), "api", method, path, "--json", json.dumps(payload)],
        capture_output=True,
        text=True,
        timeout=120,
        env=cli_env(),
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:500])
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def warehouse_id() -> str | None:
    global _warehouse_id
    if _warehouse_id:
        return _warehouse_id
    env_id = os.environ.get("DATABRICKS_WAREHOUSE_ID")
    if env_id:
        _warehouse_id = env_id
        return env_id
    try:
        warehouses = _api("get", "/api/2.0/sql/warehouses", {}).get("warehouses", [])
    except RuntimeError:
        return None
    if warehouses:
        _warehouse_id = warehouses[0]["id"]
    return _warehouse_id


def sql(statement: str, parameters: list[dict[str, Any]] | None = None) -> list[list[Any]]:
    wh = warehouse_id()
    if not wh:
        raise RuntimeError(
            "no SQL warehouse available to the app (grant CAN_USE or set DATABRICKS_WAREHOUSE_ID)"
        )
    payload: dict[str, Any] = {"warehouse_id": wh, "statement": statement, "wait_timeout": "50s"}
    if parameters:
        payload["parameters"] = parameters
    result = _api("post", "/api/2.0/sql/statements", payload)
    state = result.get("status", {}).get("state")
    statement_id = result.get("statement_id")
    deadline = time.time() + 180
    while state in ("PENDING", "RUNNING") and time.time() < deadline:
        time.sleep(2)
        result = _api("get", f"/api/2.0/sql/statements/{statement_id}", {})
        state = result.get("status", {}).get("state")
    if state != "SUCCEEDED":
        message = result.get("status", {}).get("error", {}).get("message", state)
        raise RuntimeError(f"SQL failed: {message}"[:500])
    return (result.get("result") or {}).get("data_array") or []


def _ensure_tables() -> None:
    for ddl in _DDL:
        sql(ddl)


def ingest_analyzer_run(
    job_id: str, source_tech: str, workspace_dir: str, output_dir: Path
) -> str:
    reports = sorted(output_dir.glob("*.json"))
    if not reports:
        return "No JSON report found; skipping run-history ingestion."
    report = reports[0]
    data = json.loads(report.read_text())
    inventory = data.get("inventory") or []
    run_ts = (data.get("runInfo") or {}).get("startTime")

    volume_path = f"{VOLUME_DIR}/{job_id}.json"
    proc = subprocess.run(
        [str(CLI_PATH), "fs", "cp", str(report), f"dbfs:{volume_path}", "--overwrite"],
        capture_output=True,
        text=True,
        timeout=120,
        env=cli_env(),
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:300])

    _ensure_tables()
    complexity: dict[str, int] = {}
    for item in inventory:
        level = item.get("complexityLevel") or "UNKNOWN"
        complexity[level] = complexity.get(level, 0) + 1

    params = [
        {"name": "run_id", "value": job_id},
        {"name": "run_ts", "value": run_ts, "type": "TIMESTAMP"},
        {"name": "source_tech", "value": source_tech},
        {"name": "workspace_dir", "value": workspace_dir},
        {"name": "file_count", "value": str(len(inventory)), "type": "INT"},
        {"name": "total_lines", "value": str(sum(i.get("lineCount") or 0 for i in inventory)), "type": "BIGINT"},
        {
            "name": "total_statements",
            "value": str(sum(i.get("statementCount") or 0 for i in inventory)),
            "type": "BIGINT",
        },
        {"name": "complexity_json", "value": json.dumps(complexity)},
    ]
    sql(f"DELETE FROM {CATALOG}.{SCHEMA}.runs WHERE run_id = :run_id", [params[0]])
    sql(
        f"""INSERT INTO {CATALOG}.{SCHEMA}.runs
            VALUES (:run_id, :run_ts, :source_tech, :workspace_dir,
                    :file_count, :total_lines, :total_statements, :complexity_json)""",
        params,
    )
    run_param = [{"name": "run_id", "value": job_id}]
    sql(f"DELETE FROM {CATALOG}.{SCHEMA}.inventory WHERE run_id = :run_id", run_param)
    sql(
        f"""INSERT INTO {CATALOG}.{SCHEMA}.inventory
            SELECT :run_id, inv.sourceFile, inv.scriptType, inv.complexityLevel,
                   inv.lineCount, inv.statementCount, inv.procAndFunctionCount,
                   to_json(inv.scriptCategories), to_json(inv.functionCall)
            FROM (SELECT explode(inventory) AS inv
                  FROM read_files('{volume_path}', format => 'json', multiLine => true))""",
        run_param,
    )
    sql(f"DELETE FROM {CATALOG}.{SCHEMA}.object_relations WHERE run_id = :run_id", run_param)
    sql(
        f"""INSERT INTO {CATALOG}.{SCHEMA}.object_relations
            SELECT :run_id, inv.sourceFile, rel.object, rel.action, rel.count
            FROM (SELECT explode(inventory) AS inv
                  FROM read_files('{volume_path}', format => 'json', multiLine => true))
            LATERAL VIEW explode(inv.objectRel) t AS rel""",
        run_param,
    )
    return f"Run history recorded in {CATALOG}.{SCHEMA} (run {job_id})."


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    rows = sql(
        f"""SELECT run_id, CAST(run_ts AS STRING), source_tech, workspace_dir,
                   file_count, total_lines, total_statements, complexity_json
            FROM {CATALOG}.{SCHEMA}.runs ORDER BY run_ts DESC LIMIT {int(limit)}"""
    )
    return [
        {
            "run_id": r[0],
            "run_ts": r[1],
            "source_tech": r[2],
            "workspace_dir": r[3],
            "file_count": int(r[4] or 0),
            "total_lines": int(r[5] or 0),
            "total_statements": int(r[6] or 0),
            "complexity": json.loads(r[7] or "{}"),
        }
        for r in rows
    ]


def run_lineage(run_id: str) -> dict[str, Any]:
    run_param = [{"name": "run_id", "value": run_id}]
    node_rows = sql(
        f"""SELECT object, lower(action), COUNT(DISTINCT source_file), SUM(cnt)
            FROM {CATALOG}.{SCHEMA}.object_relations
            WHERE run_id = :run_id GROUP BY object, lower(action)""",
        run_param,
    )
    nodes: dict[str, dict[str, Any]] = {}
    for obj, action, files, refs in node_rows:
        node = nodes.setdefault(obj, {"name": obj, "actions": {}, "files": 0, "references": 0})
        node["actions"][action] = int(files or 0)
        node["files"] += int(files or 0)
        node["references"] += int(refs or 0)

    # A script that reads X and creates/writes Y implies data flow X -> Y,
    # with the script kept as edge metadata.
    edge_rows = sql(
        f"""SELECT r.object, w.object, w.source_file, lower(w.action)
            FROM {CATALOG}.{SCHEMA}.object_relations r
            JOIN {CATALOG}.{SCHEMA}.object_relations w
              ON r.run_id = w.run_id AND r.source_file = w.source_file
            WHERE r.run_id = :run_id
              AND lower(r.action) = 'read'
              AND lower(w.action) <> 'read'
              AND r.object <> w.object""",
        run_param,
    )
    edges: dict[tuple[str, str], dict[str, Any]] = {}
    for src, dst, source_file, action in edge_rows:
        edge = edges.setdefault((src, dst), {"src": src, "dst": dst, "files": []})
        entry = {"file": source_file, "action": action}
        if entry not in edge["files"]:
            edge["files"].append(entry)
    return {
        "nodes": sorted(nodes.values(), key=lambda n: -n["references"]),
        "edges": sorted(edges.values(), key=lambda e: (e["src"], e["dst"])),
    }


def run_insights(run_id: str) -> dict[str, Any]:
    run_param = [{"name": "run_id", "value": run_id}]
    functions = sql(
        f"""SELECT k, SUM(v) FROM {CATALOG}.{SCHEMA}.inventory
            LATERAL VIEW explode(from_json(function_calls_json, 'MAP<STRING,INT>')) t AS k, v
            WHERE run_id = :run_id GROUP BY k ORDER BY 2 DESC LIMIT 12""",
        run_param,
    )
    categories = sql(
        f"""SELECT cat, COUNT(*) FROM {CATALOG}.{SCHEMA}.inventory
            LATERAL VIEW explode(from_json(categories_json, 'ARRAY<STRING>')) t AS cat
            WHERE run_id = :run_id GROUP BY cat ORDER BY 2 DESC LIMIT 12""",
        run_param,
    )
    objects = sql(
        f"""SELECT action, COUNT(DISTINCT object), SUM(cnt)
            FROM {CATALOG}.{SCHEMA}.object_relations
            WHERE run_id = :run_id GROUP BY action ORDER BY 2 DESC""",
        run_param,
    )
    files = sql(
        f"""SELECT source_file, complexity_level, line_count, statement_count
            FROM {CATALOG}.{SCHEMA}.inventory WHERE run_id = :run_id
            ORDER BY line_count DESC LIMIT 15""",
        run_param,
    )
    return {
        "functions": [{"name": r[0], "count": int(r[1] or 0)} for r in functions],
        "categories": [{"name": r[0], "count": int(r[1] or 0)} for r in categories],
        "objects": [
            {"action": r[0], "objects": int(r[1] or 0), "references": int(r[2] or 0)}
            for r in objects
        ],
        "largest_files": [
            {"file": r[0], "complexity": r[1], "lines": int(r[2] or 0), "statements": int(r[3] or 0)}
            for r in files
        ],
    }
