# Horsera — Daily Plan

This file is updated by Ross at the start of every session with a proposed plan for the day. Work does not begin until Rossella has reviewed and approved the plan.

**Workflow:**
1. Ross reads MEMORY.md, CHANGELOG.md, and WEEKLY.md to understand current state
2. Ross proposes today's plan in this file
3. Rossella reviews, adjusts if needed, and approves
4. Team begins work
5. At end of session, Ross marks items complete and updates MEMORY.md

---

## Daily Plan — 2026-03-12 (Iteration Sprint)

**Proposed by Ross** — reviewed Ridesum screenshots, read full prompt. Plan below.

---

### Where we are

The pose pipeline is fully wired. Real video → MoveNet → 6 biomechanics scores → skeleton overlay on best-moment clip. Three visualization tabs: Movement, Body Map, Quality. Last build: ✅ clean at 421KB. Not yet pushed to GitHub (Lovable is still on older build).

Rossella has uploaded real riding videos. This session focuses on making the visualization good enough to demo and meaningful enough to learn from.

---

### Team decisions (Ross + Lauren, made before any code)

These are documented here for approval, then written into DECISIONS.md once Rossella confirms.

---

**Decision 1 — Live in-video feedback: Option B (Coach callouts only)**

Ross and Lauren both recommend **Option B**. Reason: on a 430px mobile screen, a live HUD of 6 updating scores (Option A) competes with the video — the rider watches the numbers instead of their riding. Option C's ambient HUD has the same problem at small scale. Option B delivers the most emotional impact: silence most of the time, then a card drops in when something real happens. That's what a great coach does. "Your leg slipped there" is more useful than a constant dashboard.

Implementation: at analysis time, scan `allFrames` and detect metric transitions. Pre-bake a list of timed events — stored on the result object, rendered as CSS-animated cards over the video. No real-time calculation during playback.

**Threshold (Beau): a coach callout fires when any quality score (derived from biometrics) shifts by ≥ 15 points (absolute) sustained across ≥ 3 consecutive frames (~15 seconds of video). Single-frame spikes of ≥ 25 points also fire — these catch falls, sudden changes.**

Deferred to Sprint B.

---

**Decision 2 — Quality tab renamed: "The Scales"**

Chosen name: **"The Scales"** — the most important term in all of dressage. Every USDF-certified trainer uses it. When Rossella sees "The Scales" she immediately knows this tab is about the Scales of Training (Rhythm → Relaxation → Contact → Impulsion → Straightness → Collection). This is insider language that signals: Horsera knows dressage. A casual rider might not know it at first, but they will — and it teaches them something meaningful every time they see it.

Tabs will read: **Movement | Your Position | The Scales** (Body Map is now "Your Position" — see Decision 5 below).

---

**Decision 3 — Fourth tab: "Your Plan"**

Yes, add a fourth tab. The corrective guidance (exercises, drills, training suggestions) that currently has no home belongs here. The tab arc should be: **Movement** (what happened) → **Your Position** (where in your body) → **The Scales** (how it affected your riding) → **Your Plan** (what to do about it). This closes the full loop — the core Horsera promise. Labeled "Your Plan." Deferred to Sprint B (requires exercise content to be authored in mock.ts first).

---

**Decision 4 — Rides list: session card design**

What a rider asks after a session: *"Was it a good ride? What was the highlight? What should I work on next?"* We answer with three pieces of information in a compact card:

1. **Overall position score** — a single %-ring (overall average of the 6 position metrics)
2. **↑ Most improved** — the metric with the biggest positive delta vs. previous session
3. **⚑ Focus area** — the lowest-scoring metric (with label, not just a number)

This replaces the current unlabeled chips. Deferred to Sprint B.

**Video hero on Rides list: Yes, show the most recent analyzed ride's highlight clip (autoplay, muted) at the top of the Rides screen.** Beau's verdict: feasible — same VideoClipPlayer component, one instance, IntersectionObserver to pause when scrolled off screen. Deferred to Sprint B.

---

**Decision 5 — "Biomechanics" renamed throughout: "Your Position"**

Chosen term: **"Your Position"** — exactly what every trainer says. "Work on your position." "Your position affects the horse." It is warm, familiar, non-clinical, and honest about what we're measuring. The full phrase is "position scores" for metric labels, and "Your Position" as the section/tab header. Beau to do global find-replace today.

---

**Decision 6 — Homepage: what to surface**

