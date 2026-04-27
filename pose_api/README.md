# Horsera Pose API

FastAPI service for equestrian ride video analysis. It creates signed Google Cloud Storage upload/read URLs, manages async analysis jobs, runs the ONNX Runtime pose pipeline, and returns normalized keyframes plus ride-level scores.

For the frontend/backend request flow, see [../docs/current-app-architecture.md](../docs/current-app-architecture.md).

## What It Owns

- Signed upload URLs for browser-to-GCS video uploads.
- Pinning uploaded videos into the durable saved-rides prefix.
- Signed playback URLs for saved ride videos.
- Async pose-analysis jobs from GCS object paths.
- Optional legacy multipart video upload endpoint.
- Job polling and result hydration.
- Single-frame analysis/debug endpoint.

The service can run jobs inline in the API process or dispatch Cloud Run Job workers.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Lightweight service metadata |
| `GET` | `/health` | Health check, active job count, configured backends |
| `POST` | `/uploads/video-url` | Create signed URL for direct video upload to GCS |
| `POST` | `/videos/pin` | Copy an uploaded object into the durable saved-rides prefix |
| `POST` | `/videos/read-url` | Mint a signed playback URL for a saved GCS object |
| `POST` | `/analyze/video/object` | Start analysis from an uploaded GCS object path |
| `POST` | `/analyze/video` | Legacy multipart upload path |
| `GET` | `/jobs/{job_id}` | Poll job status, preview output, and final result |
| `POST` | `/analyze/frame` | Analyze one base64 frame synchronously |

`GET /jobs/{job_id}` exposes two result surfaces:

- `preview`: provisional first-segment analysis, usually produced before the full ride completes
- `result`: canonical full-ride analysis, unchanged from the previous final-result flow

The preview uses the same score, insight, and `framesData` shape as the final result so the frontend can render the same report components while clearly labeling it provisional.

## Local Run

```bash
cd pose_api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for Swagger UI.

For a local frontend session, `src/lib/poseApi.ts` defaults to `http://localhost:8000` when the browser hostname is `localhost`.

## Local Worker Run

```bash
cd pose_api
POSE_JOB_ID=test-job \
POSE_OBJECT_PATH=gs://your-bucket/uploads/test.mp4 \
POSE_FILENAME=test.mp4 \
POSE_SIZE_MB=42 \
JOB_STORE_BACKEND=firestore \
python worker.py
```

Worker mode expects persisted job state, normally Firestore.

## Docker

```bash
docker build -f pose_api/Dockerfile -t horsera-pose-api .
docker run -p 8000:8000 horsera-pose-api
```

For Cloud Run, build linux/amd64 images and choose the CPU or GPU requirements file through the Docker build arg documented in [infra/README.md](infra/README.md).

## Production Deployment

Current production architecture is GCP-oriented:

- Cloud Run API service.
- Cloud Run CPU/GPU worker jobs.
- GCS bucket for uploads, saved rides, and optional job result payloads.
- Firestore job store for out-of-process worker updates.
- Optional Vercel `/api/pose` proxy so browsers can call a same-origin endpoint while Cloud Run stays authenticated.

Deployment details:

- GCP infra: [infra/README.md](infra/README.md)
- Vercel proxy: [../docs/vercel-pose-proxy.md](../docs/vercel-pose-proxy.md)

Railway and Render files remain in the repo as older deployment surfaces, but they are not the current recommended production path.

## Job Lifecycle

1. Browser asks `POST /uploads/video-url` for a signed GCS upload URL.
2. Browser uploads video bytes directly to GCS.
3. Browser calls `POST /analyze/video/object` with the GCS object path.
4. API creates a job record.
5. API runs analysis inline or dispatches a Cloud Run Job worker.
6. Worker runs an optional preview pass, then updates progress and final results in the job store.
7. Browser polls `GET /jobs/{job_id}` until status is `complete` or `failed`.

When result payloads are too large for inline job storage, the API can store full results in GCS and hydrate them back into polling responses.

Preview payloads stay on the job record under `preview.result`. They are provisional and should not be saved as canonical ride metrics.

## Result Shape

Completed jobs include a `result` payload similar to:

