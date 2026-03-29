# Horsera — Product Plan & Navigation Spec
**Living document. Update when decisions change. Last updated: 2026-03-29**

> This doc captures the current state of product decisions, page specs, and implementation phases. 
> For the full historical decision log, see `_agents/DECISIONS.md` in the repo.
> When a decision here supersedes one in DECISIONS.md, note it with ~~strikethrough~~ in that file.

---

## Navigation Architecture (DECIDED — 2026-03-29)

### Bottom nav structure
```
Home  |  Progress  |  [+ Record]  |  Rides  |  Journey
```
- Center `[+ Record]` is a raised Cognac FAB (existing March 13 decision — kept)
- **"Insights" tab renamed to "Progress"** — supersedes DECISIONS.md March 11 entry

### Tab purposes
| Tab | Question it answers | Time frame |
|---|---|---|
| **Home** | Where am I right now? | Last session |
| **Progress** | How am I improving? | Across sessions |
| **[+ Record]** | Upload / record a new ride | Action |
| **Rides** | What happened in each session? | Per session |
| **Journey** | What am I working toward? | Long-term goals |

### Open question — Home tab
**Status: OPEN.** User challenged whether Home is needed (could Rides be the default?).  
- Argument to keep: curated "I just opened the app" view, Cadence greeting, feels premium  
- Argument to drop: one fewer tap to real content, Rides list can absorb it  
- Decision pending: revisit after first user testing round

---

## Page Specs

### Home
**Purpose:** Quick read of last session + Cadence ambient presence  
**Content:**
- Last session card: score ring + date + horse + top metric chip
- Cadence greeting: one warm insight from the most recent session (Playfair italic)
- Upload CTA if no recent ride  
- Quick stat chips: 3 metrics vs. previous session

---

### Rides
**Purpose:** Session history. Each ride is a card; tap to open Ride Detail.

**Ride list card shows:**
- Score ring (overall position score)
- "↑ Most improved" chip (metric with biggest positive delta)
- "⚑ Focus area" chip (lowest-scoring metric)
- Date + horse + duration

**Ride Detail (2 tabs: Video | Report)**

#### Video tab
- Skeleton + ghost toggle (ghost = ideal posture overlay, dashed silver-white, opt-in)
- Joint color coding: green = on target · amber = working · terracotta = needs focus
- Moment flags on session arc ribbon (diamond markers, hover tooltip)
- Compensation chain hint strip below video (condensed root cause: "Root: lower leg")
- Cadence hint strip (Playfair italic, warm tone)
- Playback controls: play/pause, scrub, 0.5×/1×/2× speed
- Sparklines for 5 metrics below controls

#### Report tab
- **Cadence Debrief** — narrative paragraph in Playfair italic, "C" monogram, stat chips, Ask Cadence input
- **Riding quality — this session** — 6 Scales of Training scores (Rhythm → Relaxation → Contact → Impulsion → Straightness → Balance). *Also appears aggregated in Progress.*
- **Compensation chain** — 3-layer numbered chain (root cause → consequence → downstream)
- **Best & worst frames** — side-by-side cards, mini skeleton, "Watch in playback →" link with timestamp

**⚠️ Migration note (for Matt):**  
Do NOT touch `RidesPage.tsx` or `RideDetailPage.tsx` directly. The new Video/Report tabs from `src/pages/analysis/` should be wired into `RideDetailPage.tsx` as a tab container replacing its current layout. Video upload/playback fixes Matt applied to `RidesPage.tsx` must be confirmed working in the new tab context before any routing changes.

---

### Progress
**Purpose:** Aggregate trends over time — replaces "Insights" tab.  
**Rename in code:** `InsightsPage.tsx` → `ProgressPage.tsx` (safe rename, no functional changes to start)

**Content sections:**

1. **Biomechanics trends** (5 metrics: Core · Lower Leg · Reins · Pelvis · Shoulder)
   - ⚠️ **FIX NEEDED:** Bar charts currently show no time axis. Labels must read left=oldest → right=most recent. Add session markers or switch to a sparkline with "6 sessions ago → now" x-axis label.

