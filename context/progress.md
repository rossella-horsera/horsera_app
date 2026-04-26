# Horsera - Progress & Roadmap

_Last updated: 2026-04-26_

This file tracks roadmap-level status only. Detailed architecture lives in [../docs/current-app-architecture.md](../docs/current-app-architecture.md).

## Current State

Implemented:

- End-to-end ride-analysis loop from browser upload through saved ride playback.
- Firebase/Firestore ride persistence with local fallback.
- GCS upload, pin, read URL, and optional result-payload storage surfaces.
- FastAPI pose service with inline or Cloud Run Job execution modes.
- Rides, Ride Detail, Progress/Insights, Journey, Cadence, and job recovery surfaces.

Still rough:

- Large files carry too many responsibilities: `RidesPage`, `usePoseAPI`, `storage.ts`, `pose_api/main.py`, `pose_api/pipeline.py`.
- Ride analysis can feel slow for larger videos, even when it eventually succeeds; we need to reduce execution time and/or design the product so latency feels less punishing.
- Journey/progression is not yet a normalized runtime engine.
- Cadence model access is currently browser-side.
- Some screens still mix real persisted data with mock or inferred fallback data.

## Near-Term Engineering Focus

1. Improve production reliability and observability of pose jobs.
2. Reduce or hide large-video analysis latency.
3. Refactor frontend around domains/workflows.
4. Split backend responsibilities into routes, job store, storage, worker dispatch, and pipeline modules.
5. Move Cadence behind a server-owned backend boundary.
6. Normalize progression data so Journey is derived from evidence rather than page-level heuristics.

## Roadmap

### V1 Hardening

- [ ] Reduce complexity in `RidesPage`, `usePoseAPI`, and `storage.ts`.
- [ ] Investigate ways to reduce large-video analysis time or hide latency through better queueing, progress UX, background completion, recovery, and post-upload user flows.
- [ ] Add focused tests around ride persistence, keyframe chunking, playback resolution, and pose result mapping.
- [ ] Improve job failure messages and recovery paths.
- [ ] Document production environment variables and deployment flow.

### V1.5

- [ ] Cadence backend endpoint with server-owned model credentials.
- [ ] Stronger auth/account recovery beyond anonymous-only identity.
- [ ] Cleaner domain model for ride analysis and progression evidence.
- [ ] Remove or isolate mock fallback data from real product surfaces.

### V2+

- [ ] First-class progression engine.
- [ ] Trainer feedback/share flow.
- [ ] More discipline-specific movement recognition.
- [ ] Horse, trainer, and barn multi-user support.
