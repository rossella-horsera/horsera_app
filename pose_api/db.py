"""
Horsera Pose API — db.py
Supabase write helpers for pose_jobs / pose_frames tables.

Uses httpx directly against the Supabase REST API (PostgREST) instead of
supabase-py — this avoids client-side key-format validation that rejects
the publishable key format in supabase-py >= 2.x.

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

import httpx

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

def _cfg() -> tuple[str, dict] | tuple[None, None]:
    """Return (base_url, headers) or (None, None) if not configured."""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        return None, None
    headers = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }
    return f"{url}/rest/v1", headers


# ── Public helpers ────────────────────────────────────────────────────────────

def upsert_job(job_id: str, payload: dict) -> None:
    """Upsert a row in pose_jobs via direct REST call. No-op if unconfigured."""
    base, headers = _cfg()
    if base is None:
        return
    row = {"job_id": job_id, **payload}
    try:
        resp = httpx.post(
            f"{base}/pose_jobs",
            headers=headers,
            json=row,
            timeout=10.0,
        )
        if resp.status_code not in (200, 201):
            logger.warning(f"[db] pose_jobs upsert [{job_id}] — {resp.status_code}: {resp.text[:200]}")
    except Exception as exc:
        logger.warning(f"[db] pose_jobs upsert [{job_id}] — {exc}")


def insert_frames(job_id: str, frames: list[dict]) -> None:
    """Batch-insert rows into pose_frames. No-op if unconfigured or empty."""
    if not frames:
        return
    base, headers = _cfg()
    if base is None:
        return
    _DB_COLS = {"frame_index", "aps_score", "cae_value", "keypoints"}
    rows = [{"job_id": job_id, **{k: v for k, v in f.items() if k in _DB_COLS}} for f in frames]
    # Insert in batches of 500 to stay within PostgREST body limits
    batch_size = 500
    hdrs = {**headers, "Prefer": "return=minimal"}
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            resp = httpx.post(
                f"{base}/pose_frames",
                headers=hdrs,
                json=batch,
                timeout=30.0,
            )
            if resp.status_code not in (200, 201):
                logger.warning(f"[db] pose_frames insert [{job_id}] batch {i//batch_size} — {resp.status_code}: {resp.text[:200]}")
        except Exception as exc:
            logger.warning(f"[db] pose_frames insert [{job_id}] batch {i//batch_size} — {exc}")
