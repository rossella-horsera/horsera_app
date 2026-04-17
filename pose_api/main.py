"""
Horsera Pose API — main.py
FastAPI server: async video jobs + synchronous single-frame endpoint.
"""
from __future__ import annotations

import base64
import gzip
import json
import logging
import math
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


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(raw))
    except Exception:
        logger.warning("[config] Invalid integer for %s=%r; using default=%d", name, raw, default)
        return default

app = FastAPI(
    title="Horsera Pose API",
    description=(
        "YOLOv8m-pose biomechanics analysis for equestrian riders. "
        "Smart cropping for improved accuracy, horse-aware detection, CAE preprocessing, APS v4 scoring."
    ),
    version="2.0.0",
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
GCS_SAVED_PREFIX = os.environ.get("GCS_SAVED_PREFIX", "saved-rides").strip("/") or "saved-rides"
GCS_RESULTS_PREFIX = os.environ.get("GCS_RESULTS_PREFIX", "job-results").strip("/") or "job-results"
GCS_SIGNING_SERVICE_ACCOUNT_EMAIL = os.environ.get("GCS_SIGNING_SERVICE_ACCOUNT_EMAIL", "").strip()
SIGNED_URL_TTL_SECONDS = _env_int("SIGNED_URL_TTL_SECONDS", 900, minimum=60)
READ_URL_TTL_SECONDS = _env_int("READ_URL_TTL_SECONDS", 900, minimum=60)
JOB_STORE_BACKEND = os.environ.get("JOB_STORE_BACKEND", "memory").strip().lower()
FIRESTORE_COLLECTION = os.environ.get("FIRESTORE_COLLECTION", "pose_jobs").strip() or "pose_jobs"
EXECUTION_BACKEND = os.environ.get("EXECUTION_BACKEND", "inline").strip().lower()
GPU_THRESHOLD_MB = float(os.environ.get("GPU_THRESHOLD_MB", "120"))
CLOUD_RUN_PROJECT = os.environ.get("CLOUD_RUN_PROJECT", "").strip()
CLOUD_RUN_REGION = os.environ.get("CLOUD_RUN_REGION", "").strip()
CLOUD_RUN_CPU_JOB = os.environ.get("CLOUD_RUN_CPU_JOB", "").strip()
CLOUD_RUN_GPU_JOB = os.environ.get("CLOUD_RUN_GPU_JOB", "").strip()
PRELOAD_MODELS = os.environ.get("PRELOAD_MODELS", "").strip().lower()
STRICT_JOB_PERSISTENCE = os.environ.get("STRICT_JOB_PERSISTENCE", "").strip().lower()
WORKER_TIMEOUT_SECONDS = _env_int("WORKER_TIMEOUT_SECONDS", 3600, minimum=0)
STALE_JOB_GRACE_SECONDS = _env_int("STALE_JOB_GRACE_SECONDS", 90, minimum=0)

_gcs_client = None
_firestore_client = None


def _should_preload_models() -> bool:
    if PRELOAD_MODELS in {"1", "true", "yes", "on"}:
        return True
    if PRELOAD_MODELS in {"0", "false", "no", "off"}:
        return False
    # Default to no preload in Cloud Run dispatch mode; keep preload for inline mode.
    return EXECUTION_BACKEND != "cloud_run_job"


@app.on_event("startup")
def _preload_models() -> None:
    """Load ONNX sessions at startup so inference memory is stable before requests arrive."""
    if not _should_preload_models():
        logger.info("[startup] Skipping model pre-load (PRELOAD_MODELS disabled)")
        return
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


def _get_job(job_id: str) -> dict:
    # In cloud_run_job mode, worker updates happen out-of-process and are written
    # to Firestore. Read Firestore first so polling does not get stuck on stale
    # in-memory "pending" records in the API instance.
    fs_job = _firestore_get_job(job_id)
    if fs_job is not None:
        return fs_job

    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is not None:
        return job

    raise HTTPException(404, f"Job {job_id!r} not found")


def _coerce_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        parsed = float(value)
        if math.isfinite(parsed):
            return parsed
    except Exception:
        return None
    return None


def _job_started_at(job: dict) -> float | None:
    timings = job.get("timings")
    if isinstance(timings, dict):
        for key in ("worker_started_at", "analysis_started_at"):
            parsed = _coerce_float(timings.get(key))
            if parsed is not None and parsed > 0:
                return parsed
    for key in ("started_at", "created_at"):
        parsed = _coerce_float(job.get(key))
        if parsed is not None and parsed > 0:
            return parsed
    return None


def _job_timeout_seconds(job: dict) -> int:
    stored = job.get("worker_timeout_seconds")
    parsed = _coerce_float(stored)
    if parsed is None or parsed <= 0:
        return WORKER_TIMEOUT_SECONDS
    return max(0, int(parsed))


def _maybe_mark_job_failed_if_stale(job_id: str, job: dict) -> dict:
    status = job.get("status")
    if status not in (JobStatus.PENDING, JobStatus.PROCESSING):
        return job
    if str(job.get("dispatch_backend") or "").strip() != "cloud_run_job":
        return job

    started_at = _job_started_at(job)
    timeout_seconds = _job_timeout_seconds(job)
    if started_at is None or timeout_seconds <= 0:
        return job

    now = time.time()
    deadline = started_at + timeout_seconds + STALE_JOB_GRACE_SECONDS
    if now <= deadline:
        return job

    timings = dict(job.get("timings") or {})
    timings["worker_total_seconds"] = _round_seconds(now - started_at)
    timings["stale_marked_at"] = now
    minutes = max(1, int(round(timeout_seconds / 60.0)))
    error = (
        str(job.get("error") or "").strip()
        or f"Analysis exceeded the Cloud Run worker timeout ({minutes} min) before it could finish."
    )
    updates = {
        "status": JobStatus.FAILED,
        "stage": "failed",
        "error": error,
        "completed_at": now,
        "timings": timings,
    }
    logger.warning(
        "[job-timeout] marking stale job %s as failed after %.1fs (timeout=%ss)",
        job_id,
        now - started_at,
        timeout_seconds,
    )
    _update_job(job_id, **updates)
    failed_job = dict(job)
    failed_job.update(updates)
    return failed_job


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


def _generate_signed_read_url(blob: Any) -> str:
    expiration = timedelta(seconds=READ_URL_TTL_SECONDS)
    direct_exc: Exception | None = None

    try:
        return blob.generate_signed_url(
            version="v4",
            expiration=expiration,
            method="GET",
        )
    except Exception as exc:
        direct_exc = exc
        logger.warning(f"Direct V4 read signing failed; trying IAM signBlob fallback: {exc}")

    try:
        import google.auth
        from google.auth.transport.requests import Request as GoogleAuthRequest
    except Exception as exc:
        raise RuntimeError(
            f"google-auth libraries unavailable for V4 read signing fallback: {exc}"
        ) from exc

    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    creds, _project = google.auth.default(scopes=scopes)
    creds.refresh(GoogleAuthRequest())
    if not creds.token:
        raise RuntimeError("Failed to obtain access token for signed read URL generation")

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
            method="GET",
            service_account_email=signer_email,
            access_token=creds.token,
        )
    except Exception as fallback_exc:
        raise RuntimeError(
            f"Failed to generate read URL. direct_sign={direct_exc}; iam_sign_blob={fallback_exc}"
        ) from fallback_exc


