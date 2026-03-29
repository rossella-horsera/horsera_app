"""
Horsera Pose API worker entrypoint.

Used by Cloud Run Jobs to process one GCS object and update job status.
"""
from __future__ import annotations

import argparse
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _arg_or_env(cli_value: str | None, env_key: str, required: bool = True) -> str:
    value = cli_value or os.environ.get(env_key, "").strip()
    if required and not value:
        raise ValueError(f"Missing required value: --{env_key.lower().replace('_', '-')} or {env_key}")
    return value


def main() -> int:
    # Cloud Run Job executions may provide per-run env overrides. Ensure
    # worker status persistence defaults to Firestore even if job-level envs
    # are missing.
    os.environ.setdefault("JOB_STORE_BACKEND", "firestore")
    os.environ.setdefault("FIRESTORE_COLLECTION", "pose_jobs")

    import main as api_main

    parser = argparse.ArgumentParser(description="Run one Horsera pose analysis job from GCS")
    parser.add_argument("--job-id")
    parser.add_argument("--object-path")
    parser.add_argument("--filename")
    parser.add_argument("--size-mb")
    args = parser.parse_args()

    job_id = _arg_or_env(args.job_id, "POSE_JOB_ID")
    object_path = _arg_or_env(args.object_path, "POSE_OBJECT_PATH")
    filename = _arg_or_env(args.filename, "POSE_FILENAME")
    size_mb_raw = _arg_or_env(args.size_mb, "POSE_SIZE_MB", required=False) or "0"

    try:
        size_mb = float(size_mb_raw)
    except Exception:
        size_mb = 0.0

    logger.info(
        "[worker] starting job_id=%s object_path=%s filename=%s size_mb=%.1f",
        job_id,
        object_path,
        filename,
        size_mb,
    )
    api_main.run_worker_job(job_id=job_id, object_path=object_path, filename=filename, size_mb=size_mb)
    logger.info("[worker] completed job_id=%s", job_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
