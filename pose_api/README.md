# Horsera Pose API

YOLOv8s-pose biomechanics analysis for equestrian riders.
Receives a riding video → returns 6 biomechanics scores + Training Scale quality metrics.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check, active job count |
| `POST` | `/uploads/video-url` | Create signed URL for direct video upload to GCS |
| `POST` | `/videos/pin` | Copy an uploaded object into the durable saved-rides prefix |
| `POST` | `/videos/read-url` | Mint a signed playback URL for a saved GCS object |
| `POST` | `/analyze/video/object` | Start analysis from uploaded GCS object path |
| `POST` | `/analyze/video` | Upload video → returns `job_id` (async) |
| `GET` | `/jobs/{job_id}` | Poll job status + results |
| `POST` | `/analyze/frame` | Single base64 frame → instant keypoints |

## Run locally

```bash
cd pose_api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for the interactive Swagger UI.

## Run Cloud Worker Locally

```bash
cd pose_api
POSE_JOB_ID=test-job \
POSE_OBJECT_PATH=gs://your-bucket/uploads/test.mp4 \
POSE_FILENAME=test.mp4 \
POSE_SIZE_MB=42 \
python worker.py
```

## Run with Docker

```bash
docker build -f pose_api/Dockerfile -t horsera-pose-api .
docker run -p 8000:8000 horsera-pose-api
```

The Dockerfile bakes `yolov8n.pt` and `yolov8s-pose.pt` into the image at build time —
no cold download on first request.

## Deploy to Railway

1. Connect the `rossella-horsera/horsera_app` repo in Railway
2. Railway auto-detects `railway.toml` and uses `pose_api/Dockerfile`
3. Set `CORS_ORIGINS=https://horsera.app` in Railway environment variables
4. The `/health` endpoint is the health check — Railway waits up to 300s for it

## Deploy to Render

1. Connect repo in Render → "New Web Service"
2. Render reads `render.yaml` automatically
3. Select **Standard plan** (1 GB RAM minimum for YOLO)
4. First deploy takes ~5 min (model download baked in at build time)

## Response shape

```json
{
  "biometrics": {
    "lowerLegStability":  0.74,
    "reinSteadiness":     0.68,
    "reinSymmetry":       0.71,
    "coreStability":      0.80,
    "upperBodyAlignment": 0.76,
    "pelvisStability":    0.79
  },
  "ridingQuality": {
    "rhythm":       0.76,
    "relaxation":   0.80,
    "contact":      0.69,
    "impulsion":    0.77,
    "straightness": 0.73,
    "balance":      0.78
  },
  "overallScore":   0.75,
  "detectionRate":  0.58,
  "caeIndex":       0.79,
  "apsScore":       0.64,
  "framesAnalyzed": 1356,
  "framesTotal":    67810,
  "insights": [
    "Core stability is your strongest area this session (80%) — build on it.",
    "Rein steadiness needs the most attention (68%) — focus here next ride."
  ]
}
```

All scores are in **[0, 1]** — 1.0 = best. This matches the `StoredRide` interface
in the Horsera frontend (`src/lib/storage.ts`).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Port to bind |
| `CORS_ORIGINS` | `https://horsera.app,...` | Comma-separated allowed origins |
| `GCS_UPLOAD_BUCKET` | _(empty)_ | Bucket for signed uploads + server-side reads |
| `GCS_UPLOAD_PREFIX` | `uploads` | Prefix inside the upload bucket |
| `GCS_SAVED_PREFIX` | `saved-rides` | Prefix for pinned ride videos that should remain available for playback |
| `GCS_SIGNING_SERVICE_ACCOUNT_EMAIL` | _(empty)_ | Optional override for V4 signed URL signer identity (recommended on Cloud Run) |
| `SIGNED_URL_TTL_SECONDS` | `900` | Signed upload URL TTL in seconds |
| `READ_URL_TTL_SECONDS` | `900` | Signed playback URL TTL in seconds |
| `JOB_STORE_BACKEND` | `memory` | `memory` or `firestore` |
| `FIRESTORE_COLLECTION` | `pose_jobs` | Firestore collection for job state |
| `EXECUTION_BACKEND` | `inline` | `inline` (background thread) or `cloud_run_job` |
| `PRELOAD_MODELS` | auto | `1/true` to force eager ONNX preload, `0/false` to skip (auto skips in `cloud_run_job` mode) |
| `GPU_THRESHOLD_MB` | `120` | Route to GPU worker job when size threshold is met |
| `CLOUD_RUN_PROJECT` | _(empty)_ | GCP project for Cloud Run Job dispatch |
| `CLOUD_RUN_REGION` | _(empty)_ | Cloud Run region for Job dispatch |
| `CLOUD_RUN_CPU_JOB` | _(empty)_ | Cloud Run Job name for CPU worker |
| `CLOUD_RUN_GPU_JOB` | _(empty)_ | Cloud Run Job name for GPU worker |
| `SAMPLE_FPS` | `1` | Frame sampling rate for video analysis |
| `INFER_BATCH_SIZE` | `1` | Max sampled frames per ONNX inference call (effective when model supports batch > 1) |
| `ORT_CUDNN_CONV_ALGO_SEARCH` | `HEURISTIC` | CUDA provider convolution search mode (`HEURISTIC` or `EXHAUSTIVE`) |
| `HORSERA_PHASE2` | `0` | Set to `1` to enable MediaPipe hybrid merging (see `pipeline.py`) |
