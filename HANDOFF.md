# Horsera — Handoff

_Written 2026-10-29 for Daniel, who is taking over Horsera from Rossella. Written to be read by a person **and** by an AI coding tool (Claude Code, Lovable, Cursor, etc.)._

> **If you are an AI agent:** read this file first. It supersedes the older working instructions in `CLAUDE.md` (the "agent team / Trello" workflow is historical and should not be followed unless Daniel asks for it). For deeper detail, follow the links in [section 8](#8-where-to-read-more). Treat `_agents/*.md` as historical product memory, not as current architecture.

---

## TL;DR

- **What Horsera is meant to be:** an AI rider-development platform. A rider logs rides and uploads video; Horsera measures the rider's position (biomechanics) from the video, links it to how riding is judged (riding quality), to the skills a level requires (tasks), and to discipline levels (Pony Club, USDF dressage), then tells the rider what to work on next. An AI advisor, **Cadence**, knows the rider's history and answers questions. See [section 1](#1-the-full-vision).
- **What the demo showed:** one loop only. Upload a ride video, draw a pose skeleton over it, score 8 position metrics, pick a "next focus", place it on a learning path, and chat with Cadence. The latest demo ("Horsera Ride Read") is a Claude artifact, **not** this repo, and its pose data was produced offline with Google MediaPipe. See [section 2](#2-what-the-demo-focused-on).
- **Where the real code is:** this repo, `rossella-horsera/horsera_app`. React/Vite frontend on Vercel, a Python FastAPI pose service (`pose_api/`) on GCP Cloud Run, video in Google Cloud Storage, rides in Firebase/Firestore. See [section 3](#3-where-the-code-lives) and [section 4](#4-how-it-works-behind-the-scenes).
- **The problem you inherit:** Rossella could not get pose detection working end to end. The pipeline code exists and was last worked on in April 2026, but it has several fragile points: cloud auth, missing model files when run locally, horse detection gating, and scoring that quietly returns "average" numbers when nothing is detected. **Tested during this handoff:** the model and pipeline detect the horse and rider fine on a side-on clip, but 3 of the 6 position scores are stuck at a default 0.6 on side-on video because of a bug. [Section 5](#5-pose-detection-deep-dive) explains how it works, and [section 6](#6-getting-pose-detection-working-again) gives a step-by-step plan to get it working again.

---

## 0. Where everything lives

| Thing | Where | Notes |
| --- | --- | --- |
| Main code | GitHub `rossella-horsera/horsera_app` (this repo, **public**) | Made public so Vercel auto-deploys. Consider making it private. |
| Live app | `app.horsera.ai` (Vercel) | Vercel team slug `rossella-horseras-projects`. |
| Pose API | GCP project `horsera`, region `us-east4`, Cloud Run service + CPU/GPU Cloud Run Jobs | Private service. The browser reaches it through the Vercel proxy `api/pose.js`. |
| Video storage | GCS bucket `horsera-pose-input-<project>` (prefixes `uploads/`, `saved-rides/`, `job-results/`) | See the lifecycle warning in [5.4](#54-likely-failure-points-check-in-this-order). |
| Ride records | Firebase Auth (anonymous) + Firestore `users/{uid}/rides/{rideId}` | Supabase was retired in April 2026 (PR #9). Older notes that mention Supabase are out of date. |
| Demo | Claude artifact "Horsera Ride Read" (owned by Rossella's claude.ai account) | Not deployed from this repo. See [section 2](#2-what-the-demo-focused-on). |
| Product docs | `_product-docs/` in this repo | Vision, strategy, architecture model, roadmap, biomechanics formulas, progression ladders. |
| Engineering docs | `docs/current-app-architecture.md`, `pose_api/README.md`, `pose_api/infra/README.md`, `docs/vercel-pose-proxy.md` | Accurate as of April 26, 2026. |
| Task tracking | Trello board "Horsera" + Slack `#horsera-agents` | Historical. Ask Rossella whether to keep them. |
| Secrets | Vercel env vars, GCP Secret Manager / Cloud Run env, local `.env` files | **None are in the repo.** Ask Rossella for access. GCP IAM goes through the `engineering@horsera.ai` Google group, because org policy blocks plain Gmail accounts. |

**People (history):** Rossella is the founder and product owner (non-developer; she worked through Claude). Matt was the backend/infra engineer and wrote most of the April 2026 code (GCP migration, GPU workers, preview analysis). Goran was the ML engineer: model benchmarking and the Roboflow keypoint annotation sprint. The repo also defines AI "agent personas" (Ross, Lauren, Beau, Quinn, Monty, Sage, and a creative director persona also called "Daniel"). These are prompt files in `_agents/`, not people.

---

## 1. The full vision

### 1.1 One sentence
Horsera is an AI-powered rider development platform that turns everyday riding into structured, measurable progress.

### 1.2 The problem
Riders spend years and a lot of money training, but feedback is scattered across lessons, notes, videos and show results. Riders can't easily answer: *Where am I? What should I work on next? Am I improving? Am I ready to move up?*

### 1.3 The development loop
```
Set Goals → Ride & Practice → Capture Evidence → AI Analysis → Insight & Guidance → Progress & Readiness → (back to Ride)
```

### 1.4 The core model (four layers)
This is the heart of the product. Source: `_product-docs/🐴 Horsera Architecture 🚀🤩💖.txt`.

| Layer | Meaning | Examples |
| --- | --- | --- |
| **RiderBiomechanics** | What the rider physically controls | Lower leg stability, core stability, upper body alignment, rein steadiness, rein symmetry, pelvis neutrality (the tier-1 set), plus seat independence, timing of aids, half-halt coordination, weight distribution |
| **RidingQuality** | How riding is judged | Rhythm, Relaxation, Contact, Straightness, Impulsion, Collection, Balance, Adjustability |
| **Tasks** | Observable skills | 20 m circle at trot, walk–trot transition, leg yield, small fence |
| **Levels** | Discipline milestones | USDF Intro → Training → First…; Pony Club D1 → D2 → D3 → C1 → C2 → C3 → B |

Causal chain: **biomechanics → riding quality → task success → level readiness.** For example, an unstable lower leg makes the horse drift, so the circle gets uneven, straightness drops, and the rider is less ready for Intro Level.

Underneath sits an **Evidence** layer (video signals, trainer rubric scores, trainer notes, ride metadata) and a **derived Assessment** layer per layer. Biomechanics and RidingQuality are graded *Emerging → Inconsistent → Developing → Consistent → Mastering*. Tasks and Levels are graded *NotReady → AlmostReady → LikelyReady (→ ConsistentlyReady)*. Assessments come from accumulated evidence, never from one ride.

Reference data:
- `_product-docs/Horsera - Biomechanics Metrics.csv` has 22 pose-derived metrics in 6 groups (Lower leg, Hand/Rein, Upper body, Core & seat, Leg/stirrup, Balance/symmetry), each with landmarks, formula, typical ranges, ideal value and feedback wording. The ⭐ metrics are MVP.
- `_product-docs/Horsera - Progression Pony Club.csv` and `…USDF.csv` map Level → Tasks → primary RidingQualities → key RiderBiomechanics.

### 1.5 Product pillars (from the Product Strategy doc)
1. **Cadence**, a persistent AI advisor across the whole app. It knows the rider's goals, rides, horse and history, and also answers general equestrian questions. A separate expert persona, **Monty**, was being defined as a domain-knowledge layer; whether Monty stands alone or powers Cadence is still open.
2. **Goals & structured progression**: discipline tracks, levels, milestones with observable states.
3. **Learning & guided practice**: lessons and on/off-saddle exercises per milestone.
4. **Ride capture & evidence**: ride log, video, context, GPS/gaits (later).
5. **Assessment, feedback & validation**: trainer feedback, rider reflection, AI video analysis (labeled assistive/beta).
6. **Adjustment & personalized next focus**: drills, content, plan changes.
7. **Achievement, readiness & competition**: badges, "Ride the Test" mock tests, readiness signals, show entry/compliance records (Coggins, memberships).
8. **Horse development & readiness**: trainer/owner-led horse goals.
9. **Persistent system of record**: nothing resets each season.

### 1.6 Roadmap (from `_product-docs/Horsera - Roadmap.csv`)
| Epic | MVP | V2 | V3 (horse) |
| --- | --- | --- | --- |
| **1. System of record + progression** | Rider + 1 horse; goals, milestones, rides, videos, feedback; 1 structured program (Pony Club-inspired); 10–20 milestones; static drills; basic milestone states | Multi-role (trainer/owner), discipline versions, level system, trends + readiness, competition objects | Full horse persona and horse programs |
| **2. Ride capture** | Manual ride log, video upload + async processing, rider reflection (voice/text), structured feedback + AI summary | Sensors, trimming/highlights, structured rubric, trainer validation | Horse session logs |
| **3. Intelligence + readiness** | Basic rider position summary from video, compare to previous ride, next-focus engine, Cadence chat with context retrieval, "summarize my last 3 rides", heuristic readiness signal | Goal-specific analysis, longitudinal patterns, adaptive planning, proactive nudges, competition DB | Horse biomechanics, horse readiness |

---

## 2. What the demo focused on

The demo deliberately covered **one loop of Epic 3**: *upload a ride video → get a read of the rider's position*. Everything else in section 1 is vision.

### 2.1 "Horsera Ride Read" (the latest demo, a Claude artifact)
- **What it shows:** a rider snapshot bar; **Latest Ride Read**, which is the video with a canvas **pose skeleton overlay**, an overall score ring, and 8 metric cards grouped Posture / Leg / Hand / Seat; **Next Focus** (the weakest reliable metric); a **Learning Path** that highlights where that weakness matters on the Pony Club ladder D1→B, framed as "a read from one ride" and not a level placement; **Ride History**; and a persisted **Cadence** chat that uses the rider's data and also answers general horse questions.
- **How it was built:** a single HTML page stored as a Claude artifact. It reads everything from the artifact's own small database (`profile/rider`, `rides/<id>`, `chat/log`). Each ride document already contains its per-frame landmarks and 8 computed metrics. **The page does no video processing.** New rides were processed in a Claude session and written into the database by hand.
- **Pose model used:** Google **MediaPipe Pose Landmarker** (33 points, includes heel and toe), run offline in a sandbox. This is **not** the YOLO pipeline in this repo.
- **Scoring:** the exact RMS/StdDev formulas from the Biomechanics Metrics CSV, normalized by torso length, with its 4-tier bands. One ride was logged and scored 49/100; the weakest metric was Lower Leg Stability.
- **Key lesson from the demo:** metrics defined on *absolute image position* (Pelvis Vertical Stability, Head Stability) are dominated by **camera motion** on a handheld, panning clip. The demo flagged them, plus Heel Depth, as low confidence and left them out of the overall score. The same issue affects the production pipeline (see [5.5](#55-known-quality-limitations-even-when-it-runs)).
- **The intended next step**, never started: "Path B", porting this experience into `horsera_app` on `app.horsera.ai` using the real pipeline. That is the job that is now yours.
- Build notes live in the project's files as `knowledge/claude/ride-read-demo-notes.md`. Ask Rossella for the artifact link.

### 2.2 What `app.horsera.ai` (this repo) actually implements
| Vision area | Status in code |
| --- | --- |
| Video upload → cloud pose analysis → skeleton playback → scores | **Implemented** (`usePoseAPI` + `pose_api`), but see section 5 for why it may not run today |
| Saved rides, history, ride detail, progress charts | Implemented (Firestore + local cache). Some screens fall back to mock data |
| Journey / levels | Partly hardcoded (USDF Intro A movements), with the level inferred from scores heuristically |
| Cadence | Drawer UI; calls OpenAI **directly from the browser** if `VITE_OPENAI_API_KEY` is set, otherwise canned answers. Not grounded in a server-side rider model |
| Tasks / levels / assessments as data | **Not implemented.** The data model is ride-centric, not progression-engine-centric |
| Trainer, horse, competition, learning library | Not implemented |

---

## 3. Where the code lives

```
horsera_app/
├── src/                         React + TypeScript SPA (Vite). Inline styles, mobile-first.
│   ├── App.tsx                  Routes (HashRouter): /  /rides/:id  /jobs/:jobId/view  /progress  /journey  /analysis
│   ├── pages/RidesPage.tsx      Upload + ride list + save flow  ← entry point of the pose loop
│   ├── hooks/usePoseAPI.ts      Upload → job → poll → map result to keyframes  ← ACTIVE pose client
│   ├── lib/poseApi.ts           API base URL + signed upload / pin / read-url helpers
│   ├── components/VideoWithSkeleton.tsx   Draws the 17-point skeleton over the <video> (canvas)
│   ├── pages/RideDetailPage2.tsx          Saved ride playback with skeleton
│   ├── pages/JobOverlayViewerPage.tsx     Recovery/debug viewer for a running job
│   ├── lib/storage.ts           Ride store: local cache + Firestore + keyframe chunks
│   ├── integrations/firebase/client.ts    Anonymous Firebase auth
│   ├── components/layout/CadenceDrawer.tsx Cadence chat (browser → OpenAI)
│   ├── hooks/useVideoAnalysis.ts + lib/poseAnalysis.ts   OLD in-browser MoveNet (TF.js) path, not wired to the main flow
│   └── data/mock.ts             Mock data still used as fallback on some screens
├── api/pose.js                  Vercel serverless proxy → private Cloud Run (Workload Identity Federation)
├── vercel.json                  Rewrites /api/pose/* → proxy; everything else → SPA
├── pose_api/                    Python pose service
│   ├── main.py                  FastAPI: signed URLs, jobs, polling, frame endpoint
│   ├── pipeline.py              THE POSE PIPELINE (horse detect → crop → YOLO pose → scores)
│   ├── worker.py                Cloud Run Job entrypoint (runs one job)
│   ├── Dockerfile               2-stage: exports YOLO .pt → .onnx, then a slim ONNX-only runtime
│   ├── requirements*.txt        cpu / gpu variants
│   ├── infra/                   Terraform + rollout.sh for GCP
│   ├── TESTING_COLAB.md         How to run the pipeline in Google Colab
│   └── railway.toml, render.yaml   Legacy deploy targets (unused)
├── public/seed-rides.json       21 pre-analyzed demo rides imported on load (video URLs have expired)
├── _product-docs/               Vision / strategy / formulas / ladders (section 1)
├── docs/                        Current architecture + proxy setup + pose benchmark report
├── context/                     Short product / tech / progress summaries (Apr 2026)
├── _agents/                     Historical agent-team memory, decisions, backlog
└── scripts/                     Sage (LinkedIn agent) + Slack/Trello bots, not part of the app
```

**Commands:** `npm install`, `npm run dev` (Vite, usually :8080 or :5173), `npm run build`, `npm run lint`, `npm run test` (vitest; there are a few tests in `src/test/`).

---

## 4. How it works behind the scenes

### 4.1 The ride-analysis loop
```
Browser (RidesPage → usePoseAPI)
  1. POST {API}/uploads/video-url            → signed GCS PUT URL + gs:// object_path
  2. PUT video bytes directly to GCS         (does not pass through Vercel or Cloud Run)
  3. POST {API}/analyze/video/object         → job_id   (API creates the job in Firestore `pose_jobs`)
         API either runs the job inline (EXECUTION_BACKEND=inline)
         or starts a Cloud Run Job worker (EXECUTION_BACKEND=cloud_run_job; GPU if size ≥ GPU_THRESHOLD_MB)
  4. GET  {API}/jobs/{job_id}  every 1–3 s, up to 75 min
         stage: queued → previewing (first 60 s at 2 fps) → analyzing (full ride at 3 fps) → complete | failed
         preview.result = provisional result;  result = final result
  5. On save: POST /videos/pin (copies uploads/… → saved-rides/…), POST /videos/read-url (signed playback URL, 15 min)
  6. Ride saved to Firestore users/{uid}/rides/{id}; keyframes saved in chunks of 100 frames to …/keyframeChunks
```
`{API}` is `http://localhost:8000` when the page is served from `localhost`, `/api/pose` (the Vercel proxy) everywhere else, or `VITE_POSE_API_URL` if set (`src/lib/poseApi.ts`).

### 4.2 The Vercel proxy (`api/pose.js`)
Cloud Run is **private** (`allow_unauthenticated_api = false`; the org policy forbids `allUsers`). The proxy turns Vercel's OIDC token into a Google identity token through Workload Identity Federation (pool `vercel-pool`, provider `vercel-provider`, service account `vercel-pose-proxy@…`) and forwards the call. It needs these Vercel env vars: `POSE_API_URL`, `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`, `GCP_SERVICE_ACCOUNT_EMAIL` (optional: `POSE_API_AUDIENCE`, `POSE_PROXY_DEBUG=1`, `POSE_PROXY_EXPOSE_ERRORS=1`). The WIF condition only trusts **`environment=='production'`**, so Vercel *preview* deployments cannot reach the pose API. Full setup: `docs/vercel-pose-proxy.md`.

### 4.3 Frontend env vars (names only)
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_POSE_API_URL` (optional), `VITE_POSE_API_LEGACY_UPLOAD_FALLBACK=0`, `VITE_OPENAI_API_KEY` (optional; this is exposed to the browser, so move it server-side).

### 4.4 Pose API env vars
All of them are listed in `pose_api/README.md`. The ones that matter most: `GCS_UPLOAD_BUCKET`, `JOB_STORE_BACKEND` (`memory`|`firestore`), `EXECUTION_BACKEND` (`inline`|`cloud_run_job`), `CLOUD_RUN_PROJECT/REGION/CPU_JOB/GPU_JOB`, `GPU_THRESHOLD_MB`, `CORS_ORIGINS`, `SAMPLE_FPS`, `PREVIEW_DURATION_SECONDS`, `GCS_SIGNING_SERVICE_ACCOUNT_EMAIL`.

---

## 5. Pose detection deep dive

### 5.1 Models
- **Horse detector:** `yolov8m.onnx`, the stock Ultralytics YOLOv8-medium COCO detector. Class 17 is `horse`, accepted at confidence ≥ 0.30.
- **Rider pose:** `yolov8m-pose.onnx`, the stock Ultralytics YOLOv8-medium **COCO 17-keypoint** pose model. It has nose, eyes, ears, shoulders, elbows, wrists, hips, knees and ankles, and **no heel or toe**. Keypoints are accepted at confidence ≥ 0.35.
- Both run on **ONNX Runtime** (CPU, or CUDA on the L4 GPU worker). There is no PyTorch at runtime.
- **The model files are not in git** (`*.onnx` and `*.pt` are gitignored). They are produced in the **first stage of `pose_api/Dockerfile`**, which downloads `yolov8m.pt` / `yolov8m-pose.pt` from Ultralytics and exports them to ONNX. The pipeline looks for them **next to `pipeline.py`** (`_MODEL_DIR`).
- These are **generic, not fine-tuned** models. Goran benchmarked YOLOv8**s**-pose against MediaPipe in March 2026 (trunk-angle stability ±3.75° vs ±41.9°; see `docs/pose_benchmark_v4.html`), and Matt later upgraded to the **m** model. A Roboflow sprint started to annotate equestrian keypoints (from YouTube dressage footage, exported as COCO keypoints) for fine-tuning, but **no custom-trained model was ever integrated**. The planned "Phase 2" hybrid (MediaPipe for head/feet, YOLO for body, `merge_landmarks()`) is **not in the code**, even though `HORSERA_PHASE2` still appears in the docs and `.env.example`.

### 5.2 The pipeline (`pose_api/pipeline.py → analyze_video`)
1. Read video metadata. Decode frames progressively. Sample at `SAMPLE_FPS` (3), with adaptive bursts up to 8 fps when motion spikes or the rider is lost.
2. **Detect the horse** in each sampled frame and keep the largest box. If no horse is found, it reuses the last box for up to `MISSING_HORSE_GRACE_FRAMES` (2) frames.
3. **Smart crop:** expand the horse box (20% padding, extra upward for the rider), smooth it with EMA, crop, and scale up. This roughly triples the effective resolution on the rider.
4. **Run the pose model on the crop**, then map the keypoints back to full-frame coordinates.
5. **Pick the mounted rider** (`_select_mounted_rider` / `_mounted_candidate_score`). The rider's hips must overlap the horse box and sit in its upper part. A person whose ankles are low in the box (a trainer on foot) is rejected. Candidates are ranked by **APS v4**, a 6-check anatomical plausibility score (shoulders and hips visible, shoulders above hips, torso taller than 0.4× its width, a knee and an ankle visible).
6. **Occlusion handling:** estimate which side the camera is on per frame and mark the far-side leg keypoints as occluded.
7. **CAE (Camera-Aware Expectation) index:** shoulder-width ratio, used to down-weight frames where the rider is foreshortened.
8. **Biomechanics** (`compute_biomechanics`) produces 6 scores in 0–1: `lowerLegStability`, `reinSteadiness`, `reinSymmetry`, `coreStability`, `upperBodyAlignment`, `pelvisStability`. Each is the std-dev of a keypoint series divided by the median shoulder width, mapped to 0–1.
9. **Riding quality** (`_derive_riding_quality`) produces 6 scores, each a simple average of two or three biomechanics scores (for example, rhythm = (lower leg + pelvis)/2).
10. **Insights:** template sentences for the strongest and weakest metric, plus a warning when the detection rate is below 40%.
11. **Output:** `PipelineResult` with the scores, `overallScore`, `detectionRate`, `caeIndex`, `apsScore`, frame counts, and `framesData[]` (each frame has `frame_time` and 17 `[x, y, conf]` keypoints normalized to 0–1). The frontend maps these into `{x, y, score}` and draws them in `VideoWithSkeleton.tsx`.

### 5.3 Current state (as of the last commit, 2026-04-26)
- The full cloud loop (upload → Cloud Run Job → Firestore → poll → playback) was built and merged by Matt in PRs #6–#17. The latest work added a first-60-second **preview** pass to hide latency, adaptive sampling, and the "reject the trainer" rider selection.
- Rossella batch-processed 21 rides into `public/seed-rides.json` on April 5–6. That was the last time the pipeline is known to have produced results.
- Nothing has been committed since April 26. Six months later, Rossella could not get pose detection working, and **the exact error was not recorded**. So diagnose it from scratch using the list below.

**Verified while writing this handoff (2026-10-29, cloud sandbox, CPU only):**
- The models export cleanly with the current Ultralytics (8.4.x). The pipeline runs on `onnxruntime 1.24.4`, and a `cp314` wheel exists for the Docker runtime's Python 3.14.
- `scripts/smoke_test.py` on a 6-second side-on test clip (made from `src/assets/hero-rider.jpg`) found the **horse in 18/18 frames and the rider in 18/18 frames** (detectionRate 1.00, about 1.5 s per sampled frame on CPU). The near-side skeleton keypoints were well placed with confidence 0.8–0.98. **So the model and pipeline core work.** A real failure is most likely in the cloud plumbing (5.4 #1–#4, #8) or in the input video (#5).
- **But 3 of the 6 scores were never really computed.** `coreStability`, `upperBodyAlignment` and `pelvisStability` all came back at exactly **0.6**, the "no data" default. See 5.4 #6. If Rossella saw scores that never seemed to change, this is probably why.
- The frontend builds (`npm run build`) and its 9 vitest tests pass.

### 5.4 Likely failure points (check in this order)

Each item has its **symptom** and **how to check**.

1. **The GCP side has drifted or is switched off.** Billing, Cloud Run service, Artifact Registry images, Cloud Run Jobs, GPU (L4) quota in `us-east4`, and the Firestore `pose_jobs` collection may have changed in six months.
   *Symptom:* `/uploads/video-url` or `/analyze/video/object` returns 5xx; jobs stay `queued`; the stale-job timeout marks them failed.
   *Check:* `gcloud run services list --region us-east4`, `gcloud run jobs list --region us-east4`, `gcloud run jobs executions list …`, and the Cloud Run logs. Confirm `gcloud auth list` shows an account in the `engineering@horsera.ai` group.

2. **The Vercel → Cloud Run proxy auth is failing.** Any missing proxy env var throws `Missing required environment variable`. The WIF trust only allows the **production** Vercel environment of the **exact** team/project names. Renaming the project or team, or testing on a preview URL, breaks it.
   *Symptom:* `/api/pose/...` returns 500 or 401/403.
   *Check:* set `POSE_PROXY_DEBUG=1` and `POSE_PROXY_EXPOSE_ERRORS=1` in Vercel, then call `https://app.horsera.ai/api/pose/health`. Look at the `x-pose-proxy-upstream-status` response header.

3. **Running locally without models or cloud credentials.** The README's local steps (`pip install -r requirements.txt && uvicorn main:app`) **do not create the ONNX models**, so loading logs `yolov8m.onnx NOT FOUND` and every job fails. Signed upload URLs also need a real GCS bucket and credentials that can **sign** URLs. Plain user ADC credentials usually cannot sign V4 URLs; you need a service account or `GCS_SIGNING_SERVICE_ACCOUNT_EMAIL` with Token Creator.
   *Fix:* export the models first (see [6.1](#61-prove-the-model-works-on-one-clip-no-cloud)). For local end-to-end testing, either point at a real bucket with a service account, or skip GCS and test with `POST /analyze/frame` or the smoke test script.

4. **The Docker build command in `pose_api/README.md` is wrong.** `docker build -f pose_api/Dockerfile .` run from the repo root uses the root as build context, so `COPY requirements*.txt` fails, or `COPY . .` puts the whole repo in `/app`. **Use `pose_api/` as the context**, as `infra/rollout.sh` does: `docker buildx build --platform linux/amd64 -f pose_api/Dockerfile pose_api`. Images built on Apple Silicon without `--platform linux/amd64` fail on Cloud Run with `exec format error`.

5. **The horse gate drops every frame.** By design, pose is **only** run inside a detected horse box ("mounted analysis only"). If the COCO horse detector misses (tight framing, unusual angle, dark arena, a horse partly out of frame, low resolution), the pipeline returns **no rider** for that frame.
   *Symptom:* `detectionRate` near 0, an empty or flickering skeleton.
   *Check:* the job progress fields `horse_frames`, `valid_poses` and `detection_rate` (also printed by `scripts/smoke_test.py`). Try `DET_CONF` 0.2. The rider-selection heuristics in `_mounted_candidate_score` can also reject a real rider if the horse box is cut off.

6. **Failure looks like success, and side-on video always triggers it for 3 metrics.** When there are fewer than 3 usable samples, each biomechanics score defaults to **0.6** (0.5 if there were no frames at all), and the UI shows a believable "average" score. Worse, on **side-on video**, the camera-side occlusion step (`mark_occluded_keypoints`) sets the far-side **hip**, knee and ankle confidence to 0 on every frame. But `compute_biomechanics` only uses hip data when **both** hips are visible. So `coreStability`, `upperBodyAlignment` and `pelvisStability` (and the riding-quality scores built from them) are **always 0.6** for the camera angle the product recommends. This was reproduced on 2026-10-29; see 5.3.
   *Fix:* compute those metrics from the single visible hip and shoulder (side-on, the far side adds little); return `null` instead of 0.6 when there is not enough data, and show "not enough data" in the UI; always check `detectionRate`, `framesAnalyzed` and per-metric sample counts before trusting a score.

7. **Saved ride videos are deleted after 7 days.** The Terraform bucket lifecycle rule (`upload_retention_days = 7`) has **no prefix filter**, so it deletes `saved-rides/` and `job-results/` as well as `uploads/`. Older saved rides lose their video and stored result payloads. The signed URLs in `public/seed-rides.json` (from April) have expired too. *Fix:* add `matches_prefix = ["uploads/"]` to the lifecycle condition.

8. **CORS mismatch.** The API's *code default* `CORS_ORIGINS` does not include `https://app.horsera.ai`; Terraform's default does. The **GCS bucket CORS** must also allow the page's origin, or the browser's direct `PUT` to the signed URL fails. *Symptom:* "Network error while uploading video" in the browser console with a CORS message.

9. **Latency and timeouts.** Full-resolution phone video, decoded on a CPU worker at 3 fps or more, can take many minutes. The browser stops polling after 75 min. The worker timeout is 3600 s, plus a 90 s grace before the API marks the job failed. The upload XHR times out at 10 min on slow connections. The Vercel proxy has `maxDuration: 60` s, which is fine for JSON but not for the legacy multipart `/analyze/video` path, so keep `VITE_POSE_API_LEGACY_UPLOAD_FALLBACK=0`.

10. **Memory.** YOLOv8m needs about 300 MB at runtime. The CPU worker needs ≥ 4 GiB, and the old Railway deploy OOM-crashed for exactly this reason. If someone shrinks the worker, jobs die with no clean error.

11. **Dependency drift.** The runtime image uses **Python 3.14** with pinned `onnxruntime==1.24.4` / `numpy==2.3.4`, and the exporter stage uses `ultralytics==8.4.22` on Python 3.11. A rebuild re-downloads the `.pt` weights from GitHub. If any pinned version or download disappears, the image build breaks. The GPU image depends on CUDA user-space wheels matching `onnxruntime-gpu`, and `REQUIRE_CUDA=1` makes the GPU worker fail fast if CUDA isn't available.

### 5.5 Known quality limitations (even when it runs)
- **The metrics don't match the product formulas.** `compute_biomechanics` measures **absolute image y-positions** (ankle y, wrist y, hip midpoint) normalized by shoulder width. The product spec (`Biomechanics Metrics.csv`) defines most metrics **relative to the body**, for example ankle relative to hip. So horse movement, rising trot, and camera panning or zooming all count as "instability". This is the same camera-motion problem the demo hit. Moving to body-relative formulas is probably the single biggest accuracy improvement.
- **No heel or toe** in COCO-17, so Heel Position, Heel Depth and Ankle Flexion from the spec can't be computed. MediaPipe (33 points) or a fine-tuned model would add them.
- **The far-side leg is usually hidden** by the horse in side-on video, so leg metrics rely on one leg.
- Riding-quality scores are **simple averages** of biomechanics scores, a placeholder rather than a model.
- The demo computed **8** metrics with spec formulas; production computes **6** different ones. The two sets don't line up one to one.

### 5.6 Licensing flag
Ultralytics YOLOv8 code and weights are **AGPL-3.0**. An early decision (`_agents/DECISIONS.md`, 2026-03-11) rejected YOLO-Pose for exactly this reason, but production now uses it. Before commercial launch, either buy an Ultralytics Enterprise license or switch to a permissively licensed model (MediaPipe, RTMPose/MMPose, ViTPose: Apache-2.0).

---

## 6. Getting pose detection working again

The suggested order isolates one layer at a time.

### 6.1 Prove the model works on one clip (no cloud)
```bash
cd pose_api
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt ultralytics          # ultralytics (and torch) only to export the models
python -c "from ultralytics import YOLO; YOLO('yolov8m.pt').export(format='onnx', opset=12, dynamic=True); YOLO('yolov8m-pose.pt').export(format='onnx', opset=12, dynamic=True)"
ls *.onnx                                             # yolov8m.onnx  yolov8m-pose.onnx must sit next to pipeline.py
python scripts/smoke_test.py /path/to/side-on-ride.mp4 --seconds 20
```
`scripts/smoke_test.py` runs `pipeline.analyze_video` on the first N seconds and prints the detection rate, horse-frame count, scores, and a few keypoints. **Use a steady, side-on clip** (tripod, rider crossing the frame at a constant distance, 5–20 s). If `horse_frames` is high and `detectionRate` is above 0.5, the model side is fine and the problem is infrastructure (steps 6.2 and 6.3). If not, the problem is the pipeline or the model (5.4 #5 and 5.5).

Alternative without a local setup: `pose_api/TESTING_COLAB.md` (Google Colab).

### 6.2 Run the API locally
`uvicorn main:app --port 8000` with `JOB_STORE_BACKEND=memory` and `EXECUTION_BACKEND=inline`, plus `GCS_UPLOAD_BUCKET` and service-account credentials for the upload flow. Then run `npm run dev`. On `localhost` the frontend talks to `http://localhost:8000` automatically.

### 6.3 Production
Work through 5.4 #1, #2, #7 and #8. Then rebuild and deploy with `pose_api/infra/rollout.sh <project> us-east4 <tag> --apply`, which needs Docker, Terraform, and gcloud as an account in the engineering group.

### 6.4 Simpler alternative worth considering
Because the demo's look and feel came from MediaPipe results (33 points including heels), and the pipeline complexity (GPU jobs, WIF proxy, preview passes) is heavy for an MVP, a pragmatic option is:
- run MediaPipe Pose Landmarker **in the browser** (WASM/WebGL; no server, no upload wait), or in a small single Cloud Run service;
- compute the spec's **body-relative** formulas (port them from the demo);
- keep Firestore for rides and drop the GCS/job machinery until it is needed.

The repo already has an older in-browser path (`useVideoAnalysis.ts`, MoveNet via TF.js) that shows the pattern. This trades some accuracy (the YOLO benchmark beat MediaPipe on trunk stability) for something that actually runs, and avoids the AGPL question.

---

## 7. Open decisions and next steps

1. **Pick the pose path:** fix the existing YOLO cloud pipeline (6.1–6.3), or switch to the simpler MediaPipe path (6.4). Either way, align the metric formulas with `Biomechanics Metrics.csv`.
2. **Port the demo experience into the app** ("Path B"): the Ride Read layout, next focus, learning path, and a grounded Cadence.
3. **Fix the side-on hip bug and make "no detection" visible** instead of showing default 0.6 scores (5.4 #6). This is small, contained and high value.
4. **Fix the bucket lifecycle rule** so saved rides survive (5.4 #7).
5. **Move Cadence server-side** (no OpenAI key in the browser). The backlog suggested a Claude model with the rider's last rides injected as context. Decide on Monty vs Cadence.
6. **Real auth:** anonymous Firebase auth means no cross-device or account recovery.
7. **Model licensing** (5.6), and whether to restart the fine-tuning and annotation effort.
8. Clean up stale docs: `CLAUDE.md` (agent/Trello workflow, mentions Supabase and "no test suite"), `pose_api/.env.example` (Supabase), `HORSERA_PHASE2` references, and the README Docker command.

---

## 8. Where to read more

| Topic | File |
| --- | --- |
| Implemented architecture, request flows, risks (best engineering doc) | `docs/current-app-architecture.md` |
| Pose API endpoints, env vars, result shape | `pose_api/README.md` |
| GCP Terraform rollout | `pose_api/infra/README.md`, `pose_api/infra/rollout.sh` |
| Vercel proxy + Workload Identity Federation | `docs/vercel-pose-proxy.md`, `api/pose.js` |
| Pose model benchmark (YOLO vs MediaPipe) | `docs/pose_benchmark_v4.html` |
| Run the pipeline in Colab | `pose_api/TESTING_COLAB.md` |
| Vision / pitch / strategy / roadmap | `_product-docs/*.txt`, `_product-docs/HORSERA_PRODUCT_PLAN.md`, `_product-docs/user-journey-jtbd.md` |
| Metric formulas and level ladders | `_product-docs/*.csv` |
| Why past decisions were made | `_agents/DECISIONS.md` |
| Backlog ideas (latency "big rocks", Cadence) | `_agents/BACKLOG.md`, `_agents/BIG_ROCKS_PLAN.md` |
| Brand (Dawn Ride palette: forest green + warm amber on cream) | `context/brand.md`, `_agents/CD.md` |

### Glossary
- **APS (v4):** Anatomical Plausibility Score. Six checks used to pick the best rider skeleton in a frame.
- **CAE:** Camera-Aware Expectation. A per-frame weight based on how front-on or side-on the rider appears.
- **Cadence:** the in-app AI advisor. **Monty:** the equestrian-expert persona, possibly Cadence's knowledge layer.
- **Preview vs result:** the provisional first-60-second analysis vs the canonical full-ride analysis on the same job.
- **Pin:** copying an uploaded video from `uploads/` to `saved-rides/` when the rider saves the ride.