The first thing a rider opens an app to see is: *"How am I doing?"* — not trends, not a dashboard. Answer: **surface the most recent session's overall position score as the hero number, with one top insight below it.** The existing progress ring (milestone progress) stays as the secondary visual. The Cadence insight card moves to a secondary position — it's valuable but it's not the answer to "how am I doing?"

Full homepage redesign deferred to Sprint B. Today: document decision, implement in next session.

---

**Decision 7 — Skill → score mapping for Training Level**

Which position metrics support which Training Level performance tasks:

| Performance Task | Primary Position Metric | Secondary Metric |
|---|---|---|
| 20m Trot Circle | Lower Leg Stability | Core Stability |
| Free Walk on Long Rein | Rein Steadiness | Pelvis Stability |
| Working Canter Transition | Core Stability | Lower Leg Stability |
| Halt & Salute | Upper Body Alignment | Rein Symmetry |
| Walk–Trot Transitions | Core Stability | Rein Steadiness |

Journey skills → scores connection: deferred to Sprint B. Mapping documented here as reference data.

---

### Beau's feasibility flags (answered before planning)

**Item 2 — "Skeleton painted at fixed position" bug:**
The skeleton does track the rider — keypoints come from MoveNet running on the actual video frames. The bug is an **aspect ratio mismatch**: we process on a 256×256 square canvas, but the video displays at its native aspect ratio (usually 16:9). Since we squash the video to square during processing, a keypoint at (0.78, 0.50) maps to the squashed coordinates — not the native display position. Fix: at extraction time, set `canvas.height = Math.round(256 * video.videoHeight / video.videoWidth)`. Cost: ~2 hours including testing. Verdict: ✅ fully viable in-browser, no server needed.

**Item 3 — Full video skeleton during full-ride mode:**
The existing `onTimeUpdate` + `allFrames` nearest-frame lookup already handles this — the same mechanism that drives the 6s clip drives full-video playback. Keypoints are sampled every 5 seconds, so the skeleton will "step" between positions rather than smoothly interpolating — this is noticeable but acceptable at MVP. Smooth interpolation is a V2 upgrade. Cost: 0 extra hours for full-video mode (already implemented). Verdict: ✅ works out of the box.

**Item 7b — Autoplay video hero in Rides list:**
One muted autoplay video at the top of a list is fine. The risk is multiple videos autoplaying simultaneously if a rider has many analyzed sessions — fixed by only autoplaying the most recent one. Use IntersectionObserver to pause when scrolled offscreen (best practice). Verdict: ✅ viable, ~2 hours including scroll handling.

