# Horsera - Technical Context

_Last updated: 2026-04-26_

This file is intentionally short to avoid duplicating the architecture docs.

## Source Of Truth

- Current implemented architecture: [../docs/current-app-architecture.md](../docs/current-app-architecture.md)
- Pose API runbook: [../pose_api/README.md](../pose_api/README.md)
- Vercel proxy setup: [../docs/vercel-pose-proxy.md](../docs/vercel-pose-proxy.md)
- GCP rollout: [../pose_api/infra/README.md](../pose_api/infra/README.md)

## Compact Summary

Horsera is a React/Vite SPA with Firebase-backed ride persistence, GCS-backed video storage, a FastAPI pose-analysis service, optional Vercel proxying to authenticated Cloud Run, and a browser-side Cadence assistant integration.

The main operational flow is:

```txt
browser video -> signed GCS upload -> pose job -> polling -> pinned saved video -> Firestore ride + keyframe chunks
```

## Current Architecture Notes

- `usePoseAPI` is the active ride-analysis path.
- `useVideoAnalysis` is older/local TF.js fallback/demo code.
- Firestore ride records omit full keyframes; keyframes are chunked and hydrated lazily.
- Signed playback URLs expire and are refreshed through the pose API.
- Cadence is not yet behind a server-owned backend boundary.
- Mock/demo data still exists in some product surfaces and should not be treated as canonical rider state.
