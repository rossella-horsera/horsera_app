# Horsera — Shared Team Memory

This file is the team's growing knowledge base. It is updated at the end of every session and compressed weekly to stay lean. All agents read this at the start of every session.

**Compression rule:** At the end of each week, condense older entries into a "Prior context" summary. Keep the last 7 days in full detail.

---

## Current State of the Product

**As of:** 2026-03-11 (late evening — pose pipeline session complete)

**What exists:**
- Full MVP scaffold in local repo (not yet pushed to GitHub — Lovable shows older version)
- 5 screens built: Home, Journey, Rides, RideDetail, Insights
- Layout components: AppShell (with CadenceContext), BottomNav, CadenceFAB (breathing orb), CadenceDrawer
- UI components: ProgressRing, MilestoneNode, CadenceInsightCard (AI glow redesign), VideoAnalysis (real pipeline)
- `src/context/CadenceContext.tsx` — openCadence() accessible from any page
- Mock data in src/data/mock.ts — two goals: USDF Training Level + Feel Confident on Trail Rides
- Hero: real photo (`public/hero.jpg`) — editorial sunset rider
- **NEW: `src/lib/poseAnalysis.ts`** — biomechanics metric computation from MoveNet keypoints
- **NEW: `src/hooks/useVideoAnalysis.ts`** — full video analysis hook (MoveNet Thunder, dynamic import)
- **NEW: `src/components/ui/VideoAnalysis.tsx`** — skeleton overlay visualization on real video thumbnail
- Build: ✅ clean at 409KB (main bundle); TF.js loads on demand only

**Video analysis UI (Issues 1–3 complete):**
- Tabs: Movement (insights) | Body Map (rider diagram) | Quality (USDF scales)
- Body Map ("The Rider Map"): warm Parchment background, thick pill-shaped limb segments, each segment colored by its metric score, horse barrel at bottom, inline score % labels
- Quality tab: 6 Layer 2 scores in USDF Scales of Training order, driven-by annotation connecting Layer 1 → Layer 2
- Skeleton overlay: confidence threshold 0.12 (was 0.30), dark outline for contrast, opacity indicates uncertainty
- `computeRidingQualities()` added to poseAnalysis.ts — derives Layer 2 from Layer 1

**Pose pipeline architecture (TASK 1–5 complete):**
- Model: MoveNet Thunder (TF.js, browser-side, Apache 2.0, $0/video)
- Sampling: every 5 seconds, max 600 frames
- Metrics: 6 biomechanics scores via relative-position stability (stdev calculations)
- Visualization: real video thumbnail + real SVG skeleton overlay, joints colored green/champagne/red by score
- Upgrade path: ViTPose (Python backend) if lower leg occlusion is a problem — logged in DECISIONS.md

**Key architecture decisions made this session:**
- Journey is a GOALS screen (not a levels screen) — supports multiple concurrent goals
- Journey milestones are named by PERFORMANCE TASKS, not biomechanics
- Biomechanics are shown as supporting context in milestone detail panels and tracked in Insights
- Level nodes in USDF path are tappable — show performance tasks for any level
- Pose model = MoveNet Thunder (in-browser, no backend needed)
- Video processing is client-side — no uploads, no cost per video