**Item 4 — Body map arc gauges (Ridesum parity):**
Important caveat: Ridesum shows **absolute joint angles in degrees** ("You: 12°, Ideal: 0-50°"). Horsera currently computes **stability scores** (how consistent the position was, 0-100%), not absolute angles. We CAN compute angles from stored keypoints using `atan2()` — this is new math we haven't built yet. However, stability scores are arguably more meaningful for a session-long analysis: "your lower leg was 78% stable" is a better ride summary than "your average lower leg angle was 12°." Recommendation: **today's body map redesign uses stability scores displayed as arc gauges** (matching Ridesum's visual style with our own data model). Absolute angle computation is a Sprint B enhancement for the "Part by Part" carousel, which also requires multi-session data we don't have in MVP anyway.

---

### Today's proposed tasks (Sprint A)

**Today's focus:** Fix the critical skeleton bug, add full video playback, and polish the three visible tabs to feel demo-ready. Document all decisions. Quick wins first.

| # | Owner | Task | Why | Est. |
|---|---|---|---|---|
| 1 | Ross | Write all 6 decisions to DECISIONS.md | Before any code | 20 min |
| 2 | Beau | Quick wins batch: update horse name to Allegra throughout mock.ts; fix upload copy "No upload" → "Upload your video"; add Horsera logo to favicon + app header | Easy wins, real polish | 45 min |
| 3 | Beau | Fix skeleton aspect ratio: canvas.height = 256 × (videoHeight/videoWidth) in useVideoAnalysis.ts; set SVG preserveAspectRatio="none" in VideoClipPlayer; store videoAspectRatio in result | Skeleton must track rider | 2 hrs |
| 4 | Beau | Video player: "Watch full ride" mode — tap toggles from 6s highlight loop to full video with standard controls (play/pause, scrub, 0.5×/1×/2× speed) | User needs to watch full session | 2 hrs |
| 5 | Beau | "Your Position" rename — global find-replace of "Biomechanics" / "biomechanics" → "Your Position" / "position" throughout src/ and agent docs | Decision 5 | 30 min |
| 6 | Lauren + Beau | Body map redesign — rename tab to "Your Position"; arc gauge at each body segment (Horsera palette); issue summary with coaching cues; unmounted/mounted exercise accordion | Ridesum parity in Horsera style | 3 hrs |
| 7 | Lauren + Beau | "The Scales" tab — rename from "Quality"; make rows expandable: description + driver metric + 2–3 training suggestions + trend indicator | Decision 2; makes scores readable | 1.5 hrs |
| 8 | Lauren + Beau | Cadence orb: organic breathing animation (ease-in-out cubic, scale + glow, not mechanical); add "Tap to talk" label or subtle microphone ripple | Decision — Cadence must feel alive | 1 hr |

**Total estimated: ~11 hours.** This is a full team day. If time runs short, items 6 and 7 (body map + Scales tab) are lower priority than items 3 and 4 (skeleton fix + full video mode). Rossella: tell us if you want to cut anything.

---

### Sprint B (next session — not today)

- Live in-video coach callouts (Option B, threshold defined above)
- Rides list redesign: session card with overall ring + most improved + focus area
- Video hero at top of Rides list
- Journey: skill detail view with position metric scores
- Homepage: restructure to surface most recent session's overall score as hero
- "Your Plan" 4th tab with exercises (requires exercise content in mock.ts)
- Part by Part history carousel (requires multi-session data architecture first)
- Push to GitHub (Lovable sync)

---

### Not doing today

- **Real data replacement** — Rossella mentions replacing mock data with real video data. This requires running the actual pipeline on her videos and saving the output. We can do this during today's session as a manual test (upload real video → save the BiometricsSnapshot to mock.ts) but the automated pipeline is V2 work. For now: horse name is Allegra (updating today), session data stays as calibrated mock numbers until a real video is processed.
- **Part by Part history carousel** — requires multi-session position data that doesn't exist yet (single session in MVP). Build after multi-session architecture.
- **Left/Back/Right view tabs on body map** — requires video filmed from three angles. Single-angle MVP only.
- **"Improve/Train" tab (Your Plan)** — deferred to Sprint B; exercise content needs authoring first.
- **Journey: skills linked to scores** — deferred; mapping is documented above in Decision 7, build Sprint B.

---

### Questions for Rossella before we start

1. **Logo file location confirmed** — I can see `horsera-logo-.png` in the attached screenshots. I'll source it from `/Users/ella/Documents/Horsera/horsera-logo-.png` for the favicon. Do you have an SVG version? SVG will be crisper in the header. If not, PNG is fine.

2. **"Your Position" vs. "Position Scores"** — I'm recommending "Your Position" as the section header throughout. The tab on the Body Map screen would read "Your Position." Do you like this, or prefer another term? (Options: "Your Seat," "Position Check," "Body Scores")

3. **Scope confirmation** — This is 11 hours of work. Do you want us to go full day on all 8 tasks, or prioritize items 1–5 (decisions, quick wins, skeleton fix, full video mode, rename) and treat 6–8 as stretch goals?

4. **Real video processing** — If you have time today, upload one of your Allegra videos while the team works. Real numbers will replace the mock biometrics for that ride. Which video should we use as the reference ride?

---

### Definition of done for today

By end of session:
- All 6 decisions documented in DECISIONS.md
- Horse is Allegra everywhere in the app
- Skeleton actually tracks Rossella's body in the video (aspect ratio fixed)
- User can watch the full session, not just the 6s highlight
- App says "Upload your video" not "No upload"
- Every instance of "Biomechanics" is gone — replaced with "Your Position"

Stretch goals (if time allows):
- Body map has arc gauges and looks closer to Ridesum reference
- "The Scales" tab is named and expandable
- Cadence orb feels alive and conversational

— Ross, for the team

---

## Session Summary — 2026-03-12 (Video Clip Player — completed before this plan)

**Written by Beau.**

VideoClipPlayer is live. When a rider uploads and analyzes a video:
- The best biomechanics moment (15-second window, centered) auto-plays as a 6s muted loop
- A live SVG skeleton overlay tracks keypoints frame-by-frame using `onTimeUpdate`
- Play/pause button with Champagne styling
- "Best moment · 6s" + frame count badges
- If no video uploaded: unchanged mock skeleton + upload CTA

Build: ✅ 421KB main bundle. TF.js remains code-split (loads only on video upload).

---

## Session Summary — 2026-03-11 Late Evening (Autonomous — Pose Pipeline)

**Written by Ross for Rossella.**

Good morning. The pose estimation pipeline is built. Here is everything that was done and what to test first.

### What we built

**TASK 1 — Model selected ✅**
After evaluating MediaPipe, MoveNet, OpenPose, ViTPose, and YOLO-Pose, we chose **MoveNet Thunder** (Google/TF.js). The reasons: it runs entirely in your browser — no server, no upload, no cost per video. It's Apache 2.0 licensed (commercially fine). And it was explicitly trained on fitness/yoga video with lateral and seated poses, which is the closest training data to equestrian riding available. Full evaluation is in DECISIONS.md.

**TASK 2 & 3 — Video pipeline + metric calculations ✅**
Three new files:
- `src/lib/poseAnalysis.ts` — the math: converts keypoint positions to the 6 biomechanics scores (Lower Leg Stability, Rein Steadiness, Rein Symmetry, Core Stability, Upper Body Alignment, Pelvis Stability)
- `src/hooks/useVideoAnalysis.ts` — the engine: loads MoveNet, extracts one frame every 5 seconds from your video, runs pose detection on each, feeds keypoints to the metric calculations
- Each metric uses relative position (e.g. ankle relative to hip, not absolute screen position) so results are consistent regardless of where the phone is mounted

**TASK 4 — Visualization (Lauren's Direction A) ✅**
When real analysis completes, the RideDetail screen shows:
- Your actual video frame (captured at ~20% through the ride — the settled working phase)
- A skeleton drawn on that frame, with each joint colored: **green** = strong, **champagne** = developing, **red** = focus area
- The color comes directly from the computed metric — so if your lower leg score is 68%, your ankle joint appears champagne
- Four movement insights below the frame, now generated from real numbers

**TASK 5 — Wired to app ✅**
RideDetailPage now uses the real pipeline.

### What Ross proposes for the next session
1. Rossella tests with a real video — validate that keypoints detect correctly, scores feel right
2. Push everything to GitHub so Lovable is in sync

— Ross, for the team

---

## Plan Template (Ross uses this format each day)

```
## Daily Plan — YYYY-MM-DD

### Where we are
One paragraph summary of current state, based on MEMORY.md and CHANGELOG.md.

### Today's focus
One sentence: the single most important thing to accomplish today.

### Proposed tasks
1. [Agent] Task description — why this matters
2. [Agent] Task description — why this matters
3. [Agent] Task description — why this matters

### Not doing today (and why)
- Thing we're deliberately skipping and the reason

### Questions for Rossella before we start
- Any decisions or clarifications needed before work begins

### Definition of done for today
What does "a good day" look like? What will be different by end of session?
```

---

## Completed Plans Archive

*(Completed daily plans move here at end of session, newest first)*

### 2026-03-11 — First Working Session ✅
**Focus:** Resolve two-system disconnect, rebuild Journey as skill map, fix Home
**Completed:**
- ✅ Full onboarding: all agent files + all product docs read
- ✅ MEMORY.md updated with comprehensive Product Knowledge
- ✅ Full codebase assessment by all four agents
- ✅ 7 orphaned pages deleted (clean repo)
- ✅ mock.ts updated with discipline level schema + USDF_LEVELS + reaching ahead milestone
- ✅ JourneyPage rebuilt: level path + skill rings + reaching ahead + locked Ride the Test
- ✅ HomePage rebuilt: inline styles, mock.ts, atmospheric hero, correct routing
- ✅ Build clean ✅
**Notes:** Hero is CSS placeholder — real photo needed. Empty states still missing. Rossella to review screens.

### 2026-03-11 — Setup Session ✅
**Focus:** Get the development environment and agent team fully configured
**Completed:**
- ✅ Claude Code installed on Rossella's Mac
- ✅ MVP scaffold pushed to GitHub
- ✅ Agent team defined (Ross, Lauren, Beau, Quinn)
- ✅ _agents/ folder created with TEAM.md and SKILLS.md
- ✅ _product-docs/ populated with all strategy documents
- ✅ Memory system designed and initialized
**Notes:** First real working session complete.
