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

def _process_video(job_id: str, tmp_path: str) -> None:
    _update_job(job_id, status=JobStatus.PROCESSING, started_at=time.time())
    try:
        result = analyze_video(tmp_path)
        _update_job(
            job_id,
            status     = JobStatus.COMPLETE,
            result     = result.to_dict(),
            completed_at = time.time(),
        )
        logger.info(f"Job {job_id} complete — overall {result.overallScore:.2f}")
    except Exception as exc:
        logger.exception(f"Job {job_id} failed")
        _update_job(job_id, status=JobStatus.FAILED, error=str(exc))
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
    if ext not in {".mp4", ".mov", ".avi", ".m4v"}:
        raise HTTPException(400, f"Unsupported format {ext!r}. Use MP4, MOV, or AVI.")

    content = await file.read()
    if len(content) > 2 * 1024 ** 3:
        raise HTTPException(413, "File too large — max 2 GB")

    job_id   = str(uuid.uuid4())
    tmp_path = f"/tmp/horsera_{job_id}{ext}"

    with open(tmp_path, "wb") as f:
        f.write(content)

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id":      job_id,
            "filename":    file.filename,
            "size_mb":     round(len(content) / 1024 ** 2, 1),
            "status":      JobStatus.PENDING,
            "created_at":  time.time(),
            "result":      None,
            "error":       None,
        }

    background_tasks.add_task(_process_video, job_id, tmp_path)

    logger.info(f"Queued job {job_id} — {file.filename} ({len(content)/1024**2:.1f} MB)")
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
