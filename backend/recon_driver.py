"""Deploys lakebridge reconcile non-interactively.

Runs inside the lakebridge labs venv (which has databricks-labs-lakebridge
installed); the interactive `configure-reconcile` CLI command cannot be used
from the app container.
"""

import json
import sys

from databricks.sdk import WorkspaceClient

from databricks.labs.lakebridge.config import (
    LakebridgeConfiguration,
    ReconcileConfig,
    ReconcileMetadataConfig,
    SourceConnectionConfig,
    TargetConnectionConfig,
)
from databricks.labs.lakebridge.contexts.application import ApplicationContext


def main() -> None:
    with open(sys.argv[1], encoding="utf-8") as f:
        params = json.load(f)

    ctx = ApplicationContext(WorkspaceClient(product="lakebridge-app"))
    config = ReconcileConfig(
        report_type=params["report_type"],
        source=SourceConnectionConfig(
            dialect=params["data_source"],
            catalog=params["source_catalog"],
            schema=params["source_schema"],
            uc_connection_name=params.get("uc_connection_name") or None,
        ),
        target=TargetConnectionConfig(
            catalog=params["target_catalog"],
            schema=params["target_schema"],
        ),
        metadata_config=ReconcileMetadataConfig(),
    )
    ctx.installation.save(config)
    print(f"Saved reconcile config to {ctx.installation.install_folder()}/reconcile.yml", flush=True)
    print("Deploying reconcile metadata, job, and dashboards (takes a few minutes)...", flush=True)
    ctx.workspace_installation.install(
        LakebridgeConfiguration(transpile=None, reconcile=config, profiler_dashboard=None)
    )
    print("Reconcile deployment complete.", flush=True)


if __name__ == "__main__":
    main()