2. **Riding quality trends** (6 Scales: same as per-session, but aggregated)
   - Show delta from baseline + trend direction

3. **Session history** 
   - Line chart of overall score over time
   - Chronological: oldest left, most recent right

4. **Cadence patterns**
   - Recurring observations across sessions (e.g. "Lower leg is your consistent focus area — appears in 4 of your last 5 sessions")

---

### Journey
**Purpose:** Forward-looking. Where you're headed — test readiness, skill mastery, level goals.

**Requires discipline selection** (see Discipline section below).

**Content sections:**

1. **Current level & test in progress**
   - e.g. "Training Level · Test 1"
   - Test readiness score (e.g. 72%) with breakdown

2. **Performance tasks** *(terminology from DECISIONS.md March 11 — keep)*
   - List of required tasks for current test level
   - Status per task: ✓ Mastered · ◎ In progress · ○ Not started
   - Tap task → shows which biomechanics metrics drive it + current scores
   - For dressage: "movements" (USDF term). For pony club: "skills". Same data model, discipline-specific label.

3. **Milestones** 
   - Unlocked achievements + next target

4. **Cadence recommendation**
   - What to focus on before the next session, based on test readiness gap

**Discipline-aware content:**
- If discipline not set: show "Select your discipline to unlock your test roadmap" prompt
- Disciplines for MVP: Dressage (USDF levels) · Pony Club (D/C/B/A ratings)
- Coming later: Hunter/Jumper · Trainer custom programs

---

## Discipline Selection

**Where it lives:**
1. **Onboarding** — step in the setup flow
2. **Journey tab** — if not yet set, shows the prompt as a CTA before any content
3. **Settings** — always changeable

**Data model requirement:**
Add `discipline: 'dressage' | 'pony_club' | null` to the user/rider profile from day one.  
Journey content, task labels, and test structure are all conditional on this field.  
This is a display-layer swap — same data model, different content rendering.

**MVP scope:** Dressage + Pony Club  
**Deferred:** Hunter/Jumper, Trainer custom programs

---

## Riding Quality — Dual Presence

Riding quality (The Scales of Training) appears in **two places** intentionally:

| Location | Purpose | View |
|---|---|---|
| Rides → Report tab | Diagnostic — what happened this session | Single session |
| Progress | Developmental — how it's trending over time | Across sessions |

These are the same underlying metrics, different time frames. Both are needed.

---

## Implementation Phases

### Phase 1 — Navigation restructure (current focus)
- [ ] Rename "Insights" → "Progress" in bottom nav and `InsightsPage.tsx`
- [ ] Fix progress chart time axis (add left=oldest → right=most recent labels)
- [ ] Wire `AnalysisShell` (Video + Report tabs) into `RideDetailPage.tsx`  
  - Keep `RidesPage.tsx` and `RideDetailPage.tsx` intact — add tabs, don't replace
  - Confirm Matt's video upload fix works in new tab context
- [ ] Update routing in `App.tsx`:  
  - `/rides/:id` loads new tabbed Ride Detail  
  - `/progress` loads ProgressPage  
  - `/analysis/*` routes can be deprecated once wired into Ride Detail
- [ ] Add discipline `null` state to Journey tab with prompt

### Phase 2 — Journey enhancement
- [ ] Add discipline selection to onboarding + settings
- [ ] Build performance task list for Dressage (Training Level tasks already in DECISIONS.md)
- [ ] Build performance task list for Pony Club
- [ ] Tap-to-expand task card showing biomechanics drivers + current scores
- [ ] Test readiness score calculation

### Phase 3 — Progress refinements
- [ ] Fix time axis on all trend charts
- [ ] Add Cadence patterns section (recurring cross-session observations)
- [ ] Riding quality trends (aggregated Scales over time)

### Phase 4 — Body navigation (pinned — post Phase 1-3)
- Switch metric cards in Report tab from scroll to body-as-navigation display
- Same data, display-layer change only
- Enabled by: having the zone data structure right in Phase 1

