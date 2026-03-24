"""
Horsera Pose API — main.py
FastAPI server: async video jobs + synchronous single-frame endpoint.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import timedelta
from enum import Enum
from typing import Any, Optional

import httpx
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import db as _db
# pipeline is imported at module load so that onnxruntime + ONNX models are
# resident in memory before any request arrives.  Loading them lazily on the
# first video request caused an OOM spike mid-processing that killed the
# process, making every subsequent poll return a Railway 502 with no CORS
# headers.  Total memory is the same either way; eager loading just moves the
# spike to startup where Railway is more tolerant of it.
import pipeline as _pipeline  # noqa: F401 — side-effectful import

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

GCS_UPLOAD_BUCKET = os.environ.get("GCS_UPLOAD_BUCKET", "").strip()
GCS_UPLOAD_PREFIX = os.environ.get("GCS_UPLOAD_PREFIX", "uploads").strip("/") or "uploads"
GCS_SIGNING_SERVICE_ACCOUNT_EMAIL = os.environ.get("GCS_SIGNING_SERVICE_ACCOUNT_EMAIL", "").strip()
SIGNED_URL_TTL_SECONDS = int(os.environ.get("SIGNED_URL_TTL_SECONDS", "900"))
JOB_STORE_BACKEND = os.environ.get("JOB_STORE_BACKEND", "memory").strip().lower()
FIRESTORE_COLLECTION = os.environ.get("FIRESTORE_COLLECTION", "pose_jobs").strip() or "pose_jobs"
EXECUTION_BACKEND = os.environ.get("EXECUTION_BACKEND", "inline").strip().lower()
GPU_THRESHOLD_MB = float(os.environ.get("GPU_THRESHOLD_MB", "120"))
CLOUD_RUN_PROJECT = os.environ.get("CLOUD_RUN_PROJECT", "").strip()
CLOUD_RUN_REGION = os.environ.get("CLOUD_RUN_REGION", "").strip()
CLOUD_RUN_CPU_JOB = os.environ.get("CLOUD_RUN_CPU_JOB", "").strip()
CLOUD_RUN_GPU_JOB = os.environ.get("CLOUD_RUN_GPU_JOB", "").strip()

_gcs_client = None
_firestore_client = None


@app.on_event("startup")
def _preload_models() -> None:
    """Load ONNX sessions at startup so inference memory is stable before requests arrive."""
    try:
        _pipeline._get_sessions()
        logger.info("[startup] ONNX models loaded successfully")
    except Exception as exc:
        logger.error(f"[startup] Failed to pre-load ONNX models: {exc}")

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


def _db_row_to_job_payload(row: dict) -> dict:
    status_raw = str(row.get("status") or JobStatus.FAILED)
    try:
        status = JobStatus(status_raw)
    except Exception:
        status = JobStatus.FAILED

    result = None
    if status == JobStatus.COMPLETE:
        biometrics = row.get("biometrics")
        riding_quality = row.get("riding_quality")
        if isinstance(biometrics, dict) and isinstance(riding_quality, dict):
            result = {
                "biometrics": biometrics,
                "ridingQuality": riding_quality,
                "overallScore": row.get("overall_score"),
                "detectionRate": row.get("detection_rate"),
                "caeIndex": row.get("cae_index"),
                "apsScore": row.get("aps_score"),
                "framesAnalyzed": row.get("frames_analyzed"),
                "framesTotal": row.get("frames_total"),
                "insights": row.get("insights") or [],
                # DB does not currently store framesData for API replay.
                "framesData": [],
            }

    return {
        "job_id": row.get("job_id"),
        "filename": row.get("filename"),
        "size_mb": float(row.get("size_mb") or 0.0),
        "status": status,
        "created_at": row.get("created_at"),
        "completed_at": row.get("completed_at"),
        "result": result,
        "error": row.get("error"),
    }


def _get_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is not None:
        return job

    fs_job = _firestore_get_job(job_id)
    if fs_job is not None:
        return fs_job

    # Fallback to Supabase persistence so completed/failed jobs can still be
    # retrieved after process restarts while we migrate off in-memory state.
    row = _db.get_job(job_id)
    if row is not None:
        return _db_row_to_job_payload(row)

    raise HTTPException(404, f"Job {job_id!r} not found")


def _update_job(job_id: str, **kwargs) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)
    if kwargs:
        _firestore_upsert_job(job_id, kwargs)


def _create_job(job_id: str, payload: dict) -> None:
    with _jobs_lock:
        _jobs[job_id] = payload
    _firestore_upsert_job(job_id, payload)


def _sanitize_filename(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return safe or "upload.mp4"


def _get_gcs_client():
    global _gcs_client
    if _gcs_client is None:
        try:
            from google.cloud import storage
        except Exception as exc:
            raise RuntimeError(
                "google-cloud-storage is not installed. Add it to requirements.txt."
            ) from exc
        _gcs_client = storage.Client()
    return _gcs_client


def _resolve_signing_service_account_email(creds: Any) -> str:
    if GCS_SIGNING_SERVICE_ACCOUNT_EMAIL:
        return GCS_SIGNING_SERVICE_ACCOUNT_EMAIL

    email = str(getattr(creds, "service_account_email", "") or "").strip()
    if email and email != "default":
        return email

    # Cloud Run metadata fallback for default service account email.
    try:
        resp = httpx.get(
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
            headers={"Metadata-Flavor": "Google"},
            timeout=2.0,
        )
        if resp.status_code == 200 and resp.text.strip():
            return resp.text.strip()
    except Exception:
        pass
    return ""


def _generate_signed_upload_url(blob: Any, content_type: str) -> str:
    expiration = timedelta(seconds=SIGNED_URL_TTL_SECONDS)
    direct_exc: Exception | None = None

    # Works when credentials include an embedded signer (e.g., local keyfile).
    try:
        return blob.generate_signed_url(
            version="v4",
            expiration=expiration,
            method="PUT",
            content_type=content_type,
        )
    except Exception as exc:
        direct_exc = exc
        logger.warning(f"Direct V4 signing failed; trying IAM signBlob fallback: {exc}")

    # Cloud Run fallback: sign via IAM using access token + service account email.
    try:
        import google.auth
        from google.auth.transport.requests import Request as GoogleAuthRequest
    except Exception as exc:
        raise RuntimeError(
            f"google-auth libraries unavailable for V4 signing fallback: {exc}"
        ) from exc

    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    creds, _project = google.auth.default(scopes=scopes)
    creds.refresh(GoogleAuthRequest())
    if not creds.token:
        raise RuntimeError("Failed to obtain access token for signed URL generation")

    signer_email = _resolve_signing_service_account_email(creds)
    if not signer_email:
        raise RuntimeError(
            "Failed to resolve signing service account email. "
            "Set GCS_SIGNING_SERVICE_ACCOUNT_EMAIL in the API environment."
        )

    try:
        return blob.generate_signed_url(
            version="v4",
            expiration=expiration,
            method="PUT",
            content_type=content_type,
            service_account_email=signer_email,
            access_token=creds.token,
        )
    except Exception as fallback_exc:
        raise RuntimeError(
            f"Failed to generate signed URL. direct_sign={direct_exc}; iam_sign_blob={fallback_exc}"
        ) from fallback_exc


def _is_firestore_enabled() -> bool:
    return JOB_STORE_BACKEND == "firestore"


def _get_firestore_client():
    global _firestore_client
    if _firestore_client is None:
        try:
            from google.cloud import firestore
        except Exception as exc:
            raise RuntimeError(
                "google-cloud-firestore is not installed. Add it to requirements.txt."
            ) from exc
        _firestore_client = firestore.Client()
    return _firestore_client


def _jsonable(value: Any) -> Any:
    if isinstance(value, JobStatus):
        return value.value
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _firestore_upsert_job(job_id: str, payload: dict) -> None:
    if not _is_firestore_enabled():
        return
    try:
        client = _get_firestore_client()
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(job_id)
        doc_ref.set(_jsonable(payload), merge=True)
    except Exception as exc:
        logger.warning(f"[firestore] upsert [{job_id}] failed: {exc}")


def _firestore_get_job(job_id: str) -> dict | None:
    if not _is_firestore_enabled():
        return None
    try:
        client = _get_firestore_client()
        snap = client.collection(FIRESTORE_COLLECTION).document(job_id).get()
        if not snap.exists:
            return None
        payload = snap.to_dict() or {}
        status_raw = str(payload.get("status") or JobStatus.FAILED.value)
        try:
            payload["status"] = JobStatus(status_raw)
        except Exception:
            payload["status"] = JobStatus.FAILED
        payload.setdefault("job_id", job_id)
        payload.setdefault("result", None)
        payload.setdefault("error", None)
        return payload
    except Exception as exc:
        logger.warning(f"[firestore] get [{job_id}] failed: {exc}")
        return None


def _choose_worker_job_name(size_mb: float) -> str:
    if size_mb >= GPU_THRESHOLD_MB and CLOUD_RUN_GPU_JOB:
        return CLOUD_RUN_GPU_JOB
    return CLOUD_RUN_CPU_JOB


def _build_cloud_run_job_path(job_name: str) -> str:
    project = CLOUD_RUN_PROJECT
    if not project:
        try:
            import google.auth
            _creds, detected_project = google.auth.default()
            project = detected_project or ""
        except Exception:
            project = ""
    if not project or not CLOUD_RUN_REGION:
        raise RuntimeError(
            "CLOUD_RUN_PROJECT and CLOUD_RUN_REGION must be set for EXECUTION_BACKEND=cloud_run_job"
        )
    return f"projects/{project}/locations/{CLOUD_RUN_REGION}/jobs/{job_name}"


def _trigger_cloud_run_job(job_name: str, env_vars: dict[str, str]) -> str:
    """
    Trigger a Cloud Run Job execution via REST and return operation name.
    """
    try:
        import google.auth
        from google.auth.transport.requests import Request as GoogleAuthRequest
    except Exception as exc:
        raise RuntimeError("google-auth libraries unavailable for Cloud Run Job dispatch") from exc

    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    creds, _project = google.auth.default(scopes=scopes)
    creds.refresh(GoogleAuthRequest())
    if not creds.token:
        raise RuntimeError("Failed to obtain access token for Cloud Run Job dispatch")

    job_path = _build_cloud_run_job_path(job_name)
    url = f"https://run.googleapis.com/v2/{job_path}:run"
    request_body = {
        "overrides": {
            "containerOverrides": [
                {
                    "env": [{"name": k, "value": v} for k, v in env_vars.items()]
                }
            ]
        }
    }
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(url, headers=headers, content=json.dumps(request_body), timeout=20.0)
    if resp.status_code >= 300:
        raise RuntimeError(f"Cloud Run Job dispatch failed [{resp.status_code}]: {resp.text[:300]}")
    payload = resp.json()
    return str(payload.get("name") or "")


def _build_object_name(filename: str) -> str:
    safe_name = _sanitize_filename(filename)
    return f"{GCS_UPLOAD_PREFIX}/{uuid.uuid4()}_{safe_name}"


def _parse_gs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("gs://"):
        raise ValueError("object_path must start with gs://")
    without = uri[5:]
    if "/" not in without:
        raise ValueError("object_path must include bucket and object key")
    bucket, object_name = without.split("/", 1)
    if not bucket or not object_name:
        raise ValueError("object_path must include bucket and object key")
    return bucket, object_name


def _download_from_gcs(object_path: str, dest_path: str) -> None:
    bucket_name, object_name = _parse_gs_uri(object_path)
    client = _get_gcs_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    if not blob.exists():
        raise FileNotFoundError(f"GCS object not found: {object_path}")
    blob.download_to_filename(dest_path)


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
        result      = _pipeline.analyze_video(tmp_path)
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


def _process_video_from_gcs(
    job_id: str,
    object_path: str,
    filename: str,
    size_mb: float,
) -> None:
    ext = os.path.splitext(filename)[1].lower() or ".mp4"
    tmp_path = f"/tmp/horsera_{job_id}{ext}"
    try:
        _download_from_gcs(object_path, tmp_path)
    except Exception as exc:
        logger.exception(f"Job {job_id} failed to download object {object_path!r}")
        _update_job(job_id, status=JobStatus.FAILED, error=f"Failed to download object: {exc}")
        try:
            _db.upsert_job(job_id, {"status": JobStatus.FAILED, "filename": filename, "error": str(exc)})
        except Exception as db_exc:
            logger.warning(f"[db] upsert_job(failed_download) failed: {db_exc}")
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return

    _process_video(job_id, tmp_path, filename, size_mb)


def run_worker_job(job_id: str, object_path: str, filename: str, size_mb: float) -> None:
    """
    Worker entrypoint for Cloud Run Jobs.
    Ensures the job record exists, then runs the same processing pipeline.
    """
    try:
        _get_job(job_id)
    except HTTPException:
        _create_job(job_id, {
            "job_id": job_id,
            "filename": filename,
            "size_mb": float(size_mb or 0.0),
            "object_path": object_path,
            "status": JobStatus.PENDING,
            "created_at": time.time(),
            "result": None,
            "error": None,
        })
    _process_video_from_gcs(job_id, object_path, filename, float(size_mb or 0.0))


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> dict:
    return {"status": "ok"}


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


class UploadUrlRequest(BaseModel):
    filename: str
    content_type: str = Field(default="video/mp4")
    size_bytes: Optional[int] = None


class AnalyzeObjectRequest(BaseModel):
    object_path: str
    filename: str
    size_mb: Optional[float] = None


@app.post("/uploads/video-url")
def create_video_upload_url(req: UploadUrlRequest) -> JSONResponse:
    """
    Returns a V4 signed URL for direct browser upload to GCS.

    The client should `PUT` the file bytes to `upload_url` with:
      Content-Type: <content_type>
    """
    if not GCS_UPLOAD_BUCKET:
        raise HTTPException(500, "GCS_UPLOAD_BUCKET is not configured")

    object_name = _build_object_name(req.filename)
    object_path = f"gs://{GCS_UPLOAD_BUCKET}/{object_name}"
    try:
        client = _get_gcs_client()
        bucket = client.bucket(GCS_UPLOAD_BUCKET)
        blob = bucket.blob(object_name)
        upload_url = _generate_signed_upload_url(blob, req.content_type)
    except Exception as exc:
        logger.exception("Failed to generate signed upload URL")
        raise HTTPException(500, f"Failed to create signed upload URL: {exc}") from exc

    return JSONResponse({
        "upload_url": upload_url,
        "object_path": object_path,
        "expires_in_seconds": SIGNED_URL_TTL_SECONDS,
        "required_headers": {"Content-Type": req.content_type},
    })


@app.post("/analyze/video/object")
def analyze_video_object_endpoint(
    req: AnalyzeObjectRequest,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    """
    Enqueue analysis for a video already uploaded to Cloud Storage.
    """
    try:
        bucket_name, _object_name = _parse_gs_uri(req.object_path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if GCS_UPLOAD_BUCKET and bucket_name != GCS_UPLOAD_BUCKET:
        raise HTTPException(400, "object_path bucket does not match GCS_UPLOAD_BUCKET")

    job_id = str(uuid.uuid4())
    size_mb = req.size_mb
    if size_mb is None and req.object_path:
        size_mb = 0.0
    size_mb = round(float(size_mb or 0.0), 1)

    _create_job(job_id, {
        "job_id": job_id,
        "filename": req.filename,
        "size_mb": size_mb,
        "object_path": req.object_path,
        "status": JobStatus.PENDING,
        "created_at": time.time(),
        "result": None,
        "error": None,
    })

    if EXECUTION_BACKEND == "cloud_run_job":
        job_name = _choose_worker_job_name(size_mb)
        if not job_name:
            raise HTTPException(
                500,
                "CLOUD_RUN_CPU_JOB (and optionally CLOUD_RUN_GPU_JOB) must be set for cloud_run_job backend",
            )
        try:
            op_name = _trigger_cloud_run_job(
                job_name,
                env_vars={
                    "POSE_JOB_ID": job_id,
                    "POSE_OBJECT_PATH": req.object_path,
                    "POSE_FILENAME": req.filename,
                    "POSE_SIZE_MB": str(size_mb),
                },
            )
            _update_job(
                job_id,
                dispatch_backend="cloud_run_job",
                worker_job_name=job_name,
                worker_operation=op_name,
            )
            logger.info(f"Queued Cloud Run job {job_id} via {job_name} ({op_name})")
        except Exception as exc:
            logger.exception(f"Failed to dispatch Cloud Run job for {job_id}")
            _update_job(job_id, status=JobStatus.FAILED, error=f"Failed to dispatch worker: {exc}")
            try:
                _db.upsert_job(job_id, {"status": JobStatus.FAILED, "filename": req.filename, "error": str(exc)})
            except Exception as db_exc:
                logger.warning(f"[db] upsert_job(failed_dispatch) failed: {db_exc}")
            raise HTTPException(500, f"Failed to dispatch worker job: {exc}") from exc
    else:
        background_tasks.add_task(
            _process_video_from_gcs,
            job_id,
            req.object_path,
            req.filename,
            size_mb,
        )
        logger.info(f"Queued inline GCS job {job_id} — {req.object_path}")

    return JSONResponse({"job_id": job_id, "status": "pending"}, status_code=202)


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

    _create_job(job_id, {
        "job_id":      job_id,
        "filename":    file.filename,
        "size_mb":     size_mb,
        "status":      JobStatus.PENDING,
        "created_at":  time.time(),
        "result":      None,
        "error":       None,
    })

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
        import cv2
        import numpy as np
        img_bytes = base64.b64decode(req.image_b64)
        arr       = np.frombuffer(img_bytes, dtype=np.uint8)
        frame     = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data")

    if frame is None:
        raise HTTPException(400, "Could not decode image — send a valid JPEG or PNG")

    result = _pipeline.analyze_frame(frame)
    return JSONResponse(result)
