# Horsera — Decisions Log

A record of significant product, design, and architectural decisions — capturing not just *what* was decided but *why*. This is the institutional memory of Horsera's strategic thinking.

**When to add an entry:** Any decision that, if forgotten, could cause the team to reverse course or re-debate the same ground. Not every small change — only decisions with meaningful rationale.

---

## Product & Strategy Decisions

### 2026-03-11 — AI companion named Cadence, not Genie
**Decision:** The AI advisor is called Cadence.
**Why:** "Genie" felt whimsical and lamp-rubbing — wrong tone for a premium product. Cadence is a dressage term for rhythmic, expressive movement that emerges when horse and rider are truly in harmony. It implies helping riders find their rhythm. Sounds elegant when spoken: "Ask Cadence."
**Described as:** "your intelligent riding advisor"

### 2026-03-11 — Cadence is a floating FAB, not a bottom nav tab
**Decision:** Cadence lives as a persistent floating button, not a 5th tab in the bottom nav.
**Why:** A dedicated tab treats AI as a destination — undermines the "ambient intelligence" principle. Cadence should be reachable from any screen with awareness of current context. This also keeps the nav clean at 4 tabs.

### 2026-03-11 — Learning content embedded in Journey, not a separate tab
**Decision:** Learning content (drills, exercises) lives inside Journey at the milestone level, not as a standalone section.
**Why:** Keeps navigation clean. Reinforces that learning is always in service of a specific developmental goal, not a library to browse. May evolve to a separate tab in V2 if the content library grows significantly.

### 2026-03-11 — "Ride the Test" / "Judge's Eye" is V2, not MVP
**Decision:** The mock test evaluation feature is deferred to V2.
**Why:** Requires movement pattern recognition on top of the V1 biomechanics foundation (video processing, pose detection, metric extraction). Must be built on a stable V1. Architecture must support it from day one — the ride type structure, test-level data model, and readiness signal framework need to accommodate it.

### 2026-03-11 — Inline styles throughout (not Tailwind classes)
**Decision:** MVP uses inline styles for all custom design tokens, not Tailwind utility classes.
**Why:** Tailwind's arbitrary value syntax is available but limited without a compiler. Inline styles give precise control over the design system tokens and are more predictable in the Lovable environment. Migrate to Tailwind or CSS variables post-MVP.

### 2026-03-11 — Single horse profile for MVP
**Decision:** MVP supports one horse per rider.
**Why:** Multi-horse profiles add significant complexity (data model, UI, relationship management). Not needed to validate core value. Full horse persona is V3.

---

## Design Decisions

### 2026-03-11 — Milestone progress ring as Home screen hero
**Decision:** Home screen leads with a large SVG progress ring, not text cards.
**Why:** First version was text-heavy with no dominant visual. Premium references (Oura, Apple Health) lead with a single visual that communicates status before any text is read. The ring creates the "Oura effect" — rider understands where they are before reading a word.

### 2026-03-11 — 4-tab navigation (not 5)
**Decision:** Bottom nav has exactly 4 tabs: Home, Journey, Rides, Insights.
**Why:** 5 tabs (including Cadence) felt cluttered and treated AI as a section to fill. 4 is more elegant and keeps the nav anchored purely to the rider's development journey.

---

## Technical Decisions

### 2026-03-11 — React + TypeScript + Vite (Lovable-compatible stack)
**Decision:** MVP built on React, TypeScript, Vite, Tailwind.
**Why:** Lovable's native stack. Ensures compatibility with the visual preview environment. Standard modern React tooling.

### 2026-03-11 — mock.ts as single data source
**Decision:** All MVP data lives in src/data/mock.ts with co-located TypeScript interfaces.
**Why:** Simplest approach for MVP. Single source of truth prevents data drift across components. Replace with real data layer (Supabase or similar) post-MVP.

---

## Autonomous Session — 2026-03-11 (Evening)

### 2026-03-11 — Journey shows Performance Tasks, not Biomechanics
**Decision:** USDF milestone names and primary identifiers are now Performance Tasks (e.g. "20m Trot Circle", "Free Walk on Long Rein") — not biomechanics labels (e.g. "Lower Leg Stability").
**Why:** Rossella identified this correctly. Biomechanics improve continuously across all levels — using them as milestone names makes levels look identical ("Lower Leg Stability" is relevant at every level). Performance tasks change clearly level-to-level and directly answer "what can I do?" rather than "how is my body moving?" Biomechanics remain visible in the detail expand panel as the supporting "what you can control" layer. This aligns with the four-layer model: biomechanics → riding quality → tasks → levels. Journey shows tasks; Insights shows biomechanics.
**Alternatives considered:** Showing riding quality names (Rhythm, Contact, Balance) — rejected for same reason as biomechanics: these span all levels and don't clearly differentiate.

