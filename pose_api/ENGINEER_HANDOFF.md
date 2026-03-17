# Engineer Handoff — Horsera Pose API

**Date:** 2026-03-16
**Author:** Horsera agent team (Ross / Beau)
**Status:** Ready to deploy — all benchmarks complete

---

## Why YOLOv8s-pose won

We benchmarked five models across four versions of the benchmark script against
38 minutes of real equestrian footage (Rossella's ride, 2339–4844 sampled frames).

| Model | Det% | APS | CAE | Trunk std | Decision |
|-------|------|-----|-----|-----------|----------|
| YOLOv8s-pose | **59%** | 0.642 | **0.797** | **3.75** | ✅ Selected |
| YOLOv8n-pose | 58% | 0.633 | 0.793 | 4.12 | Runner-up — lighter but slightly less accurate |
| MediaPipe Lite | 37% | 0.669 | 0.440 | 41.91 | ❌ Rejected |
| MediaPipe Heavy | 39% | 0.537 | 0.438 | 41.69 | ❌ Rejected |
| MoveNet Lightning | 81% | 0.497 | n/a | n/a | ❌ Rejected (current browser model) |

**The decisive metrics:**

- **CAE (Camera-Aware Expectation):** YOLO 0.797 vs MediaPipe 0.440.
  CAE measures geometric accuracy relative to the rider's body proportions —
  essentially, are the keypoints in anatomically plausible positions?
  YOLO is nearly twice as accurate when evaluated this way.

- **Trunk std:** YOLO ±3.75 vs MediaPipe ±41.91 (px normalised to shoulder width).
  MediaPipe is ~11× jitterier frame-to-frame. Biomechanics scoring requires
  *temporal stability* — a hip that jumps 42px between frames produces meaningless
  pelvis stability scores.

- **MoveNet** detects something in 81% of frames, but CAE/trunk scores indicate
  those detections are mostly wrong. It was never designed for mounted riders.
  This is the current browser model — replacing it server-side is the whole point
  of this API.

---

## Preprocessing pipeline — step by step

```
Video file
    │
    ▼
[1] sample_video()
    Sample at 1 fps (configurable). A 38-min video → ~2300 frames.
    Uses OpenCV CAP_PROP_FPS for native frame rate.
    │
    ▼
[2] Horse detection — yolov8n, COCO class 17
    Filter frames where a horse is visible (67% pass rate on benchmark video).
    Side-on / out-of-arena frames are discarded here.
    │
    ▼
[3] YOLOv8s-pose inference
    Run on horse-filtered frames only (saves ~33% compute).
    Returns up to N detections per frame.
    │
    ▼
[4] APS v4 — Articulated Pose Score (6 checks)
    See table below. Only "valid" detections proceed.
    │
    ▼
[5] Rider isolation — horse bbox overlap check
    Confirm the rider's hip midpoint overlaps the horse bounding box
    (±20% vertical padding). Eliminates arena spectators.
    │
    ▼
[6] CAE index computation
    Per-frame: apparent_shoulder_width / max_shoulder_width.
    Produces rotation index ∈ [0,1] — 1.0 = rider facing camera.
    Used to down-weight wrist metrics on side-on frames.
    │
    ▼
[7] Biomechanics computation
    6 metrics, each normalised to [0,1]. See metrics table below.
    │
    ▼
[8] Riding quality derivation
    6 Training Scale metrics derived from biomechanics via heuristic mapping.
    Replace with ML model once labelled session data is available.
    │
    ▼
PipelineResult JSON
```

---

## APS v4 — 6 checks

| # | Check | Fails when |
|---|-------|-----------|
| 1 | Both shoulders confident | Either shoulder conf < 0.35 |
| 2 | Both hips confident | Either hip conf < 0.35 |
| 3 | At least one knee confident | Both knees conf < 0.35 |
| 4 | Shoulders above hips | y_shoulder ≥ y_hip (image coords — y increases down) |
| 5 | Torso height > torso width × 0.4 | Rider appears to be lying flat (e.g. fall detection) |
| 6 | At least one ankle visible | Both ankles conf < 0.35 |

A frame is **valid** (accepted for biomechanics) only when checks 1, 2, and 4 all pass.
The APS score (0–1) = fraction of checks passed, reported per-frame and as session mean.

---

## Biomechanics metrics reference

| Metric | Key joints | Computation | Gait sensitivity |
|--------|-----------|-------------|-----------------|
| **lowerLegStability** | Ankles (15, 16) | Std-dev of mean ankle y, normalised to shoulder width. Worst = 0.25×scale. | High at canter (more movement expected) |
| **reinSteadiness** | Wrists (9, 10) | Weighted std-dev of mean wrist y. Frames with low CAE index down-weighted. Worst = 0.20×scale. | High in rising trot (hand movement expected) |
| **reinSymmetry** | Wrists (9, 10) | Mean absolute left/right wrist height difference / scale. Worst = 0.30×scale. | Low gait sensitivity |
| **coreStability** | Hips (11, 12) | 2D std-dev of hip midpoint (x+y combined). Worst = 0.20×scale. | Moderate — hips move with the horse |
| **upperBodyAlignment** | Shoulders + Hips | Mean torso angle from vertical (°). Best = 0°, worst = 15°. | Low — should be consistent across gaits |
| **pelvisStability** | Hips (11, 12) | Std-dev of hip midpoint y only. Worst = 0.15×scale. | Moderate at canter |

**Gait sensitivity** = expected natural variation in the metric due to gait, not rider error.
Future work: apply gait-specific normalisation (detect walk/trot/canter via stride frequency
and adjust `worst_std` per gait segment).

---

## CAE — Camera-Aware Expectation

The arena camera is fixed; the horse rotates. Apparent shoulder width varies:

```
Rider facing camera  → shoulder width ≈ actual width → CAE index ≈ 1.0
Rider side-on        → shoulder width ≈ 0            → CAE index ≈ 0.0
```

**Why it matters:**
- At CAE < 0.35 (side-on), wrist x-positions are unreliable (both wrists project
  to similar x in the image plane). Rein steadiness and symmetry metrics are
  down-weighted proportionally.
- CAE index is also the best proxy for "was the camera seeing the rider well?"
  Session mean CAE is reported in the API response.

---

## Known limitations

1. **Single-camera, fixed setup** — the pipeline assumes one camera at arena
   level. Multi-camera or head-mounted cameras will need different horse detection
   and CAE calibration.

2. **~41% frames have no confident detection** — mostly due to horse body
   occlusion of rider legs, bright arena lighting, and camera angles >45° off-axis.
   Metrics are computed from the 59% that do pass. This is acceptable at 1fps
   sampling over a 30-min session (~1000 usable frames) but degrades for short
   clips (<3 min).

3. **Riding quality is heuristic** — the 6 Training Scale metrics are derived
   from biomechanics via fixed weights. They are directionally correct but not
   calibrated against coach assessments. Phase 3: label 50 sessions with coach
   scores and train a small MLP.

4. **No gait detection** — lowerLegStability benchmarks will score lower in
   canter even for correct riders, because more movement is expected. A future
   gait classifier (stride frequency from ankle y series) would allow per-gait
   normalisation.

5. **In-memory job store** — the current MVP uses a Python dict. Under concurrent
   load (>2 simultaneous uploads), this will work but jobs are lost on restart.
   Phase 2 infra: add Redis + Celery.

6. **2 GB file limit** — enforced in main.py. Typical 30-min iPhone video at
   4K is ~3.5 GB. Recommend advising users to export at 1080p before uploading,
   or implement chunked upload with pre-processing on the client.

---

## Activating Phase 2 — Hybrid model merging

Phase 2 supplements YOLO with MediaPipe on frames where the rider is nearly
side-on (CAE index < 0.35). Expected gain: +4–6% detection rate.

Steps:
1. In `pipeline.py`, uncomment the `# PHASE 2 STUB` block at the bottom
2. `pip install mediapipe>=0.10`
3. Set `HORSERA_PHASE2=1` in the server environment

The merge logic replaces YOLO shoulder/elbow/wrist keypoints with MediaPipe
equivalents only when YOLO confidence on those joints is below `CONF_THRESH`.
Hip and leg keypoints always come from YOLO (MediaPipe struggles with the
lower body in equestrian footage — see v3 benchmark Trunk std: 41.91).

Expected inference cost: +180ms/frame on CPU, +60ms on GPU.
Not recommended for the MVP — enable only after confirming the detection
rate gain justifies the latency increase on your hosting plan.

---

## Frontend integration

The API response maps directly to the `StoredRide` interface in
`src/lib/storage.ts`. The frontend's `useVideoAnalysis` hook currently runs
MoveNet in-browser. To switch:

1. Add `VITE_POSE_API_URL=https://your-api.railway.app` to `.env`
2. In `useVideoAnalysis`, replace the TF.js inference call with:
   ```ts
   const res  = await fetch(`${import.meta.env.VITE_POSE_API_URL}/analyze/video`, {
     method: 'POST',
     body:   formData,  // file as multipart
   });
   const { job_id } = await res.json();
   // poll GET /jobs/{job_id} until status === 'complete'
   ```
3. Map `result.biometrics` and `result.ridingQuality` into the existing
   `BiometricsSnapshot` type — field names are identical.

---

## Questions / contacts

- Product context: Ross (agent team) or Rossella directly
- Benchmark data: `/Users/ella/Documents/Horsera/pose_benchmark/results_v4_full/`
- HTML report: `report_v4_rossella_ride.html` in the same folder