def _is_firestore_enabled() -> bool:
    return JOB_STORE_BACKEND == "firestore"


def _should_raise_job_store_errors() -> bool:
    if STRICT_JOB_PERSISTENCE in {"1", "true", "yes", "on"}:
        return True
    if STRICT_JOB_PERSISTENCE in {"0", "false", "no", "off"}:
        return False
    return EXECUTION_BACKEND == "cloud_run_job" and _is_firestore_enabled()


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
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    # Convert numpy scalar/array values to plain Python so Firestore can store
    # inference outputs (np.float32, np.int64, ndarray, etc.).
    try:
        import numpy as np
        if isinstance(value, np.ndarray):
            return _jsonable(value.tolist())
        if isinstance(value, np.generic):
            return _jsonable(value.item())
    except Exception:
        pass
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _encode_result_for_firestore(result: dict) -> dict:
    """
    Firestore does not support arrays that directly contain arrays.
    Convert keypoints [[x,y,conf], ...] -> [{x,y,conf}, ...] for storage.
    """
    out = dict(result)
    frames = out.get("framesData")
    if not isinstance(frames, list):
        return out

    encoded_frames: list[Any] = []
    for frame in frames:
        if not isinstance(frame, dict):
            encoded_frames.append(frame)
            continue
        frame_out = dict(frame)
        keypoints = frame_out.get("keypoints")
        if isinstance(keypoints, list):
            encoded_kps: list[Any] = []
            for kp in keypoints:
                if isinstance(kp, (list, tuple)) and len(kp) >= 3:
                    encoded_kps.append({
                        "x": _jsonable(kp[0]),
                        "y": _jsonable(kp[1]),
                        "conf": _jsonable(kp[2]),
                    })
                else:
                    encoded_kps.append(_jsonable(kp))
            frame_out["keypoints"] = encoded_kps
        encoded_frames.append(frame_out)
    out["framesData"] = encoded_frames
    return out