### Deferred / V2
- [ ] Live feedback (coach callouts) — decided Option B, awaiting Sprint B (DECISIONS.md March 12)
- [ ] "Your Plan" tab in Ride Detail
- [ ] Ride Out / video hero on Rides list
- [ ] Trainer portal (link-based sharing is V1.5)
- [ ] Hunter/Jumper discipline
- [ ] Real MoveNet pose → skeleton wiring (for Matt — see note below)

---

## Note for Matt

**Two engineering tasks when ready:**

**1. Video upload in Analysis/Ride Detail context**  
The new Ride Detail page uses `src/pages/analysis/RideTab.tsx` as its Video tab. Whatever upload/playback fix was applied to `RidesPage.tsx` needs to be confirmed working when video is loaded inside the Analysis shell. Don't duplicate the logic — extract it to a shared hook or utility if needed.

**2. MoveNet → skeleton wiring**  
`RideTab.tsx` currently uses hardcoded joint positions. Once upload is stable:
- Replace hardcoded SVG joint positions with live MoveNet keypoint coordinates
- Drive joint colors from the 5 metric scores (thresholds already defined in the file: green ≥ 0.80, amber 0.60–0.79, terracotta < 0.60)
- Fix `VideoSilhouetteOverlay.tsx` in `RideDetailPage.tsx` — skeleton currently static, needs to track rider frame-by-frame

---

## How to Use This Document

**Rossella:** Mark items `[x]` when done. Add new questions as open items at the bottom.  
**Claude:** Update decisions sections when new calls are made. Add dated entries to the decision log at the bottom.  

---

## Decision Log (supplement to `_agents/DECISIONS.md`)

### 2026-03-29 — Navigation restructured, "Insights" renamed "Progress"
**Decision:** Bottom nav becomes `Home | Progress | [+Record] | Rides | Journey`. "Insights" tab renamed "Progress" throughout.  
**Why:** "Insights" was doing three jobs (ride-level, aggregate trends, test progression). Each job now has its own home. "Progress" is clearer about the aggregate/trend purpose.  
**Supersedes:** DECISIONS.md entries for "4-tab navigation" and "Insights" tab purpose.

### 2026-03-29 — Analysis sandbox → Ride Detail tabs
**Decision:** The `src/pages/analysis/` sandbox (AnalysisShell + RideTab + ReportTab) becomes the Video and Report tabs inside Ride Detail. `/analysis` route deprecated once wired.  
**Why:** Sandbox served its purpose. Content is right; it just needs to live inside the main nav hierarchy at `/rides/:id`.

### 2026-03-29 — Discipline selection required for Journey
**Decision:** Journey content is discipline-specific. MVP supports Dressage + Pony Club. User must select discipline in onboarding or settings. Journey shows a prompt if not yet set.  
**Why:** USDF test movements ≠ Pony Club skills. Same data model, discipline-aware display layer.

### 2026-03-29 — "Movement" → "Performance Task" confirmed
**Decision:** Existing DECISIONS.md terminology of "Performance Tasks" confirmed. Discipline-specific display labels: "movements" for dressage, "skills" for pony club.  
**Why:** "Performance Task" is already the internal/code term from March 11 decision. "Movement" is the correct USDF display term. No model change needed.

### 2026-03-29 — Progress chart time axis fix required
**Decision:** Biomechanics trend bar charts must add a time axis. Bars read left=oldest → right=most recent. Add "oldest → most recent" label or session markers.  
**Why:** Current chart reads as category comparison, not time series. A rider cannot tell if they're improving or regressing.

### 2026-03-29 — Body navigation pinned to Phase 4
**Decision:** Post-ride body review stays as scroll-based layout for now. Body-as-navigation (tappable joints on dimmed photo) is Phase 4 — a display-layer swap, no data restructure needed if zone cards are built correctly in Phase 1.  
**Why:** Simplifies Phase 1 scope. Body nav adds visual complexity (silhouette design) that would block getting the data/numbers right first.
