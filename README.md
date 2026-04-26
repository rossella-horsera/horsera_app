# Horsera App

Horsera is a rider-development web app for ride upload, cloud pose analysis, saved ride playback, progress views, Journey surfaces, and the Cadence assistant.

## Read First

| Need | Document |
| --- | --- |
| Current implemented architecture | [docs/current-app-architecture.md](docs/current-app-architecture.md) |
| Pose API runbook | [pose_api/README.md](pose_api/README.md) |
| Vercel-to-Cloud-Run proxy setup | [docs/vercel-pose-proxy.md](docs/vercel-pose-proxy.md) |
| GCP infrastructure rollout | [pose_api/infra/README.md](pose_api/infra/README.md) |
| Product context | [context/product.md](context/product.md) |

In short: the frontend is a React/Vite SPA; saved rides live in Firebase/Firestore with local fallback; videos and large payloads live in Google Cloud Storage; pose analysis runs through the FastAPI service in `pose_api`; deployed browser calls usually go through `/api/pose`.

## Local Frontend Setup

Requirements:

- Node.js 20+ recommended
- npm

```sh
npm install
npm run dev
```

Vite will print the local URL, usually `http://localhost:5173`.

Useful checks:

```sh
npm run build
npm run lint
npm run test
```

## Local Pose API Setup

The main upload flow expects a pose API at `http://localhost:8000` when running on localhost.

```sh
cd pose_api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open `http://localhost:8000/docs` for FastAPI docs. GCS-backed upload/read/pin flows require the environment described in [pose_api/README.md](pose_api/README.md).

## Frontend Environment

```txt
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_POSE_API_URL=
VITE_POSE_API_LEGACY_UPLOAD_FALLBACK=0
VITE_OPENAI_API_KEY=
```

`VITE_POSE_API_URL` is optional. If omitted, the app uses `http://localhost:8000` on localhost and `/api/pose` elsewhere.

`VITE_OPENAI_API_KEY` is currently used by a browser-side Cadence integration. Do not treat it as a secure server-owned secret boundary.

## Repo Pointers

- `src/App.tsx` - providers and routes.
- `src/pages/RidesPage.tsx` - current upload/list/save surface.
- `src/pages/RideDetailPage2.tsx` - saved ride detail and playback.
- `src/hooks/usePoseAPI.ts` - frontend upload/poll/result mapping.
- `src/lib/storage.ts` - ride cache, Firestore sync, keyframe chunks.
- `api/pose.js` - Vercel proxy.
- `pose_api/main.py` - FastAPI service.
- `pose_api/pipeline.py` - pose-analysis pipeline.
- `pose_api/worker.py` - Cloud Run Job worker.

Some `_agents/` files are historical working logs. Use them for product memory, not as the current operational architecture source of truth.
