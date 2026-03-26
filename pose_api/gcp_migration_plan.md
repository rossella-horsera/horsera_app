# GCP Migration Plan for `pose_api` (Cost-Optimized, GPU-Burst Ready)

## Summary
Migrate from Railway to a split GCP architecture: lightweight Cloud Run API + Cloud Run Jobs workers (CPU default, GPU burst path), with Cloud Storage signed uploads and Firestore job state. This removes single-instance/OOM risk from the current in-memory + background-thread model in `pose_api/main.py`, keeps async UX, and targets your chosen profile: light traffic, 5-10 minute turnaround, tight budget.

## Implementation Changes
1. **Control plane (Cloud Run API service, `us-east4`)**
- Keep public endpoints for health and polling; move job state from in-memory dict to Firestore (`jobs/{job_id}`).
- Add `POST /uploads/video-url` to return a V4 signed upload URL + object path.
- Change `POST /analyze/video` to accept `{ object_path, filename, size_bytes, content_type }` and enqueue a job execution (not raw multipart bytes).
- Keep response shape for `GET /jobs/{job_id}` unchanged to avoid frontend result parsing changes.

2. **Execution plane (Cloud Run Jobs)**
- Create `pose-worker-cpu` job for default processing.
- Create `pose-worker-gpu` job for burst acceleration (L4, non-zonal redundancy, max parallelism 1 initially).
- Worker flow: download object from GCS to `/tmp` -> run pipeline -> write status/results to Firestore -> keep existing best-effort Supabase writes.
- Refactor model/inference bootstrapping in `pose_api/pipeline.py` to support CPU/GPU provider selection via env.
- Routing rule in API: CPU by default; GPU when estimated processing would likely miss 10-minute target (initial threshold: large file size or long duration metadata).

3. **Frontend/API contract update**
- Update `src/hooks/usePoseAPI.ts`:
  1. Replace direct `POST /analyze/video` file upload with:
     - Request signed URL
     - Upload video directly to GCS
     - Submit analyze request with `object_path`
     - Poll jobs endpoint (unchanged)
- Replace hardcoded Railway URL with env-based `VITE_POSE_API_URL`.

4. **Infra, security, and cost guardrails**
- Provision via Terraform: Artifact Registry, Cloud Run service + 2 jobs, Firestore, GCS input bucket, Secret Manager, service accounts/IAM, logging/alerts.
- Bucket lifecycle policy: auto-delete raw uploads after 7 days.
- Budget controls: Cloud Billing budget alerts + alerting on GPU execution count, job failures, and p95 latency.
- Set API service to scale-to-zero; no model preload in API container.

5. **Cutover sequence**
- Deploy GCP stack in parallel with Railway.
- Run shadow validation on representative videos and compare output metrics/timing.
- Switch frontend `POSE_API` base URL to GCP.
- Observe for 48 hours; if SLOs hold, decommission Railway deployment.

## Public API / Interface Changes
- **Added:** `POST /uploads/video-url`
- **Changed request:** `POST /analyze/video` (multipart file upload -> JSON metadata with GCS object path)
- **Unchanged:** `GET /jobs/{job_id}` response contract, analysis result schema, polling behavior

## Test Plan
- Contract tests for new upload/analyze endpoints and unchanged job polling schema.
- Integration tests: signed upload -> analyze submit -> job completion (CPU and GPU path).
- Failure tests: corrupted upload, missing object, job retry behavior, GPU quota unavailability fallback to CPU.
- Performance tests on 10 representative clips:
  - CPU p50/p95 runtime
  - GPU p50/p95 runtime
  - Cost per processed video minute
- Acceptance gates before cutover:
  - `>=95%` jobs complete within 10 minutes for target clip profile
  - `<2%` job failure rate excluding invalid media
  - projected monthly infra spend stays within agreed budget envelope

## Assumptions and Defaults
- Region: `us-east4` (chosen for current documented L4 availability without invitation gating).
- Traffic: light tier (`<30` videos/day).
- Latency goal: ~5-10 minutes typical turnaround.
- GPU policy: burst-only via Cloud Run GPU Jobs; CPU remains default path.
- Supabase remains in place for downstream app data; this plan migrates compute/infrastructure, not database ownership.

## Key References Used
- Cloud Run quotas/limits (60-min request timeout, HTTP/1 size limits): https://cloud.google.com/run/quotas
- Cloud Run billing settings (background execution guidance): https://cloud.google.com/run/docs/configuring/cpu-allocation
- Cloud Run Jobs GPU support/pricing constraints: https://cloud.google.com/run/docs/configuring/jobs/gpu
- Cloud Run pricing (including L4 GPU SKU): https://cloud.google.com/run/pricing
- Cloud Storage signed URLs: https://cloud.google.com/storage/docs/access-control/signed-urls
- Cloud Storage lifecycle policies: https://cloud.google.com/storage/docs/lifecycle
