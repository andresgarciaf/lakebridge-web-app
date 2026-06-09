import os

from backend.app import app


def main() -> None:
    host = os.getenv("FLASK_RUN_HOST", "0.0.0.0")
    port = int(
        os.getenv("DATABRICKS_APP_PORT")
        or os.getenv("FLASK_RUN_PORT")
        or "8000"
    )
    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
