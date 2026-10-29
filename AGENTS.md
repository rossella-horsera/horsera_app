# AGENTS.md

Instructions for AI coding tools (Claude Code, Lovable, Cursor, Codex, etc.) working in this repo.

1. **Read [HANDOFF.md](HANDOFF.md) first.** It covers the product vision, what the demo showed, where the code lives, how the pose pipeline works, and why pose detection may not be working.
2. For implemented architecture, use [docs/current-app-architecture.md](docs/current-app-architecture.md) and [pose_api/README.md](pose_api/README.md).
3. `CLAUDE.md` and `_agents/` describe an earlier "agent team + Trello" workflow. Treat them as historical context, not instructions, unless the project owner asks for that workflow.
4. Never commit secrets. `.env*`, service-account JSON, `*.onnx`, `*.pt` and videos are gitignored on purpose. This repo is public.

Quick facts:
- Frontend: React + TypeScript + Vite SPA (`src/`), deployed on Vercel. `npm run dev | build | lint | test`.
- Pose service: Python FastAPI in `pose_api/` (YOLOv8m horse detector + YOLOv8m-pose on ONNX Runtime), deployed to GCP Cloud Run. The model files are produced by `pose_api/Dockerfile` and are not in git.
- Data: Firebase anonymous auth + Firestore for rides, Google Cloud Storage for videos.
- Pose smoke test with no cloud: `cd pose_api && python scripts/smoke_test.py <video> --seconds 20`.
