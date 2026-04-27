# Horsera Pose API - Engineering Handoff

_Last updated: 2026-04-26_

This handoff is intentionally short to avoid duplicating the pose runbook.

## Current Runbooks

- Current app architecture: [../docs/current-app-architecture.md](../docs/current-app-architecture.md)
- Pose API setup, endpoints, env vars, and result shape: [README.md](README.md)
- GCP infrastructure rollout: [infra/README.md](infra/README.md)
- Vercel proxy setup: [../docs/vercel-pose-proxy.md](../docs/vercel-pose-proxy.md)

## Current Production Direction

Prefer Cloud Run API + Cloud Run Jobs + GCS + Firestore, optionally fronted by the Vercel `/api/pose` proxy.

Railway and Render files remain in the repo as legacy deployment surfaces. Older Railway incidents are useful history, but they are not current Cloud Run runbook steps.

## Risks To Keep In Mind

- Pose jobs are the core activation loop; failures after upload are especially damaging.
- Large-video jobs may feel too slow even when they finish successfully; V1 hardening should investigate both runtime reductions and product flows that hide latency.
- The service still supports multiple mode combinations, which increases configuration and test complexity.
- Large result payloads may need GCS offload rather than inline job storage.
- Firestore-backed job state is preferred for worker-based production execution so browser polling does not depend on API process memory.
