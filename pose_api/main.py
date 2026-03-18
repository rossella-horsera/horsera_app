"""
Horsera Pose API — main.py
FastAPI server: async video jobs + synchronous single-frame endpoint.
"""
from __future__ import annotations

import base64
import logging
import os
import threading
import time
import uuid
from enum import Enum
from typing import Optional

import cv2
import numpy as np
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipeline import analyze_video, analyze_frame
import db as _db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Horsera Pose API",
    description=(
        "YOLOv8s-pose biomechanics analysis for equestrian riders. "
        "Horse-aware detection, CAE preprocessing, APS v4 scoring."
    ),
    version="1.0.0",
)

ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "https://horsera.app,http://localhost:5173,http://localhost:8080",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory job store ───────────────────────────────────────────────────────
# MVP: single-process in-memory store.
# Production: replace with Redis + Celery or a task queue.

class JobStatus(str, Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    COMPLETE   = "complete"
    FAILED     = "failed"


_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _get_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"Job {job_id!r} not found")
    return job


def _update_job(job_id: str, **kwargs) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


# ── Background processing ────────────────────────────────────────────────────

def _process_video(job_id: str, tmp_path: str, filename: str, size_mb: float) -> None:
    started_at = time.time()
    _update_job(job_id, status=JobStatus.PROCESSING, started_at=started_at)
    # DB writes are best-effort — a Supabase error must never block pose analysis.
    try:
        _db.upsert_job(job_id, {
            "filename":   filename,
            "size_mb":    size_mb,
            "status":     JobStatus.PROCESSING,
            "created_at": started_at,
        })
    except Exception as db_exc:
        logger.warning(f"[db] upsert_job(processing) failed — continuing: {db_exc}")

    try:
        result      = analyze_video(tmp_path)
        completed   = time.time()
        result_dict = result.to_dict()
        _update_job(
            job_id,
            status       = JobStatus.COMPLETE,
            result       = result_dict,
            completed_at = completed,
        )
        try:
            _db.upsert_job(job_id, {
                "status":          JobStatus.COMPLETE,
                "overall_score":   result.overallScore,
                "detection_rate":  result.detectionRate,
                "cae_index":       result.caeIndex,
                "aps_score":       result.apsScore,
                "frames_analyzed": result.framesAnalyzed,
                "frames_total":    result.framesTotal,
                "biometrics":      result_dict["biometrics"],
                "riding_quality":  result_dict["ridingQuality"],
                "insights":        result.insights,
                "completed_at":    completed,
            })
            _db.insert_frames(job_id, result.frames_data)
        except Exception as db_exc:
            logger.warning(f"[db] upsert_job(complete) failed — results still returned: {db_exc}")
        logger.info(f"Job {job_id} complete — overall {result.overallScore:.2f}")
    except Exception as exc:
        logger.exception(f"Job {job_id} failed")
        _update_job(job_id, status=JobStatus.FAILED, error=str(exc))
        try:
            _db.upsert_job(job_id, {"status": JobStatus.FAILED, "filename": filename, "error": str(exc)})
        except Exception as db_exc:
            logger.warning(f"[db] upsert_job(failed) failed: {db_exc}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    """Health check — returns model info and active job count."""
    with _jobs_lock:
        active = sum(
            1 for j in _jobs.values()
            if j["status"] in (JobStatus.PENDING, JobStatus.PROCESSING)
        )
    return {
        "status":      "ok",
        "model":       "yolov8s-pose",
        "horse_det":   "yolov8n",
        "active_jobs": active,
    }


@app.post("/analyze/video")
async def analyze_video_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> JSONResponse:
    """
    Accept a riding video and enqueue analysis.
    Returns a job_id immediately — poll GET /jobs/{job_id} for results.

    Supports: MP4, MOV, AVI, M4V (max 2 GB).
    """
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in {".mp4", ".mov", ".avi", ".m4v", ".webm"}:
        raise HTTPException(400, f"Unsupported format {ext!r}. Use MP4, MOV, AVI, or WebM.")

    job_id   = str(uuid.uuid4())
    tmp_path = f"/tmp/horsera_{job_id}{ext}"

    # Stream upload directly to disk — never hold the whole file in RAM.
    # Railway Hobby has 512 MB total; reading large files into memory causes OOM.
    MAX_SIZE  = 2 * 1024 ** 3  # 2 GB hard limit
    CHUNK     = 1024 * 1024    # 1 MB read chunks
    file_size = 0
    try:
        with open(tmp_path, "wb") as tmp_f:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_SIZE:
                    raise HTTPException(413, "File too large — max 2 GB")
                tmp_f.write(chunk)
    except HTTPException:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
    except Exception as exc:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(500, f"Failed to receive upload: {exc}") from exc

    size_mb = round(file_size / 1024 ** 2, 1)

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id":      job_id,
            "filename":    file.filename,
            "size_mb":     size_mb,
            "status":      JobStatus.PENDING,
            "created_at":  time.time(),
            "result":      None,
            "error":       None,
        }

    background_tasks.add_task(_process_video, job_id, tmp_path, file.filename, size_mb)

    logger.info(f"Queued job {job_id} — {file.filename} ({size_mb:.1f} MB)")
    return JSONResponse({"job_id": job_id, "status": "pending"}, status_code=202)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> JSONResponse:
    """
    Poll a video analysis job.

    Response shape:
    {
      "job_id":   "...",
      "status":   "pending" | "processing" | "complete" | "failed",
      "result":   { biometrics, ridingQuality, overallScore, ... } | null,
      "error":    "..." | null
    }
    """
    job = _get_job(job_id)
    # Don't expose the internal tmp path
    return JSONResponse({k: v for k, v in job.items() if k not in ("tmp_path",)})


class FrameRequest(BaseModel):
    image_b64: str  # base64-encoded JPEG or PNG frame


@app.post("/analyze/frame")
def analyze_frame_endpoint(req: FrameRequest) -> JSONResponse:
    """
    Synchronous single-frame pose analysis.
    Accepts a base64-encoded image (JPEG or PNG).

    Returns:
    {
      "detected":  true | false,
      "valid":     true | false,
      "apsScore":  float,
      "keypoints": [[x, y, conf], ...] (17 joints, COCO order) | null
    }

    Typical use: real-time overlay in a future live-session feature.
    """
    try:
        img_bytes = base64.b64decode(req.image_b64)
        arr       = np.frombuffer(img_bytes, dtype=np.uint8)
        frame     = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data")

    if frame is None:
        raise HTTPException(400, "Could not decode image — send a valid JPEG or PNG")

    result = analyze_frame(frame)
    return JSONResponse(result)

