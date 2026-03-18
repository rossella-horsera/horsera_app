# Horsera Pose API — Engineering Handoff

**Date:** 2026-03-18
**Service:** Railway-hosted FastAPI — `https://horseraapp-production.up.railway.app`
**Frontend:** `https://app.horsera.ai/` (production) · `http://localhost:8080` (local dev)
**Repo path:** `pose_api/`

The API is deployed and the video upload pipeline is wired end-to-end. There is one unresolved issue causing analysis to fail in production: the server crashes mid-processing on the first video request, returning Railway 502s with no CORS headers for all subsequent poll calls.

---

## How the pipeline works

1. Frontend (`src/hooks/usePoseAPI.ts`) POSTs a video to `POST /analyze/video` → receives a `job_id` immediately
2. Analysis runs in a background thread: YOLOv8n (horse detection) + YOLOv8s-pose (rider keypoints) via ONNX Runtime
3. Frontend polls `GET /jobs/{job_id}` every 3 seconds until status is `complete` or `failed`
4. On `complete`, normalised keypoints (0–1 coordinates) are returned in `framesData` and rendered as a skeleton overlay on the video player

---

## Issues resolved — do not re-investigate

### 1. Persistent 502 on public URL despite healthy container

**Root cause:** Railway "magic" auto-detects `EXPOSE 8000` in the Dockerfile and sets the public Networking domain to port 8000. But Railway injects `PORT=8080` into the container, so uvicorn was running on 8080 while public traffic was routed to 8000.

**Fix:**
- Manually changed the Railway Networking domain port from 8000 → **8080** in Railway Settings UI (Settings → Networking). **Do not change this back.**
- `startCommand` in `railway.toml` uses `sh -c 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --loop asyncio'`. The `sh -c` wrapper is required — Railway execs the command directly (exec form), so `${PORT}` is not shell-expanded without it.
- `PORT` is **not** set in `railway.toml` variables — Railway controls it. Current injected value is 8080.

**Status:** Resolved. `/health` returns 200.

---

### 2. Skeleton overlay rendering in wrong position / not appearing

Three separate root causes, all fixed:

**Root cause (a):** `allFrames` was hardcoded to `[]` in `usePoseAPI.ts` — real keypoints from the API were never passed to the renderer.

**Root cause (b):** `PipelineResult.to_dict()` in `pipeline.py` did not include `frames_data` in its output, so the field was absent from the API response.

**Root cause (c):** Keypoints were returned in pixel coordinates. The frontend `SkeletonOverlay` component uses SVG `viewBox="0 0 1 1"` and expects coordinates normalised to 0–1.

**Fix:**
- `pipeline.py`: After analysis, keypoints are normalised by dividing x by frame width and y by frame height, clamped to [0, 1]. Each frame entry also includes `frame_time` (actual video timestamp in seconds derived from `frame_index / native_fps`).
- `pipeline.py`: `to_dict()` now includes `"framesData": self.frames_data`.
- `usePoseAPI.ts`: Maps `r.framesData` to `allFrames` with the correct `{ time, frame: [{ x, y, score }] }` shape.

**Status:** Fixed in code. Not yet confirmed working end-to-end because the OOM crash (issue 3 below) prevents analysis from completing in production.

---

## Active issue — server OOM crash during first video processing

### Symptom

After the video upload succeeds (`POST /analyze/video` returns `job_id`) and polling begins, the server crashes mid-processing. The frontend polls `GET /jobs/{job_id}` and receives Railway 502 responses — which have no CORS headers — so the browser logs hundreds of CORS errors. The app shows "Something went wrong." The CORS errors are a **symptom** of the dead server, not a CORS misconfiguration.

### Root cause (suspected)

`_get_sessions()` in `pipeline.py` was called lazily — only when the first video started processing. It imports `onnxruntime` and loads two ONNX model files into memory:

- `pose_api/yolov8n.onnx` (horse detector)
- `pose_api/yolov8s-pose.onnx` (rider pose model)

This memory spike likely exceeds Railway Hobby's ~512 MB RAM limit mid-processing. Railway kills the process with no Python traceback — just silence, then 502s on all subsequent requests. The in-memory `_jobs` dict is wiped when the process dies, so the `job_id` is gone too.

