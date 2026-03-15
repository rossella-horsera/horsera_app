# Horsera — Technical Context

_Last updated: 2026-03-13_

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript, Vite, Tailwind CSS, shadcn/ui |
| AI/Pose | MoveNet Thunder (TensorFlow.js) |
| AI Advisor | OpenAI API (Cadence / Rides) |
| Backend/DB | Supabase (auth + persistence) |
| Deployment | PWA at horsera.app |
| Mobile | Capacitor configured for iOS (future App Store) |
| Build tool | Lovable |

## Repo

[https://github.com/rossella-horsera/horsera-x-computer](https://github.com/rossella-horsera/horsera-x-computer)

## Key Files

- `src/utils/poseAnalysis.ts` — Biomechanics metric computation (20+ metrics, formulas, ideal values, feedback ranges)
- MoveNet Thunder — pose estimation engine for equestrian biomechanics

## Biomechanics Metrics (from poseAnalysis.ts)

20+ metrics including:
- Lower leg stability
- Rein symmetry / hand movement
- Core stability
- Upper body alignment
- Rhythm, Balance (derived RidingQuality scores)

Metrics have defined ideal values and feedback ranges. RidingQuality scores are aggregates derived from raw biomechanics — best surfaced at ride summary level, not frame-by-frame.

## Architecture Decisions

- **PWA over native app for MVP** — No App Store review friction, instant updates, testers just need a link. Capacitor deferred until native features (push notifications, background processing) are needed.
- **MoveNet Thunder** — Chosen for real-time performance in browser; handles pose estimation without server round-trips
- **Supabase** — For auth and ride persistence; rides must accumulate over time for the longitudinal value proposition to work
- **OpenAI API** — Powers Cadence; needs rider context injected for longitudinal intelligence

## Current Status (as of 2026-03-13)

Active work in progress (tracked in other task window):
- Real-time biomechanics score overlay on video playback
- Cadence wired to real LLM with rider context
- Navigation simplification (video-first flow)
- Supabase persistence
- Cadence icon/UX redesign (warm, intelligent, alive — not a vinyl disc)

## Team

- Rossella (founder) — product + technical direction
- 2 engineer friends helping
- AI agents (this system) handling development tasks

## Deployment Notes

- Target: barn user testing before 2026-03-30
- PWA is sufficient for initial testing cohort
- App Store submission deferred post-MVP validation