def _decode_result_from_firestore(result: dict) -> dict:
    """
    Convert Firestore-safe keypoint maps back to API shape:
    [{x,y,conf}, ...] -> [[x,y,conf], ...]
    """
    out = dict(result)
    frames = out.get("framesData")
    if not isinstance(frames, list):
        return out

    decoded_frames: list[Any] = []
    for frame in frames:
        if not isinstance(frame, dict):
            decoded_frames.append(frame)
            continue
        frame_out = dict(frame)
        keypoints = frame_out.get("keypoints")
        if isinstance(keypoints, list):
            decoded_kps: list[Any] = []
            for kp in keypoints:
                if isinstance(kp, dict) and {"x", "y", "conf"}.issubset(kp.keys()):
                    decoded_kps.append([kp.get("x"), kp.get("y"), kp.get("conf")])
                else:
                    decoded_kps.append(kp)
            frame_out["keypoints"] = decoded_kps
        decoded_frames.append(frame_out)
    out["framesData"] = decoded_frames
    return out


def _firestore_upsert_job(job_id: str, payload: dict) -> None:
    if not _is_firestore_enabled():
        return
    try:
        client = _get_firestore_client()
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(job_id)
        payload_out = _jsonable(payload)
        if isinstance(payload_out, dict):
            result = payload_out.get("result")
            if isinstance(result, dict):
                payload_out["result"] = _encode_result_for_firestore(result)
        doc_ref.set(payload_out, merge=True)
    except Exception as exc:
        logger.warning(f"[firestore] upsert [{job_id}] failed: {exc}")
        if _should_raise_job_store_errors():
            raise


def _firestore_get_job(job_id: str) -> dict | None:
    if not _is_firestore_enabled():
        return None
    try:
        client = _get_firestore_client()
        snap = client.collection(FIRESTORE_COLLECTION).document(job_id).get()
        if not snap.exists:
            return None
        payload = snap.to_dict() or {}
        result = payload.get("result")
        if isinstance(result, dict):
            payload["result"] = _decode_result_from_firestore(result)
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


def _build_saved_object_name(filename: str, ride_id: str | None = None) -> str:
    safe_name = _sanitize_filename(filename)
    safe_ride_id = _sanitize_filename(ride_id or "ride")
    return f"{GCS_SAVED_PREFIX}/{safe_ride_id}/{uuid.uuid4()}_{safe_name}"


def _build_result_object_name(job_id: str) -> str:
    safe_job_id = _sanitize_filename(job_id)
    return f"{GCS_RESULTS_PREFIX}/{safe_job_id}.json.gz"


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


def _copy_gcs_object(source_object_path: str, dest_object_name: str) -> str:
    bucket_name, source_object_name = _parse_gs_uri(source_object_path)
    client = _get_gcs_client()
    bucket = client.bucket(bucket_name)
    source_blob = bucket.blob(source_object_name)
    if not source_blob.exists():
        raise FileNotFoundError(f"GCS object not found: {source_object_path}")

    bucket.copy_blob(source_blob, bucket, new_name=dest_object_name)
    return f"gs://{bucket_name}/{dest_object_name}"


def _result_storage_enabled() -> bool:
    return _is_firestore_enabled() and bool(GCS_UPLOAD_BUCKET)