### 2026-03-11 — Hero image: rider from behind, golden sunset
**Decision:** Used `shutterstock_2316206717.jpg` (rider from behind, warm golden sunset) as the Home screen hero image.
**Why:** More aspirational and forward-looking than the silhouette option. The rider-from-behind composition echoes the "your journey ahead" tone of the Good Morning greeting. Warm amber tones match the Parchment/Cognac palette. The silhouette image (shutterstock_534549745.jpg) is preserved and may suit a Journey/competition context in V2.
**Text colors updated:** All hero text shifted to white/parchment with text-shadow for readability over the photo. Dark gradient overlay covers the bottom half of the image.

### 2026-03-11 — Cadence visual identity: gradient card + FAB glow
**Decision:** CadenceInsightCard redesigned with a blue-tinted gradient background, inner glow, and glowing orb logo. CadenceFAB redesigned with a `cadence-glow` animation on the button itself (not just the orb) — a visible Champagne halo pulse at 3.2s cycle. Halo ring added as a separate animated div inside the button.
**Why:** The original flat card read as a regular data card. The new design signals AI through gradient light and ambient glow — consistent with how premium AI interfaces signal intelligence without being loud. "Cadence speaks in whispers, but you know it's there."
**Alternatives rejected:** Bright glowing border (too loud), animated text (too distracting), badge/icon changes (insufficient).

### 2026-03-11 — Level drill-down: inline expand, not new route
**Decision:** Tapping a level node in the USDF path opens an inline expand panel below the path — not a new page or modal.
**Why:** The Journey screen is already the appropriate context for level information. A new route adds navigation complexity and breaks the spatial relationship between level context and skill rings. Inline expand keeps the rider oriented. Future V2 could promote this to a dedicated level detail page once there's richer content to justify it.

### 2026-03-11 — Video analysis: mock pose estimation SVG + Layer 1→2 insights
**Decision:** For rides with video uploaded, replaced the placeholder "Video uploaded" box with: (1) an SVG pose estimation mockup showing rider skeleton with color-coded joints (white=good, yellow=caution, red=needs work), and (2) four biomechanics-linked insights explicitly connecting Layer 1 (metric) to Layer 2 (riding quality effect).
**Why:** Rossella shared Ridesum as a reference. Our version must go further — not just showing joint angles but connecting the biomechanics finding to its riding quality impact ("lower leg drift → reduced rhythm score by ~9%"). This is the core Horsera differentiator: making the causal chain visible. Mock data but realistic and specific.

---

## Pose Pipeline Session — 2026-03-11 (Evening, continued)

