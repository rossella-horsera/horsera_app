# Horsera — Change Log

A running record of every meaningful change to the product, codebase, or documentation. Newest entries at the top.

**Format:**
- [Agent] Screen/Area: what changed
- Tag with: [code] [design] [product] [docs] [fix] [new]

---

## 2026-03-15 (Session — 8 cards)

- [Beau] [code] [new] Card 1 — Onboarding gate centralized in AppShell.tsx; ProfileSetupModal shown before any route if !isProfileComplete()
- [Lauren+Beau] [code] Card 2 — Personalized header: "Welcome, [Name]" with name in Playfair italic on Rides screen
- [Beau] [code] [fix] Card 3 — CameraTips component deleted; upload screen clean
- [Lauren+Beau] [code] Card 4 — Upload CTA: "See how you really ride.", Cadence AI badge, shadow on CTA
- [Lauren+Beau] [code] Card 5 — All emoji replaced with thin SVG line art across RidesPage, InsightsPage, ProfileSettingsPanel
- [Lauren+Beau] [code] Card 6 — Cadence FAB: breathing orb (idle), waveform bars (active/listening only)
- [Beau] [code] [new] Card 7 — Cadence wired to OpenAI gpt-4o-mini via streaming; dynamic system prompt with rider context
- [Quinn+Beau] [code] [fix] Card 8 — Profile zoom fix: minScale calculated from image dimensions; slider min = full image visible
- [Beau] [docs] Card 9 — Deploy blocked on Vercel login; code pushed to GitHub; instructions in Trello
- [Beau] [code] Build passes ✅ (492KB main bundle)

## 2026-03-12 (Iteration Sprint — Tasks 1–8 complete)

- [Ross] [docs] All 6 decisions written to DECISIONS.md (live video feedback, tab naming, 4th tab, rides list, homepage, position rename, skill→score mapping)
- [Beau] [code] [fix] Skeleton aspect ratio: canvas height now = 256 × (videoHeight/videoWidth); SVG overlay changed to preserveAspectRatio="none" — skeleton now tracks rider's actual body position
- [Beau] [code] [new] Video player full-ride mode: "Watch full ride ↗" button enters full playback with scrub bar, play/pause, 0.5×/1×/2× speed, "Best moment" jump, "← Highlight" return
- [Beau] [code] [fix] Upload copy: "No upload" removed. Now reads "Upload your video — Cadence analyses your position · Private"
- [Beau] [code] Favicon: Horsera logo PNG set as browser tab icon via index.html
- [Lauren + Beau] [code] [new] Horsera logo in persistent top header bar (48px, all screens)
- [Beau] [code] "Biomechanics" → "Your Position" in all user-facing UI text (tabs, labels, section headers, copy)
- [Lauren + Beau] [code] [new] Body Map tab renamed "Your Position"; dark navy/charcoal rider silhouette with arc gauges at 6 joints; floating callout cards; overall gradient bar; issue summary with coaching cues + collapsible exercises
- [Lauren + Beau] [code] Quality tab renamed "The Scales"; all rows now tappable/expandable — reveals full quality description + dressage training suggestions specific to Allegra's level
- [Lauren + Beau] [code] Cadence orb redesigned: asymmetric organic breathing (inhale 38%/exhale 62%, cubic-bezier); sonar ripple ring expanding outward; "Ask Cadence" label with mic icon always visible above FAB
- [Beau] [code] Build passes ✅ (440KB main bundle)

## 2026-03-12 (Video clip player — best moment + live skeleton)

- [Lauren + Beau] [code] [new] `VideoClipPlayer` component in `VideoAnalysis.tsx`
  - Plays a 6-second loop of the best biomechanics moment from the uploaded video
  - Live SVG skeleton overlay updates in sync with `video.currentTime` via `onTimeUpdate`
  - Nearest `TimestampedFrame` matched to current playback time (linear scan, no delay)
  - Play/pause toggle with Champagne play button; autoplay muted on load
  - "Best moment · 6s" + frame count badges overlay top corners
  - Fallback: if no `videoPlaybackUrl` (mock ride), shows MockVideoFrame with upload CTA as before