```json
{
  "biometrics": {
    "lowerLegStability": 0.74,
    "reinSteadiness": 0.68,
    "reinSymmetry": 0.71,
    "coreStability": 0.80,
    "upperBodyAlignment": 0.76,
    "pelvisStability": 0.79
  },
  "ridingQuality": {
    "rhythm": 0.76,
    "relaxation": 0.80,
    "contact": 0.69,
    "impulsion": 0.77,
    "straightness": 0.73,
    "balance": 0.78
  },
  "overallScore": 0.75,
  "detectionRate": 0.58,
  "caeIndex": 0.79,
  "apsScore": 0.64,
  "framesAnalyzed": 1356,
  "framesSampled": 1356,
  "framesTotal": 67810,
  "sampleFps": 3,
  "sampleIntervalSec": 0.3333333333,
  "insights": [
    "Core stability is your strongest area this session (80%) - build on it."
  ],
  "framesData": [
    {
      "frame_time": 12.34,
      "detected": true,
      "sample_index": 37,
      "source_frame_index": 740,
      "keypoints": [[0.51, 0.24, 0.91]]
    }
  ]
}
```

Scores are in `[0, 1]`. `framesData` keypoints are normalized to `[0, 1]` coordinates for frontend playback overlays.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | Port to bind in container/runtime |
| `CORS_ORIGINS` | `https://horsera.app,http://localhost:5173,http://localhost:8080` | Comma-separated allowed origins |
| `GCS_UPLOAD_BUCKET` | empty | Bucket for uploads, saved rides, and optional result payloads |
| `GCS_UPLOAD_PREFIX` | `uploads` | Prefix for transient uploaded videos |
| `GCS_SAVED_PREFIX` | `saved-rides` | Prefix for pinned saved ride videos |
| `GCS_RESULTS_PREFIX` | `job-results` | Prefix for externally stored full analysis payloads |
| `GCS_SIGNING_SERVICE_ACCOUNT_EMAIL` | empty | Optional V4 signed URL signer identity override |
| `SIGNED_URL_TTL_SECONDS` | `900` | Signed upload URL TTL |
| `READ_URL_TTL_SECONDS` | `900` | Signed playback URL TTL |
| `JOB_STORE_BACKEND` | `memory` | `memory` or `firestore` |
| `FIRESTORE_COLLECTION` | `pose_jobs` | Firestore collection for job state |
| `EXECUTION_BACKEND` | `inline` | `inline` or `cloud_run_job` |
| `STRICT_JOB_PERSISTENCE` | auto | Raise on failed Firestore writes in strict worker configurations |
| `PRELOAD_MODELS` | auto | Force eager ONNX preload on/off; defaults off in Cloud Run job mode |
| `GPU_THRESHOLD_MB` | `120` | Route to GPU worker when uploaded video size reaches this threshold |
| `CLOUD_RUN_PROJECT` | empty | GCP project for Cloud Run Job dispatch |
| `CLOUD_RUN_REGION` | empty | Cloud Run region for Job dispatch |
| `CLOUD_RUN_CPU_JOB` | empty | Cloud Run CPU Job name |
| `CLOUD_RUN_GPU_JOB` | empty | Cloud Run GPU Job name |
| `WORKER_TIMEOUT_SECONDS` | `3600` | Expected worker timeout for stale-job detection |
| `STALE_JOB_GRACE_SECONDS` | `90` | Extra buffer before marking a Cloud Run job stale |
| `PREVIEW_DURATION_SECONDS` | `60` | First-segment window used for provisional preview analysis before the full ride pass |
| `PREVIEW_SAMPLE_FPS` | `2` | Preview sampling rate; lower than full analysis to make the first report arrive sooner |
| `SAMPLE_FPS` | `3` | Default video sampling rate |
| `SAMPLE_EVERY_FRAME` | `false` | Analyze every decoded input frame instead of sampling |
| `ADAPTIVE_SAMPLE_MAX_FPS` | `8` | Burst sampling ceiling for motion/tracking changes |
| `ADAPTIVE_SAMPLE_MOTION_THRESHOLD` | `18` | Motion threshold for burst sampling |
| `ADAPTIVE_SAMPLE_MOTION_WINDOW_SEC` | `0.75` | Burst duration after motion spike |
| `ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC` | `1.5` | Burst duration after missed rider detection |
| `MISSING_HORSE_GRACE_FRAMES` | `2` | Frames to tolerate a missing horse bbox before losing crop context |
| `INFER_BATCH_SIZE` | `1` | Max sampled frames per ONNX inference call |
| `ORT_CUDNN_CONV_ALGO_SEARCH` | `HEURISTIC` | CUDA provider convolution search mode |
| `HORSERA_PHASE2` | `0` | Feature flag for hybrid pipeline work in `pipeline.py` |
