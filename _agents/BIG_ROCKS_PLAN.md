# Horsera — Two Big Rocks Plan

**Date:** 2026-04-05
**Authors:** Ross (PM), Lauren (Design), Beau (Dev), Monty (Equestrian expert), Quinn (QA), Daniel (CD)
**For:** Rossella's review + approval

---

## 🪨 Rock 1 — Video upload + analysis must feel seamless

### The problem
Full-res iPhone video → Supabase upload → Cloud Run CPU worker → YOLOv8m pose at 1 fps. End-to-end: minutes. This is Stage 3 of the JTBD map ("The Activation Moment"). If the first ride record feels slow, the rider doesn't come back.

**Target:** Upload → score + skeleton visible within **≤15 seconds** on wifi.

### Team perspectives

**Ross:** "This is the #1 problem to solve before we onboard anyone outside the team. Right now it feels like calling customer service; it should feel like sending a text."

**Lauren:** "Perceived wait matters more than actual wait. Oura shows a partial score as analysis runs. We need progressive reveal — skeleton drawing from second 3, not waiting for minute 3."

**Beau:** "Three technical paths, ranked by impact/effort:
1. **Client-side re-encode** (biggest single win): iPhone 4K HEVC → 720p H.264 in-browser via MediaRecorder API. 100-500MB → 3-8MB. Upload 30s → 3s.
2. **Two-pass pipeline**: fast preview (10 sampled frames → biomechanics scores in ~2s) + full pass in background.
3. **Progressive streaming**: worker streams keypoint batches via SSE. Skeleton renders from second 1."

**Monty:** "The fast-pass preview must either be accurate enough to stand alone, or clearly labeled 'preview'. If preview and final differ, riders lose trust. 10 smart-sampled frames (high pose-detection confidence) can give a reasonable biomechanics read."

**Quinn:** "Test matrix mandatory: iPhone 12-15, 4K/1080p/720p sources, wifi/LTE/5G. What happens when network drops mid-upload? Clear fallback path required."

### Recommended plan (4 weeks, sequenced)

| Week | Owner | Deliverable |
|------|-------|-------------|
| 1 | Beau | **Client-side re-encode** via MediaRecorder API. Upload 30s → 3s. |
| 2 | Beau + Matt | **Two-pass pipeline** — fast preview pass + full pass. Rider sees scores in ~5s. |
| 3 | Beau + Matt | **Progressive keypoint streaming** (SSE from worker → frontend). True second-1 skeleton draw. |
| 4 | Matt | **GPU threshold tuning** + resume-on-disconnect. Polish. |

### What Rossella needs to do
- **Week 1-2:** Nothing — pure code work.
- **Week 3:** Approve API contract change (Cloud Run response format). Matt will review.
- **Week 4:** Decide GPU burst budget (each GPU execution has a $ cost). Suggest $20/month cap for dev.

---

## 🪨 Rock 2 — Cadence must be a real equestrian expert

### The problem
Keyword-matched mock. Can't reference rider's actual history, biometrics, or test movements. Not valuable to riders yet.

**Target:** A rider asks "why is my lower leg unstable?" and gets a Monty-caliber answer grounded in their last 5 rides, their level, and classical riding principles.

### Team perspectives

**Ross:** "Cadence is the reason riders choose Horsera over a spreadsheet. Without real intelligence, we're a video uploader with a dashboard. Claude Haiku 4.5 is the right model — fast enough for conversational latency, smart enough for domain reasoning when properly prompted. The system prompt is the product."

**Lauren:** "The conversation must feel like talking to a trainer who already knows you. Tap 'Why is my lower leg at 0?' and Cadence should open with 'I've looked at your Jan 14 ride…' — pre-hydration, not a blank chat."

**Monty (most important input):** "Four things I want captured in the system prompt:
1. **Training Scales are a progression, not a list.** A rider struggling with Contact usually has unresolved issues in Relaxation. Cadence must understand causal chains.
2. **Compensation patterns are real and specific.** 'Your lower leg is at 40' isn't an answer. 'Your lower leg drift is pulling your seat forward, breaking your hand stillness at the contact point' is.
3. **Respect the rider's level.** A 'lengthening' cue means different things at Training vs Third Level. Cadence adapts vocabulary.
4. **Never replace the trainer.** Reinforce what the trainer said. Add context. Suggest asking the trainer. Never contradict."

**Beau:** "Stack:
- Anthropic SDK, streaming enabled for the drawer
- System prompt stored in `_agents/cadence-prompt.md` — Ross + Monty iterate without code changes
- Context object per message: last 5 rides (date, scores, metrics), profile, current level, most recent insight, current page/ride context
- Structured output default (observation → cause → drill → next step), conversational mode when rider asks open questions

2 days for working prototype. Week 2 for prompt iteration + eval harness."

**Quinn:** "20 canonical rider questions with expected-answer quality bars. Regression test before every prompt change."

**Daniel:** "Voice: warm, precise, never preachy. No 'Great question!' No exclamation points. When Cadence doesn't know, she says 'I don't have enough data from your last 5 rides to say that confidently' — not guesses."

### Recommended plan (2 weeks)

| Day | Owner | Deliverable |
|-----|-------|-------------|
| 1-2 | Beau | Wire Claude Haiku 4.5 into CadenceDrawer, streaming enabled. Replace mock. |
| 3-5 | Ross + Monty | Author `_agents/cadence-prompt.md`: Training Scales causality, compensation patterns, level-adaptive vocabulary, structured output, guardrails |
| 6-7 | Beau + Ross | Context hydration — last 5 rides + level + profile. Quick-prompts on ride detail pre-load THAT ride's context. |
| 8-10 | Quinn + Rossella | 20 canonical questions + quality bar. Manual eval before each prompt change. |
| Ongoing | Monty | Monthly review of Cadence conversation logs to catch drift. |

### What Rossella needs to do
- **Must:** Review + approve Monty's system prompt before going live. Your voice standard is the last filter.
- **Must:** Sign off on the 20 canonical questions (Quinn drafts, you approve).
- **Can delegate:** Code, API wiring, prompt iteration within Monty's framing.

---

## Execution sequence

**Recommended: start Rock 1 this week, Rock 2 next.**

Why: Rock 1 unblocks user testing (upload speed is the biggest friction). Rock 2 makes Horsera indispensable but is less valuable if riders can't upload quickly.

**Alternative: start both in parallel** if Beau has capacity — Rock 2 Day 1-2 is self-contained (mock → real LLM) and can slot alongside Rock 1 Week 1 (client-side re-encode).