- [Beau] [code] [fix] `VideoAnalysis.tsx`: removed stale `representativeFrame`/`thumbnailDataUrl` references — now uses `videoPlaybackUrl`, `bestMomentStart`, `allFrames`, `bestFrame` from updated hook
- [Beau] [code] Build passes ✅ (421KB main bundle; TF.js chunks load on demand)

## 2026-03-12 (Video Analysis Rebuild — Issues 1–3)

- [Lauren] [design] [new] ISSUE 2 — "The Rider Map" body diagram designed and built
  - Two-column layout: SVG rider diagram (left) + metric score list (right)
  - Rider: side-view dressage skeleton, thick rounded pill-shaped limbs (not a stick figure)
  - Each body segment colored by its metric: torso=Core, arms=Rein Steadiness/Symmetry, leg=Lower Leg, hip=Pelvis, head/shoulder=Upper Body
  - Inline score % labels next to relevant joints (DM Mono font)
  - Horse barrel at bottom — immediately recognisable as equestrian
  - Parchment background + radial gradient glow behind figure — warm, not clinical
  - Overall score shown at bottom of metric list
  - Unmistakably Horsera — not a copy of Ridesum's dark clinical diagram
- [Lauren] [design] [new] ISSUE 3 — Riding Quality panel designed
  - Layer 2 (USDF Scales of Training) order: Rhythm → Relaxation → Contact → Impulsion → Straightness → Balance
  - Each quality: Playfair Display name, gradient bar, score %, score label badge, "driven by X" metric
  - Derived algorithmically from Layer 1 biometrics — makes the four-layer model visible