### 2026-03-11 — Pose model: MoveNet Thunder (TensorFlow.js)
**Decision:** Use MoveNet Thunder via `@tensorflow-models/pose-detection` for the MVP pose estimation pipeline.
**Why:** The only model that satisfies all three constraints simultaneously: (1) runs entirely in the browser via WebGL — zero infrastructure cost and zero per-video cost; (2) Apache 2.0 license — commercial use fully permitted; (3) best-in-class accuracy among browser-deployable models at ~72.4 COCO AP, trained on fitness/yoga video that includes lateral and non-standing poses directly applicable to the equestrian use case. The 17 COCO keypoints cover all metrics Horsera needs.
**Alternatives rejected:** OpenPose (non-commercial license, server-only); YOLO-Pose (AGPL-3.0 — would require open-sourcing the commercial product); ViTPose (Apache 2.0 but server-only, adds cost and infrastructure complexity for MVP); MediaPipe (Apache 2.0, 33 keypoints including heel — slightly better for lower leg analysis, but less stable npm API for MVP).
**Upgrade path:** If ankle/heel visibility proves problematic (occluded by horse's barrel), upgrade to ViTPose + a Python backend (Modal/RunPod serverless GPU) at ~$0.20–0.50/video. Not needed for MVP.

### 2026-03-11 — Video pipeline: browser-side processing, sampled frames
**Decision:** Process video entirely in the browser using the Web main thread (no Web Worker for MVP). Sample every 5 seconds of video (not every frame), capped at 600 frames.
**Why:** Sampling at 5s intervals gives sufficient data for stability metrics (standard deviation of position over time) without requiring real-time frame rates. Biomechanics stability metrics only need ~50–200 data points to be statistically reliable. A 30-min video produces ~360 samples; a 60-min video produces ~720 (capped at 600). At MoveNet Thunder's ~60FPS browser speed, this processes in 4–10 minutes on a modern device — acceptable for a post-ride review workflow. Main thread for MVP; upgrade to Web Worker if UI jank is reported by Rossella.
**Alternatives considered:** Real-time video analysis (too slow for full rides), cloud processing (adds cost and complexity), per-frame sampling (unnecessary data, slow).

### 2026-03-11 — Biomechanics metrics: relative position stability
**Decision:** All six biomechanics metrics are computed as relative-position stability scores rather than absolute position measurements.
**Why:** Camera position varies between rides (phone mounted at different angles/distances). Absolute keypoint positions are meaningless across rides. Relative positions (ankle relative to hip midpoint, wrist relative to shoulder) remove camera drift and isolate genuine rider movement. The resulting scores (0–1) map to the existing BiometricsSnapshot schema without changes to the data model.
**Key thresholds:** lowerLeg — maxBad stdev = 8% frame width; rein — 6%; symmetry — 8%; core — 8° angle variance; alignment — 15° mean lean; pelvis — 0.15 normalized bounce.

### 2026-03-12 — Body diagram: "The Rider Map" (Lauren)
**Decision:** Two-column layout — SVG rider diagram on the left, metric score list on the right. Rider drawn as thick rounded limb segments (pill shapes via round strokeLinecap + thick stroke), not a stick figure or filled silhouette. Horse barrel visible at bottom for equestrian context. Score % labels inline in DM Mono. Parchment warm background.
**Why:** Ridesum uses a dark, clinical silhouette with colored arcs. Horsera must feel warm, editorial, premium — the opposite of a medical device. Thick pill limbs suggest body mass (anatomically closer to real riding) while remaining clean. The horse barrel at the bottom is a subtle but important equestrian identity marker — no other sport has this.
**Color mapping:** Torso = Core Stability, Arms = Rein Steadiness/Symmetry, Legs = Lower Leg Stability, Hips = Pelvis Stability, Shoulders/Head = Upper Body Alignment. Every color on the diagram maps to a real, computable metric.
**Direction B (deferred):** Stability trace overlay — showing the path a joint traced over the entire ride. More analytically powerful but more abstract. Target for Insights screen post-MVP.

### 2026-03-12 — Riding quality: USDF Scales of Training order
**Decision:** Riding quality panel shows 6 Layer 2 scores in USDF order: Rhythm → Relaxation → Contact → Impulsion → Straightness → Balance.
**Why:** USDF Scales are the canonical framework all dressage judges use. Presenting quality scores in this order gives the rider an immediate connection to the competition context. It also teaches the scales — a rider seeing this panel repeatedly learns the hierarchy.
**Algorithm:** Each quality is a weighted sum of its primary and secondary biomechanics drivers. This makes the four-layer model visible and actionable: "improve your Lower Leg Stability → improves Rhythm."

### 2026-03-12 — Skeleton overlay confidence threshold: 0.12
**Decision:** Show skeleton connections when both endpoint keypoints have confidence ≥ 0.12 (down from 0.30). Confidence below 0.35 renders at 55% opacity.
**Why:** 0.30 was too restrictive for equestrian video — lower body landmarks are frequently partially occluded by the horse's barrel. At 0.12 with opacity degradation, the rider still sees the full skeleton shape even when some joints are uncertain, while the transparency communicates the uncertainty. Hiding uncertain joints entirely (as before) produced "just a few dots" on the video frame.

### 2026-03-11 — Visualization: skeleton overlay (Direction A)
**Decision:** Joints colored by their corresponding biomechanics score category: green ≥ 0.80, champagne 0.60–0.79, red < 0.60. Overlay drawn as SVG over the real video thumbnail (base64 JPEG extracted at ~20% through the ride).
**Why:** Rossella shared Ridesum as the reference — she wants to see the rider's body annotated. The 20% timestamp captures the settled working phase of the ride, not the warm-up or cooldown. Color-coding joints by the metric they belong to (lower leg joints → lowerLegStability, wrist joints → reinSteadiness, etc.) creates a direct visual-to-data connection — a rider can immediately see "my left wrist is yellow, that's why my rein steadiness score is 71%."
**Direction B (deferred):** Stability trace — draw the trajectory of a joint (e.g. ankle) over the entire ride as a colored path on a silhouette, showing drift direction and magnitude. More analytically powerful but more abstract. Target for post-MVP Insights screen.

---

## Iteration Session — 2026-03-12

### 2026-03-12 — "Biomechanics" renamed to "Your Position" throughout
**Decision:** All references to "Biomechanics" in the UI, tab labels, and copy are replaced with "Your Position" (section headers) and "position score/s" (metric labels).
**Why:** "Biomechanics" is a clinical, academic word. No equestrian trainer says it in a lesson. They say "your position," "work on your position," "your position affects the horse." The rename makes the app feel warm and trainer-like rather than medical. It also aligns with how USDF and Pony Club actually teach — position is the foundational vocabulary.
**Alternatives considered:** "Your Seat" (too narrow — implies just sitting, not the full picture), "Body Scores" (still clinical), "Position Check" (sounds like a checklist, not a coach).

### 2026-03-12 — Quality tab renamed "The Scales"
**Decision:** The third tab in the ride analysis view is named "The Scales" (previously "Quality").
**Why:** "The Scales of Training" is the canonical USDF framework that all dressage judges use to evaluate riding quality. Every USDF-certified trainer and serious dressage rider knows this term. Naming the tab "The Scales" signals that Horsera understands dressage at a deep level — it's insider language that rewards knowledgeable riders and teaches newer riders something meaningful every time they see it. "Quality" was flat and generic.
**Alternatives considered:** "Riding Quality" (safer, more explanatory — but less distinctive), "Quality of Aids" (too specific to one dimension), "Classical Scores" (elegant but slightly obscure).

### 2026-03-12 — Live in-video feedback: Option B (Coach callouts only)
**Decision:** During video playback, nothing overlays during normal riding. When a significant position change is detected, a floating coach card appears for ~3 seconds then fades. No persistent HUD.
**Why:** On a 430px mobile screen, a live dashboard of updating scores (Option A) competes directly with the video — the rider watches the numbers instead of their riding. Option C's ambient HUD has the same problem at small scale. Option B delivers the highest emotional impact: silence most of the time, then a specific card drops in when something real happens. That's what a great trainer does in a lesson. "Your leg slipped there" is more useful than a constant dashboard. High signal, zero noise.
**Threshold:** A coach callout fires when any derived quality score shifts by ≥ 15 points (absolute) sustained across ≥ 3 consecutive frames (~15 seconds of video at 5s sampling), OR a single-frame spike of ≥ 25 points. Pre-computed at analysis time, stored as a timed events list on the result.
**Alternatives rejected:** Option A (all scores live) — cluttered, competes with video. Option C (hybrid HUD + callouts) — best of both in theory but adds a persistent layer that still competes at small screen size.
**Status:** Deferred to Sprint B.

### 2026-03-12 — Fourth tab: "Your Plan"
**Decision:** A fourth tab is added to the ride analysis view, labeled "Your Plan." Tab arc: Movement → Your Position → The Scales → Your Plan.
**Why:** The corrective guidance (exercises, training suggestions) needs a home. Currently there is no path from "here's what's wrong" to "here's what to do about it." "Your Plan" closes the development loop — the core Horsera promise. The tab is where Cadence coaching advice also lives, making the AI layer visible and actionable rather than ambient-only. The tab name uses "Your" to maintain the personal, second-person voice throughout the app.
**Status:** Deferred to Sprint B. Requires exercise content to be authored in mock.ts first.

### 2026-03-12 — Rides list: session card design
**Decision:** Each session card shows: (1) overall position score as a small ring, (2) "↑ Most improved" chip showing the metric with biggest positive delta vs. previous session, (3) "⚑ Focus area" chip showing the lowest-scoring metric.
**Why:** After a ride, a rider asks three questions: "Was it a good ride overall?" (→ ring), "What was the highlight?" (→ most improved), and "What do I work on next?" (→ focus area). This design answers all three in a compact, scannable card. Replaces unlabeled chips that currently give no context.
**Status:** Deferred to Sprint B.

### 2026-03-12 — Video hero on Rides list
**Decision:** The most recent analyzed ride's 6-second highlight clip autoplays (muted, looped) at the top of the Rides screen. IntersectionObserver pauses it when scrolled offscreen.
**Why:** The video feature is now central to Horsera's value proposition. Leading the Rides screen with "Horsera sees your riding" — before the rider even taps a card — is a powerful first-impression moment. One muted autoplay video at the top of a list is a standard mobile pattern (Instagram Stories, TikTok) that users understand intuitively.
**Status:** Deferred to Sprint B.

### 2026-03-12 — Homepage: most recent session's overall position score as hero
**Decision:** The Home screen hero number is the overall position score from the most recent session. Below it: the top 1–2 insights from that session. The milestone progress ring moves to a secondary position.
**Why:** The first thing a rider opens an app to see is "how am I doing?" — not trend charts or navigation options. The position score answers that immediately. The milestone ring is still important context but it's a slower-moving metric (changes over weeks) whereas position scores change ride-to-ride.
**Status:** Deferred to Sprint B.

### 2026-03-12 — Training Level skill → position score mapping
**Decision:** The following position metrics are the primary and secondary drivers for each Training Level performance task:
- 20m Trot Circle: Lower Leg Stability (primary), Core Stability (secondary)
- Free Walk on Long Rein: Rein Steadiness (primary), Pelvis Stability (secondary)
- Working Canter Transition: Core Stability (primary), Lower Leg Stability (secondary)
- Halt & Salute: Upper Body Alignment (primary), Rein Symmetry (secondary)
- Walk–Trot Transitions: Core Stability (primary), Rein Steadiness (secondary)
**Why:** Maps the four-layer model visibly in the Journey screen — riders see the direct connection between their position scores and their progression tasks. Also grounds the metric list in real equestrian pedagogy: USDF Training Level requirements explicitly depend on these foundational skills.
**Status:** Documented for Sprint B implementation in JourneyPage.

---

## Session — 2026-03-13

### 2026-03-13 — Ride types renamed: Lesson / Practice / Ride Out
**Decision:** The three ride types are now: Lesson (with a trainer), Practice (targeted milestone work, milestone optional), Ride Out (hack/trail/free schooling). "Training" and "Hack" removed.
**Why:** "Training" was ambiguous (all rides are training). "Hack" is UK-specific slang not universal across disciplines. "Practice" feels active and developmental. "Ride Out" is evocative — it's what equestrians actually say. Milestone selection in Practice is now optional with a "I'll see what comes up" default — removing friction for spontaneous sessions.

### 2026-03-13 — Overall Score renamed to Development Readiness
**Decision:** The aggregate score on the Insights screen is now called "Development Readiness" with a sub-label: "How ready you are to progress to the next milestone."
**Why:** "Score" implies a grade. Riders at 73% feel like they're failing. "Development Readiness" reframes the number as forward-looking: "I'm 73% ready to progress." Same number, completely different emotional response. Also more honest about what the metric actually represents.

### 2026-03-13 — Record Ride promoted to center nav
**Decision:** A raised Cognac circle button at the center of the bottom nav triggers the Record Ride flow. Nav becomes: Home | Journey | [+ Record] | Rides | Insights (5 total).
**Why:** The most valuable action in Horsera is recording a ride — every other insight depends on it. Burying it in the Rides screen meant it competed visually with the ride list. A center raised button (the iOS/Android standard for primary actions) makes the intent clear: "this is what you should be doing after every ride."

### 2026-03-13 — Cadence icon redesigned: waveform SVG replaces orb/pupil
**Decision:** The Cadence FAB icon is now a 6-bar audio waveform (ascending + descending bars) in Champagne gold. The orb-with-pupil was removed.
**Why:** The orb design was misread as a vinyl record or a camera lens — neither is appropriate for an AI advisor. A waveform communicates "listening" and "audio/voice" — the two things Cadence does. It's also distinctive: no other equestrian app has a waveform button. The breathe animation now pulses the waveform in and out, reinforcing the "alive and listening" feeling.

### 2026-03-13 — Trainer feedback: V1.5 = link-based, V2 = full portal
**Decision:** For V1.5, trainer feedback uses a shareable link generated per ride. Trainer opens the link in any browser, sees the ride, submits text feedback. No trainer account required. Full trainer portal (proactive access, own account, multi-rider view) = V2.
**Why:** Building a full trainer portal in MVP requires designing and implementing a second persona's entire app experience. The link-based approach delivers 80% of the value (trainer feedback in the rider's record) at 10% of the cost. Validates trainer engagement before investing in a full portal. Privacy: the shareable link has a short expiry and is revocable.

### 2026-03-13 — Cadence AI: connect real Claude API (haiku model)
**Decision:** Replace keyword-matching mock with a real Claude API integration using claude-haiku-3 with streaming. System prompt establishes Cadence's personality + rider context. Per-user daily limit of 20 messages as a cost guardrail.
**Why:** Cost at current scale is negligible (~$4-6/month at 100 DAU). Continuing to use keyword matching creates a false impression of AI capability and risks Rossella sharing the app publicly before it actually works. The real API with a strong system prompt will immediately feel premium. Haiku is fast and accurate for equestrian Q&A.

---

*When adding a new decision, use this format:*

*### YYYY-MM-DD — Decision title*
*__Decision:__ What was decided*
*__Why:__ The reasoning — as if explaining to someone joining the team 6 months later*
*__Alternatives considered:__ (optional) What else was considered and why it was rejected*
