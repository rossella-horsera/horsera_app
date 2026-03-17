"""
Horsera Pose API — db.py
Supabase client and write helpers for pose_jobs / pose_frames tables.

Tables expected in Supabase:

  pose_jobs (
    job_id        text primary key,
    filename      text,
    size_mb       numeric,
    status        text,           -- pending | processing | complete | failed
    overall_score numeric,
    detection_rate numeric,
    cae_index     numeric,
    aps_score     numeric,
    frames_analyzed integer,
    frames_total    integer,
    biometrics    jsonb,
    riding_quality jsonb,
    insights      jsonb,
    error         text,
    created_at    timestamptz default now(),
    completed_at  timestamptz
  )

  pose_frames (
    id            bigserial primary key,
    job_id        text references pose_jobs(job_id),
    frame_index   integer,
    aps_score     numeric,
    cae_value     numeric,
    keypoints     jsonb       -- [[x, y, conf], ...] 17 joints COCO order
  )
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_KEY", "")
        if not url or not key:
            logger.warning(
                "SUPABASE_URL or SUPABASE_KEY not set — Supabase writes disabled"
            )
            return None
        from supabase import create_client
        _client = create_client(url, key)
    return _client


def upsert_job(job_id: str, payload: dict) -> None:
    """Upsert a row in pose_jobs. Silent no-op if Supabase is not configured."""
    client = _get_client()
    if client is None:
        return
    try:
        client.table("pose_jobs").upsert({"job_id": job_id, **payload}).execute()
    except Exception as exc:
        logger.warning(f"pose_jobs upsert failed [{job_id}]: {exc}")


def insert_frames(job_id: str, frames: list[dict]) -> None:
    """Batch-insert rows into pose_frames. Silent no-op if Supabase is not configured."""
    if not frames:
        return
    client = _get_client()
    if client is None:
        return
    try:
        rows = [{"job_id": job_id, **f} for f in frames]
        client.table("pose_frames").insert(rows).execute()
    except Exception as exc:
        logger.warning(f"pose_frames insert failed [{job_id}]: {exc}")