- [Beau] [code] [new] `poseAnalysis.ts`: added `computeRidingQualities()` — 6 Layer 2 scores from biometrics
- [Beau] [code] [new] `VideoAnalysis.tsx` — complete rebuild with tabs
  - Tab 1 "Movement": Movement Insights text cards (Layer 1→Layer 2 narratives)
  - Tab 2 "Body Map": Rider body diagram (Lauren's design)
  - Tab 3 "Quality": Riding quality panel (USDF scales)
- [Beau] [code] [fix] ISSUE 1 — Skeleton overlay: confidence threshold lowered 0.3→0.12, dark outline layer added for contrast on any background, opacity indicates confidence, all connections rendered
- [Beau] [code] [fix] Mock video frame: full dressage rider skeleton redrawn with all limbs, joints, and correct Horsera colors based on ride biometrics (not hardcoded white/yellow/red)
- [Beau] [code] RideDetailPage: passes `mockBiometrics={ride.biometrics}` to VideoAnalysis
- [Beau] [code] Build passes ✅ (same bundle size, no regressions)

## 2026-03-11 (Pose Pipeline Session — TASKS 1–5)

- [Ross] [product] TASK 1 — Model selection: MoveNet Thunder chosen over MediaPipe, ViTPose, OpenPose, YOLO-Pose. Decision logged in DECISIONS.md.
- [Ross] [product] TASK 3 — Metric definitions: all 6 biomechanics metrics defined as relative-position stability calculations (relative to hip/shoulder anchors to remove camera drift). Documented in DECISIONS.md.
- [Lauren] [design] TASK 4 — Visualization Direction A selected: skeleton overlay on real video thumbnail, joints colored by metric score (green/champagne/red). Direction B (stability trace) logged as post-MVP.
- [Beau] [code] [new] `src/lib/poseAnalysis.ts` — pure metric computation library
  - `KP` constants: all 17 MoveNet keypoint indices
  - `SKELETON_CONNECTIONS`: 12 body segment pairs for skeleton drawing
  - `JOINT_REGIONS`: maps each joint to its biomechanics metric (for color coding)
  - `computeBiometricsFromFrames()`: computes all 6 metrics from pose frame array
  - `generateInsights()`: generates 4 Layer1→Layer2 narrative insights with trend arrows
- [Beau] [code] [new] `src/hooks/useVideoAnalysis.ts` — React hook for full video pipeline
  - Dynamic imports: `@tensorflow/tfjs` + `@tensorflow-models/pose-detection` load only on first video upload (keeps main bundle size unchanged)
  - Detector cached after first load — subsequent analyses skip model download
  - Samples video at 5-second intervals (capped at 600 frames) for stability metric accuracy
  - Returns: `{ status, progress, result, error, analyzeVideo, reset }`
  - `VideoAnalysisResult` includes: biometrics, insights, frameCount, thumbnailDataUrl, representativeFrame (keypoints)
- [Lauren+Beau] [code] [new] `src/components/ui/VideoAnalysis.tsx` — full video analysis UI component
  - State 1 (analyzing): animated Cadence orb + progress bar
  - State 2 (real result): video thumbnail + real SVG skeleton overlay + real insights
  - State 3 (error): error message + retry button
  - State 4 (videoUploaded mock): mock SVG skeleton + "Upload video for live AI analysis" CTA overlay
  - State 5 (no video): "Add a video" dashed card
  - Skeleton SVG uses viewBox="0 0 1 1" with normalized keypoint coordinates — scales to any display size
- [Beau] [code] [fix] `RideDetailPage.tsx`: replaced ~120 lines of hardcoded mock SVG + insights with `<VideoAnalysis>` component + `useVideoAnalysis` hook. `generateInsights()` now drives the mock insight text for existing rides.
- [Beau] [code] Build passes ✅ (409KB main bundle; TF.js chunks are code-split, load on demand only)

## 2026-03-11 (Evening autonomous session — Changes 1–5)

- [Beau] [code] [new] Change 5 — Hero image: replaced CSS placeholder with real photo (`public/hero.jpg`)
  - `shutterstock_2316206717.jpg` copied to `public/hero.jpg`
  - HeroPlaceholder updated: real `<img>` with `object-fit: cover`, dark gradient overlay for text legibility
  - All hero text updated to white/parchment tones with text-shadow
- [Lauren] [design] [fix] Change 3 — Cadence visual identity redesigned
  - `CadenceInsightCard`: gradient background (`#EAF0FB → #EEF2FA`), inner glow box-shadow, luminescence radial overlay, glowing orb logo with halo ring
  - `CadenceFAB`: `cadence-glow` keyframes added to AppShell — pulses Champagne halo on outer button; animated halo ring div added inside button; orb gets radial gradient fill and box-shadow glow
- [Ross] [product] Change 2 — Performance tasks confirmed as Journey's primary skill layer
  - Reasoning logged in DECISIONS.md
- [Beau + Lauren] [code] Change 2 — USDF milestones renamed to performance tasks
  - ms-001: "20m Trot Circle" (was "Lower Leg Stability")
  - ms-002: "Free Walk on Long Rein" (was "Rein Steadiness")
  - ms-003: "Working Canter Transition" (was "Core Stability")
  - ms-004: "Halt & Salute" (was "Upper Body Alignment")
  - ms-005: "Walk–Trot Transitions" (was "Symmetry & Balance")
  - ms-006: "Leg Yield" (was "Leg Yield Foundations")
  - Biomechanics remain as supporting context in the detail panel
- [Beau] [code] [new] Change 2 — `performanceTasks` array added to all 5 `USDF_LEVELS` definitions
- [Lauren + Beau] [code] [new] Change 1 — Level drill-down on Journey
  - LevelPath level dots are now `<button>` elements
  - `selectedLevel` state in JourneyPage; toggle on tap
  - Inline expand panel shows level name, description, status badge (Current/Completed/Upcoming), and all performance tasks for that level with color-coded dots
- [Lauren + Beau] [code] [new] Change 4 — Video analysis section in RideDetailPage
  - SVG pose estimation mockup: rider skeleton over dark arena background, color-coded joints (white/yellow/red), legend, play button overlay
  - "Movement Insights" panel: 4 metric rows connecting Layer 1 biomechanics to Layer 2 riding quality with trend badges (Lower Leg→Rhythm, Rein Steadiness→Contact, Core→Balance, Left Arm→Symmetry)
- [Quinn] [code] [fix] MilestoneDetail duplicate render bug — removed redundant condition that caused detail panel to show twice for reaching-ahead milestones
- [Beau] [code] Build passes clean ✅ (394KB)

## 2026-03-11 (Issues 2 & 5 — Journey rebuild + Cadence presence)

- [Ross] [product] Journey redesigned as multi-goal screen — not a levels screen
- [Lauren] [design] Goal card pattern established: type badge, readiness ring, skill rings, detail expand
- [Beau] [code] [new] mock.ts: added `GoalType` type, made `Milestone.disciplineLevel` optional, added `cadenceNote` field to Milestone
- [Beau] [code] [new] mock.ts: added `Goal.type`, `Goal.description`; made `track/level/currentDisciplineLevel/test/targetDate` optional to support non-level goals
- [Beau] [code] [new] mock.ts: added Goal 2 — "Feel Confident on Trail Rides" with 4 trail milestones (ms-t001–ms-t004)
- [Beau] [code] [new] mock.ts: exported `mockGoals` array; `mockGoal` kept as `mockGoals[0]` alias — no other screens broken
- [Beau + Lauren] [code] [new] JourneyPage: full rebuild as multi-goal card view
  - ReadinessRing component: small SVG ring showing goal readiness %
  - GoalCard: type badge, name, description, readiness ring, level path (USDF only), skill rings grid, detail expand, reaching ahead section, show prep (competition goals only)
  - Context-sensitive Cadence insight: updates to milestone's `cadenceNote` when a skill ring is tapped
  - "Add a goal" placeholder at bottom
- [Beau] [code] [new] Issue 5 — Breathing orb: `@keyframes cadence-breathe` added to AppShell global styles
- [Beau] [code] [new] Issue 5 — CadenceFAB inner orb now pulses with `cadence-breathe` (3.2s, ease-in-out, infinite)
- [Beau] [code] Build passes clean ✅ (385KB)

## 2026-03-11 (Issue 4 — Navigation Audit)

- [Beau + Quinn] [code] [fix] Full navigation audit — all 5 screens, every tap mapped
  - **Found:** 1 broken element — "Ask Cadence" button in HomePage had no onClick handler
  - **All other navigation confirmed working:** BottomNav (4 routes), all ride cards, View trends, Back buttons
- [Beau] [code] [new] Created `src/context/CadenceContext.tsx` — React context exposing `openCadence()` to all pages
- [Beau] [code] [fix] Refactored AppShell to use CadenceProvider — CadenceDrawer now lives in context, not AppShell local state
- [Beau] [code] [fix] Wired "Ask Cadence" button in HomePage to `openCadence()` via context
- [Beau] [code] Build passes clean ✅ (379KB)

## 2026-03-11

- [Beau] [code] [new] Full MVP scaffold pushed to GitHub — 25 files, 3,114 insertions
  - Screens: Home, Journey, Rides, RideDetail, Insights
  - Layout: AppShell, BottomNav, CadenceFAB, CadenceDrawer
  - UI components: ProgressRing, MilestoneNode, CadenceInsightCard
  - Data: mock.ts with full sample data for Rossella Vitali / Allegra
  - Config: Vite, TypeScript, Tailwind, PostCSS

- [Ross/Lauren] [docs] [new] Agent team playbook created
  - _agents/TEAM.md — Ross, Lauren, Beau, Quinn defined
  - _agents/SKILLS.md — shared Horsera context and design DNA

- [Setup] [docs] [new] Product documents uploaded to _product-docs/
  - Product Strategy, Pitch and Description, Architecture
  - Biomechanics Metrics, Progression (USDF + Pony Club), Roadmap

- [Setup] [docs] [new] Memory system initialized
  - MEMORY.md, FEEDBACK.md, CHANGELOG.md, DECISIONS.md, DAILY.md, WEEKLY.md

## 2026-03-11 (First Working Session)

- [Beau] [code] [fix] Deleted 7 orphaned pages (GeniePage, EvidenceStudioPage, LearnPage, PositionStabilityPage, ProgressPage, RidePage, Index) — were on old data layer, not routed
- [Beau] [code] [new] mock.ts: added DisciplineLevel type, USDF_LEVELS constant, disciplineLevel field on Milestone, currentDisciplineLevel on Goal, Leg Yield Foundations milestone (First Level, reaching ahead)
- [Beau + Lauren] [code] [new] JourneyPage: full redesign — LevelPath navigator, SkillRing grid, Reaching Ahead section, locked Ride the Test card
- [Beau + Lauren] [code] [new] HomePage: full rebuild in inline styles — atmospheric CSS hero placeholder, mock.ts data, correct Cadence/Cognac branding, all routes wired
- [All] [docs] MEMORY.md updated with full Product Knowledge section distilled from _product-docs/
- [Beau] [code] Build passes clean ✅

---

*Agents: add entries here as work happens, not at the end of the session.*
*Keep entries brief — one line per change where possible.*
*For the "why" behind decisions, see DECISIONS.md.*