def _store_result_in_gcs(job_id: str, result_dict: dict) -> tuple[str, int, int]:
    if not GCS_UPLOAD_BUCKET:
        raise RuntimeError("GCS_UPLOAD_BUCKET is required to store result payloads externally")

    object_name = _build_result_object_name(job_id)
    object_path = f"gs://{GCS_UPLOAD_BUCKET}/{object_name}"
    client = _get_gcs_client()
    bucket = client.bucket(GCS_UPLOAD_BUCKET)
    blob = bucket.blob(object_name)

    payload_bytes = json.dumps(
        _jsonable(result_dict),
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    compressed = gzip.compress(payload_bytes)
    blob.content_type = "application/json"
    blob.content_encoding = "gzip"
    blob.cache_control = "no-store"
    blob.upload_from_string(compressed, content_type="application/json")
    logger.info(
        "[result-store] job=%s path=%s raw_bytes=%d gzip_bytes=%d compression_ratio=%.3f",
        job_id,
        object_path,
        len(payload_bytes),
        len(compressed),
        (len(compressed) / len(payload_bytes)) if payload_bytes else 0.0,
    )
    return object_path, len(payload_bytes), len(compressed)


def _load_result_from_gcs(object_path: str) -> dict:
    bucket_name, object_name = _parse_gs_uri(object_path)
    client = _get_gcs_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    if not blob.exists():
        raise FileNotFoundError(f"GCS object not found: {object_path}")

    raw = blob.download_as_bytes()
    if object_name.endswith(".gz") and raw.startswith(b"\x1f\x8b"):
        raw = gzip.decompress(raw)
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected result payload type for {object_path}: {type(payload)!r}")
    return payload


def _inline_result_for_job_store(result_dict: dict) -> dict:
    inline = dict(result_dict)
    frames = inline.pop("framesData", None)
    if isinstance(frames, list):
        inline["framesDataCount"] = len(frames)
        inline["framesDetectedCount"] = sum(
            1 for frame in frames
            if isinstance(frame, dict) and bool(frame.get("detected"))
        )
    return inline


def _merge_result_payloads(summary: Any, full: Any) -> Any:
    if isinstance(summary, dict) and isinstance(full, dict):
        merged = dict(summary)
        merged.update(full)
        return merged
    return full if full is not None else summary


def _hydrate_job_result(job: dict) -> dict:
    result_object_path = str(job.get("result_object_path") or "").strip()
    result = job.get("result")
    status = job.get("status")
    if status != JobStatus.COMPLETE or not result_object_path:
        return job

    needs_full_payload = not isinstance(result, dict) or not isinstance(result.get("framesData"), list)
    if not needs_full_payload:
        return job

    try:
        full_result = _load_result_from_gcs(result_object_path)
        job["result"] = _merge_result_payloads(result, full_result)
    except Exception as exc:
        logger.warning(f"[result-load] failed to load [{job.get('job_id')}] from {result_object_path}: {exc}")
        job.setdefault("result_load_error", str(exc))
    return job


def _round_seconds(value: float) -> float:
    return round(float(value), 3)


# ── Background processing ────────────────────────────────────────────────────

def _process_video(
    job_id: str,
    tmp_path: str,
    filename: str,
    size_mb: float,
    timings: dict[str, Any] | None = None,
) -> None:
    started_at = time.time()
    timing_data = dict(timings or {})
    timing_data.setdefault("worker_started_at", started_at)
    timing_data.setdefault("analysis_started_at", started_at)
    _update_job(
        job_id,
        status=JobStatus.PROCESSING,
        stage="analyzing",
        started_at=timing_data["worker_started_at"],
        analysis_progress={
            "phase": "starting",
            "sampled_count": 0,
            "estimated_samples": 0,
            "valid_poses": 0,
            "horse_frames": 0,
            "cropped_frames": 0,
            "detection_rate": 0.0,
            "processed_seconds": 0.0,
            "duration_seconds_estimate": 0.0,
            "progress_pct": 0.0,
        },
        timings=timing_data,
    )

    try:
        analysis_start = time.time()
        def _handle_pipeline_progress(update: dict[str, Any]) -> None:
            _update_job(
                job_id,
                stage="analyzing",
                analysis_progress=_jsonable(update),
                timings=timing_data,
            )

        result = _pipeline.analyze_video(tmp_path, progress_callback=_handle_pipeline_progress)
        analysis_done = time.time()
        timing_data["analysis_seconds"] = _round_seconds(analysis_done - analysis_start)

        result_dict = result.to_dict()
        frames_data = result_dict.get("framesData") if isinstance(result_dict, dict) else None
        if isinstance(frames_data, list):
            timing_data["result_frames"] = len(frames_data)

        _update_job(job_id, stage="persisting", timings=timing_data)

        persistence_start = time.time()
        result_object_path = None
        result_storage = "inline"
        result_for_store = result_dict
        if _result_storage_enabled():
            (
                result_object_path,
                timing_data["result_payload_bytes"],
                timing_data["result_payload_gzip_bytes"],
            ) = _store_result_in_gcs(job_id, result_dict)
            result_for_store = _inline_result_for_job_store(result_dict)
            result_storage = "gcs"
        persistence_done = time.time()
        timing_data["persist_seconds"] = _round_seconds(persistence_done - persistence_start)

        completed = time.time()
        timing_data["worker_total_seconds"] = _round_seconds(completed - timing_data["worker_started_at"])
        _update_job(
            job_id,
            status=JobStatus.COMPLETE,
            stage="complete",
            result=result_for_store,
            result_object_path=result_object_path,
            result_storage=result_storage,
            completed_at=completed,
            timings=timing_data,
        )
        logger.info(
            "Job %s complete — overall %.2f analysis=%.3fs persist=%.3fs total=%.3fs storage=%s",
            job_id,
            result.overallScore,
            timing_data.get("analysis_seconds", 0.0),
            timing_data.get("persist_seconds", 0.0),
            timing_data.get("worker_total_seconds", 0.0),
            result_storage,
        )
    except Exception as exc:
        logger.exception(f"Job {job_id} failed")
        timing_data["worker_total_seconds"] = _round_seconds(time.time() - timing_data["worker_started_at"])
        _update_job(
            job_id,
            status=JobStatus.FAILED,
            stage="failed",
            error=str(exc),
            timings=timing_data,
        )
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
    worker_started_at = time.time()
    timing_data: dict[str, Any] = {
        "worker_started_at": worker_started_at,
    }
    _update_job(
        job_id,
        status=JobStatus.PROCESSING,
        stage="downloading",
        started_at=worker_started_at,
        timings=timing_data,
    )
    try:
        download_started = time.time()
        _download_from_gcs(object_path, tmp_path)
        download_done = time.time()
        timing_data["download_seconds"] = _round_seconds(download_done - download_started)
        timing_data["analysis_started_at"] = download_done
    except Exception as exc:
        logger.exception(f"Job {job_id} failed to download object {object_path!r}")
        timing_data["worker_total_seconds"] = _round_seconds(time.time() - worker_started_at)
        _update_job(
            job_id,
            status=JobStatus.FAILED,
            stage="failed",
            error=f"Failed to download object: {exc}",
            timings=timing_data,
        )
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return

    _process_video(job_id, tmp_path, filename, size_mb, timings=timing_data)


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
            "stage": "queued",
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
        "model":       "yolov8m-pose",
        "horse_det":   "yolov8m",
        "smart_crop":  True,
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


class PinVideoRequest(BaseModel):
    object_path: str
    filename: str
    ride_id: Optional[str] = None


class ReadUrlRequest(BaseModel):
    object_path: str


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


@app.post("/videos/pin")
def pin_video_object(req: PinVideoRequest) -> JSONResponse:
    if not GCS_UPLOAD_BUCKET:
        raise HTTPException(500, "GCS_UPLOAD_BUCKET is not configured")

    try:
        bucket_name, _source_object_name = _parse_gs_uri(req.object_path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    if bucket_name != GCS_UPLOAD_BUCKET:
        raise HTTPException(400, "object_path bucket does not match GCS_UPLOAD_BUCKET")

    dest_object_name = _build_saved_object_name(req.filename, req.ride_id)
    try:
        pinned_object_path = _copy_gcs_object(req.object_path, dest_object_name)
    except Exception as exc:
        logger.exception("Failed to pin uploaded object")
        raise HTTPException(500, f"Failed to pin object: {exc}") from exc

    return JSONResponse({
        "object_path": pinned_object_path,
        "source_object_path": req.object_path,
    })


@app.post("/videos/read-url")
def create_video_read_url(req: ReadUrlRequest) -> JSONResponse:
    try:
        bucket_name, object_name = _parse_gs_uri(req.object_path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    if GCS_UPLOAD_BUCKET and bucket_name != GCS_UPLOAD_BUCKET:
        raise HTTPException(400, "object_path bucket does not match GCS_UPLOAD_BUCKET")

    try:
        client = _get_gcs_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(object_name)
        if not blob.exists():
            raise FileNotFoundError(f"GCS object not found: {req.object_path}")
        read_url = _generate_signed_read_url(blob)
    except Exception as exc:
        logger.exception("Failed to generate signed read URL")
        raise HTTPException(500, f"Failed to create signed read URL: {exc}") from exc

    return JSONResponse({
        "read_url": read_url,
        "object_path": req.object_path,
        "expires_in_seconds": READ_URL_TTL_SECONDS,
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
        "stage": "queued",
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
                    # Keep worker job-state persistence explicit for run() overrides.
                    "JOB_STORE_BACKEND": JOB_STORE_BACKEND,
                    "FIRESTORE_COLLECTION": FIRESTORE_COLLECTION,
                },
            )
            _update_job(
                job_id,
                dispatch_backend="cloud_run_job",
                worker_job_name=job_name,
                worker_operation=op_name,
                worker_timeout_seconds=WORKER_TIMEOUT_SECONDS,
            )
            logger.info(f"Queued Cloud Run job {job_id} via {job_name} ({op_name})")
        except Exception as exc:
            logger.exception(f"Failed to dispatch Cloud Run job for {job_id}")
            _update_job(job_id, status=JobStatus.FAILED, error=f"Failed to dispatch worker: {exc}")
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
        "stage":       "queued",
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
    job = _hydrate_job_result(_get_job(job_id))
    job = _maybe_mark_job_failed_if_stale(job_id, job)
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
