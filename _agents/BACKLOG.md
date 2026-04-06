# Horsera — Backlog

A living list of known work-items that haven't been scheduled yet. Grouped by theme. Rossella pulls from here into Trello when ready.

**Format:**
- `[priority]` `[owner]` item — one-line description
- Priorities: P0 critical / P1 soon / P2 nice-to-have

---

## 🪨 Big rocks (the two things Rossella called out as next)

### Rock 1 — Video upload + analysis must feel seamless
**Current pain:** full-res iPhone video → Supabase upload → Cloud Run CPU worker → YOLOv8m pose at 1 fps. End-to-end takes minutes. This is the single biggest friction point in the core loop (JTBD Stage 3: "The Activation Moment"). If the first ride record feels slow, the rider doesn't come back.

**Target:** Rider uploads a video → sees score + skeleton within **<15 seconds** on wifi.

**Sub-items:**
- [P0] [Beau] Client-side re-encode before upload (trim + scale to 720p in browser via MediaRecorder or ffmpeg.wasm) — target 10× smaller files, near-instant upload
- [P0] [Beau+Matt] Progressive analysis (stream keypoint batches back via SSE/WebSocket as they're computed) so skeleton draws from second 1, not wait for minute 3
- [P1] [Beau+Matt] Two-pass pipeline: fast 5s preview pass (10 sampled frames → ~2s biomechanics scores) + background full pass enriching with keyframes
- [P1] [Matt] Tune GPU threshold — Matt's infra has the GPU worker wired; route larger videos there
- [P2] [Beau] Skip re-analysis on same-file-hash re-upload; reuse results
- [P2] [Beau] Pre-compress + chunked upload with resume support

### Rock 2 — Cadence must be a real equestrian expert
**Current pain:** keyword-matched mock. Can't reference rider's actual history, biometrics, or test movements. Not valuable to riders yet.

**Target:** A rider can ask "why is my lower leg unstable?" and get a Monty-caliber answer grounded in their last 5 rides' data, their level, and classical riding principles.

**Sub-items:**
- [P0] [Beau] Wire a real LLM call (Claude Haiku 4.5 for speed) replacing the keyword mock
- [P0] [Ross+Monty] Author Cadence system prompt — grounded in Monty's equestrian expertise, Training Scales, Horsera's architecture (RiderBiomechanics → RidingQuality → Tasks → Levels)
- [P0] [Beau+Ross] Rider context injection: last 5 rides with scores, current level, profile, most recent insight. Live per-message.
- [P1] [Ross+Monty] Structured output contract (observation → cause → drill → next step) so answers read like a coach, not a chatbot
- [P1] [Beau] Quick-prompts on ride detail + Progress page should hydrate the conversation with the EXACT ride/window context, not just open a blank drawer
- [P2] [Ross] Evaluation harness — 20 canonical rider questions + expected quality bar, run before each prompt change

---

## 🎨 UI/UX polish (queued from 2026-04-05 session, end)

- [P1] [Beau+Lauren] **In-place ride expansion** instead of routing to `/rides/:id`. Click a ride card → expands inline in the history list. Needs a refactor: RideDetailPage2 content → reusable component; overlay modal vs inline accordion vs bottom-sheet decision with Lauren.
- [x] ~~**Score chart hover/click** on Progress page — hover shows date + score, click navigates to ride~~ (done 2026-04-05)
- [P1] [Ross+Monty] **Per-level movement data model.** Journey currently shows Intro Test A's 9 movements for all levels. Should show each level's own movements (Training Level has different movement set, First Level different, etc). Need Monty to author movement lists per level × test. Until then Journey shows "Coming soon" for non-Intro-A tests.

## 🎨 UI/UX polish (earlier queue)

- [P1] [Beau] Investigate flash/old-screen during video load if still occurring after 2026-04-05 cleanup commit
- [P1] [Lauren+Beau] Annotated-fullscreen-with-skeleton toggle for video player (native FS currently doesn't carry the skeleton canvas)
- [P2] [Lauren+Beau] Riding Quality section currently uses slightly different typography from Position Scores — unify to a single shared card component

---

## 🧠 Intelligence / data

- [P1] [Beau] Real-time pose streaming during recording (not post-upload) — enables a "Capture ride" mode where analysis is ready the moment recording ends
- [P2] [Matt+Goran] Canter/trot/walk gait detection to improve level inference accuracy
- [P2] [Matt+Goran] Circle precision + geometry detection for test movement scoring
- [P2] [Beau] MoveNet → skeleton live wiring (replace hardcoded joint positions in RideTab.tsx)

---

## 🔄 Sync / auth (V1.5 blocker)

- [P1] [Beau+Ross] Cross-device sync decision — Firebase (extend Matt's Firestore) vs Supabase auth. Currently data is localStorage-per-device which blocks any multi-user testing.
- [P1] [Beau] Supabase/Firebase auth wiring with email magic link
- [P2] [Beau] Migrate existing localStorage data to cloud on first login

---

## 📦 Ops

- [P2] [Matt] Refactor pose_api so horsera.ai's `allUsers` block doesn't require manual invoker grants in terraform
- [P2] [Beau] Bundle splitting — main JS bundle is 700KB+ (Vite warning). Code-split Journey and Insights routes.
- [P2] [Beau] Pose API batch processor — add idempotent shell path that handles the `set -euo pipefail` + pipe-exit-code edge case I hit

---

## 📋 Known V1.5 items (from user-journey-jtbd.md)

- [P1] [Ross+Lauren+Beau] Onboarding placement flow (Cadence-led conversation, 5-7 questions) — currently no onboarding exists
- [P1] [Beau] Push notifications — basic ride reminder
- [P1] [Lauren+Beau] Mastery celebration moment when a milestone is mastered
- [P2] [Beau] Trainer feedback link (V1.5 link-based sharing, NOT full trainer portal)