**What is not yet built:**
- Changes not committed/pushed to GitHub (Lovable won't reflect them until pushed)
- Empty states (no rides, new user) — still missing
- Error states
- Real authentication
- Real data layer (everything is mock)
- Video upload tested with real Rossella video (needs Google Drive download + manual test)
- Trainer feedback flow (placeholder only)
- Cadence real AI integration
- Issue 1 (Cadence visual identity broader concepts) — not yet presented

**Current focus:**
Pose pipeline is built and wired. Next session: test with a real video from Google Drive, validate metrics, then push to GitHub.

---

## Key Decisions Made

See DECISIONS.md for full decision log.

---

## Product Knowledge
*Distilled from _product-docs/ on 2026-03-11. Only re-read source docs when going deep on a specific topic.*

### The Core Promise
Horsera is "the first AI-powered rider development platform" — it turns everyday rides into structured, measurable, compounding progress. Market: 7M+ US riders, $50B US / $300B global equestrian industry. Rossella is founder — adult rider with AI/tech background, YC applicant.

### The Development Loop (north star for every decision)
```
Goals → Learn → Ride → Assess → Adjust → Achieve → (repeat)
```
Every product decision must serve this loop. If it doesn't, don't build it.

### The Four-Layer Architecture (the real data model)
```
RiderBiomechanics → RidingQuality → Tasks → Levels
```
- **RiderBiomechanics** — what the rider controls physically (levers)
- **RidingQuality** — what judges evaluate (dimensions)
- **Tasks** — observable skills to demonstrate (actions)
- **Levels** — discipline progression stages (milestones)

The causal chain: improving biomechanics improves riding quality, which enables task execution, which advances level readiness. Horsera makes this chain *visible*.

Evidence (video signals, rubric scores, trainer notes, ride history) is *raw input* — immutable. Assessments are *derived state* — computed from accumulated evidence, not single rides.

### Assessment Vocabulary (use this language in the UI)
- **Biomechanics:** Emerging → Inconsistent → Developing → Consistent → Mastering
- **Tasks:** NotReady → AlmostReady → LikelyReady → ConsistentlyReady
- **Levels:** NotReady → AlmostReady → LikelyReady

Current MVP uses `untouched / working / mastered` — these are simplified display states, not the full assessment vocabulary. The full vocabulary is for V2 intelligence layer.

### Canonical RiderBiomechanics (10 levers)
Tier 1 (MVP priority): Lower leg stability, Core stability, Upper body alignment, Rein steadiness, Rein symmetry, Pelvis neutrality
Also: Seat independence, Timing of aids, Half-halt coordination, Weight distribution

### Canonical RidingQuality (8 dimensions)
Rhythm, Relaxation, Contact, Straightness, Impulsion, Collection, Balance, Adjustability

### Biomechanics Metrics — 5 Groups, 20+ Metrics
⭐ = MVP priority (starred in source doc). These are the metrics the Insights screen should prioritize.

**Lower Leg Stability Group:** ⭐ Lower Leg Stability, Knee Angle Stability, Heel Position Stability, Lower Leg Drift
**Hand / Rein Control Group:** ⭐ Rein Symmetry, ⭐ Rein Steadiness, Hand Spacing Stability, Elbow Symmetry, Elbow Elasticity
**Upper Body Alignment Group:** ⭐ Upper Body Vertical Alignment, Shoulder Levelness, Torso Rotation, Head Stability
**Core & Seat Stability Group:** ⭐ Core Stability, Trunk Angle Stability, ⭐ Pelvis Vertical Stability, Pelvis Levelness
**Balance / Symmetry Group:** Rider Centerline Alignment, Left-Right Symmetry Index, Seat Independence

*Note: Pelvis Vertical Stability ideal is NOT zero — the pelvis should move with the horse (ideal: 0.01–0.03).*

### Progression Structures

**USDF Dressage:** Intro Level → Training Level → First Level → Second Level → Third Level
- Intro: Walk/trot, rhythm, relaxation, straightness. Key biomechanics: Rein symmetry, Rein steadiness, Core stability, Lower leg stability.
- Training: Steady contact, balanced canter. Key biomechanics: Rein steadiness, Lower leg stability, Upper body alignment, Core stability.
- First: Bend, balance, lateral work (leg yield). Key biomechanics: Weight distribution, Core stability, Seat independence, Rein symmetry.
- Second: Collection, shoulder-in, travers, counter canter. Key biomechanics: Half-halt coordination, Timing of aids, Pelvis neutrality.
- Third: Flying changes, half-pass, sustained collection. Key biomechanics: Half-halt coordination, Core stability, Seat independence.

**Pony Club:** D1 → D2 → D3 → C1 → C2 → B
- D1 (Foundations): Walk/trot control, large circles. Key biomechanics: Rein symmetry, Upper body alignment, Core stability.
- D2 (Independent Rider): Consistent posting diagonal, 20m circle, smooth transitions. Key biomechanics: Core stability, Rein symmetry, Lower leg stability.
- D3 (Balanced Rider): Correct canter leads, small cross rails. Key biomechanics: Lower leg stability, Seat independence, Weight distribution.
- C1 (Influential Rider): 4–6 fence course (~2'), consistent leads. Key biomechanics: Rein steadiness, Timing of aids, Lower leg stability.
- C2 (Performance Ready): 2'–2'6" course, stride adjustability. Key biomechanics: Seat independence, Lower leg stability, Timing of aids.
- B (Advanced Amateur): Related distances, 2'6"+ consistently. Key biomechanics: Half-halt coordination, Rein steadiness, Core stability.

### Roadmap (MVP → V2 → V3)
- **MVP (EPIC 1–3):** System of record + progression, ride capture, basic intelligence. 10–20 milestones, 1 horse, 1 goal, static drills. Cadence is on-demand only.
- **V2:** Multi-discipline versions, trainer portal, competition objects, proactive Cadence nudges, formal readiness scoring, longitudinal pattern detection.
- **V3:** Horse persona, multi-horse profiles, horse development data model, sensor integration, horse biomechanics.

**V2 features — do not build:** Trainer portal, multi-horse, competition management, social features, sensor/GPS, proactive AI nudges, adaptive planning engine.

### Known Naming Inconsistency
The Roadmap CSV still references "Genie Shell" and "Horse-aware Genie" — should be "Cadence Shell" and "Horse-aware Cadence." Beau to fix when in that file. Decision to rename Genie → Cadence is in DECISIONS.md.

### Long-Term Vision
Horsera aims to become the *longitudinal system of record* for rider–horse development — the intelligent operating system for the equestrian world. Future layers: digital certifications, trusted horse histories for buying/selling, barn operations, horse welfare signals, federation integration.

---

## What the Team Has Learned

### About the codebase
- Styling uses inline styles throughout — intentional for MVP, follow this pattern
- Google Fonts are injected via AppShell — noted for migration to index.html later
- mock.ts is the single data source — never duplicate data elsewhere
- The repo has both Cowork-built files and some original Lovable/Remix files — treat src/ as the source of truth

### About Rossella's working style
- Rossella is highly visual — always lead with mockups or diagrams before text
- She thinks in product journeys and emotional states, not features
- She is a solo founder, non-technical, in active build mode
- She wants to be closely involved in all product and strategy decisions
- She approves the daily plan before work begins (Option A workflow)
- See FEEDBACK.md for all standing instructions on how to work with her

### About the product
- The three-layer model (Biomechanics → Riding Qualities → Performance Tasks) is the core differentiator — always visible in Journey and Insights
- Cadence is not a chatbot — it's a persistent advisor that knows the rider deeply
- "Ride the Test" / "Judge's Eye" is a planned V2 feature — architecture must support it but don't build it yet
- The development loop (Goals → Learn → Ride → Assess → Adjust → Achieve) is the north star for every product decision

---

## Session Log

### 2026-03-11 — First Working Session
**What happened:**
- Team completed full onboarding: read all agent files + all product docs
- MEMORY.md updated with comprehensive Product Knowledge section
- Full codebase review: all 5 screens assessed by all 4 agents
- Discovered critical issue: HomePage was on a different foundation (developmentThread.ts, Tailwind system, dead routes) from the other 4 screens (mock.ts, inline styles)
- 6 orphaned pages deleted: GeniePage, EvidenceStudioPage, LearnPage, PositionStabilityPage, ProgressPage, RidePage, Index
- mock.ts updated: added `DisciplineLevel` type, `USDF_LEVELS` constant, `disciplineLevel` field to Milestone, `currentDisciplineLevel` to Goal, one "reaching ahead" milestone (Leg Yield Foundations, First Level)
- JourneyPage completely rebuilt: level path navigator, skill rings grid, reaching ahead section, locked Ride the Test card
- HomePage rebuilt: inline styles, mock.ts data, atmospheric CSS hero placeholder (replace with real photo), Cadence CTAs all wired to correct routes
- Build: ✅ clean (379KB JS)
- Lint: 7 pre-existing errors in shadcn/ui and Supabase files — none in our code

**Key decisions made:**
- Unified on inline-styles system (the mock.ts system) — dropped Tailwind system for app screens
- The two-system problem was the most critical issue, now resolved
- Journey redesigned as skill map (level path + rings) rather than milestone list
- Hero is a CSS placeholder — real photo to replace when sourced

**What needs to happen next:**
- Rossella reviews the new Home and Journey screens
- Source/upload a hero image for Home (current is CSS placeholder)
- Empty states (zero rides, new user) — Quinn flagged, still missing
- Insights screen: add rider/horse identity to header
- Hardcoded Patterns tab in Insights should eventually be data-driven
- Show Prep checklist in Journey is still hardcoded — needs data layer

### 2026-03-11 — Initial Setup Session
**What happened:**
- Full MVP scaffold built by Cowork and pushed to GitHub
- Claude Code installed and configured on Rossella's Mac
- CLAUDE.md created by /init command
- Agent team defined: Ross (PM), Lauren (Designer), Beau (Developer), Quinn (QA)
- _agents/ folder created with TEAM.md, SKILLS.md
- _product-docs/ folder created with all strategy documents
- Agent memory system designed (this file + FEEDBACK.md + CHANGELOG.md + DECISIONS.md + DAILY.md + WEEKLY.md)

**What was decided:**
- Daily workflow: Option A (Ross proposes plan, Rossella approves before work begins)
- Memory: one shared file, compressed weekly
- Changelog: two levels — CHANGELOG.md (what) + DECISIONS.md (why)
- Visual-first working style established as standing instruction

**What needs to happen next:**
- Update CLAUDE.md to reference all agent files
- First real session: team reviews MVP screens and proposes improvements
- Quinn to do first full QA pass on all 5 screens
- Lauren to assess emotional correctness of each screen
- Ross to propose first weekly plan

---

*Updated by: Setup session*
*Next compression due: 2026-03-18*