### Fix applied (deployed but not yet tested)

Changed `main.py` to load models **eagerly at startup** instead of lazily on first request:

```python
# main.py — top of file
import pipeline as _pipeline  # loads onnxruntime + ONNX sessions at import time

@app.on_event("startup")
def _preload_models() -> None:
    """Load ONNX sessions at startup so inference memory is stable before requests arrive."""
    try:
        _pipeline._get_sessions()
        logger.info("[startup] ONNX models loaded successfully")
    except Exception as exc:
        logger.error(f"[startup] Failed to pre-load ONNX models: {exc}")
```

The total memory used is the same — this just moves the spike to startup, where Railway is more tolerant of it (healthcheck timeout is 600s).

### Next steps to verify / alternative fixes

1. **Deploy and check Railway Metrics** — look for memory spike at startup. If startup succeeds and memory stays under limit, test a video upload and watch logs for `[analyze_video]` lines progressing through frame sampling.

2. **If startup OOM** — the combined model footprint is too large for the Hobby plan. Options:
   - Upgrade Railway plan to Pro (8 GB RAM)
   - Replace `yolov8s-pose.onnx` with `yolov8n-pose.onnx` (smaller, slightly less accurate)

3. **If processing still OOM** — the per-frame inference loop is the culprit, not model loading. `analyze_video()` already processes one frame at a time and explicitly deletes frame buffers (`del raw_frame`, `del frame`), but numpy/cv2 may still accumulate allocations. Add `tracemalloc` or `memory_profiler` to identify which step is leaking.

4. **To distinguish OOM from Python exception:** check Railway deployment logs. A Python exception sets `job.status = "failed"` with an error message. An OOM produces **no Python traceback** — the process just disappears. If you see silence in the logs followed by the service restarting, it's OOM.

---

## How to test without the frontend

```bash
# 1. Upload a short test video (< 30 seconds recommended)
curl -X POST https://horseraapp-production.up.railway.app/analyze/video \
  -F "file=@/path/to/test.mp4"
# → {"job_id": "abc-123", "status": "pending"}

# 2. Poll for results
curl https://horseraapp-production.up.railway.app/jobs/abc-123
# → {"status": "processing", ...}
# → {"status": "complete", "result": {"framesData": [...], ...}}

# 3. Health check
curl https://horseraapp-production.up.railway.app/health
# → {"status": "ok", "model": "yolov8s-pose", "horse_det": "yolov8n", "active_jobs": 0}
```

For full end-to-end testing (API + skeleton overlay + UI): use `https://app.horsera.ai/` — upload a video of a horse and rider.

---

## Key files

| File | Purpose |
|------|---------|
| `pose_api/main.py` | FastAPI app, in-memory job store, video upload endpoint, background worker |
| `pose_api/pipeline.py` | ONNX inference pipeline — horse detection, pose estimation, keypoint normalisation, biomechanics scoring |
| `pose_api/db.py` | Supabase write helpers (best-effort, non-blocking — a DB error never affects analysis results) |
| `pose_api/requirements.txt` | Python deps — `onnxruntime==1.18.0` specifically (not `onnxruntime-cpu`, not 1.18.1 — those don't exist on Railway's Linux/amd64) |
| `pose_api/railway.toml` | Railway build + deploy config |
| `pose_api/Dockerfile` | Container build — `EXPOSE 8000` is in the file but the server runs on `${PORT}` (8080). Do not change the Railway Networking domain back to 8000. |
| `src/hooks/usePoseAPI.ts` | Frontend hook — handles upload, polling, and `framesData` → `allFrames` keypoint mapping |

---

## Railway config — critical notes

| Setting | Correct value | Notes |
|---------|--------------|-------|
| Networking domain port | **8080** | Set manually in Railway UI. Auto-detected value (8000) is wrong. |
| `startCommand` | `sh -c 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --loop asyncio'` | `sh -c` wrapper required for `${PORT}` expansion |
| `PORT` env var | Do not set | Railway injects it automatically (8080) |
| `CORS_ORIGINS` | `https://horsera.app,https://app.horsera.ai,http://localhost:5173,http://localhost:8080` | All four origins required |
| `SUPABASE_KEY` | Publishable key | Not a service role key — DB writes are best-effort only |
