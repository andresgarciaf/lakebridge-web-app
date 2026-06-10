"""Deploys lakebridge reconcile non-interactively.

Runs inside the lakebridge labs venv (which has databricks-labs-lakebridge
installed); the interactive `configure-reconcile` CLI command cannot be used
from the app container.
"""

import json
import sys
from pathlib import Path

# Import lakebridge from lib/src (like the labs CLI does): the site-packages
# copy crashes at import because blueprint's get_logger needs the project
# root marker that only the lib checkout has.
_LIB_SRC = Path.home() / ".databricks" / "labs" / "lakebridge" / "lib" / "src"
if _LIB_SRC.is_dir():
    sys.path.insert(0, str(_LIB_SRC))

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
        # Reconcile metadata lives in the app's standard catalog layout.
        metadata_config=ReconcileMetadataConfig(
            catalog="lakebridge", schema="reconciler", volume="reconcile_volume"
        ),
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
