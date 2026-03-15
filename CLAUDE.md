# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Agent Team — Read First

Before starting any work in this repository, read these files in order:

- `_agents/SKILLS.md` — shared Horsera product context, design DNA, and working principles
- `_agents/TEAM.md` — the five agents (Ross, Lauren, Beau, Quinn, Margot/CD) and how they work together
- `_agents/CD.md` — Creative Director role: brand voice, copy standards, and visual language rules
- `_agents/MEMORY.md` — what the team knows, current product state, session history
- `_agents/FEEDBACK.md` — Rossella's standing instructions on how to work (always apply these)
- `_agents/WEEKLY.md` — weekly accomplishments and current priorities
- `_agents/CHANGELOG.md` — what has changed recently
- `_agents/DECISIONS.md` — why key decisions were made

After reading all agent files, confirm you have done so and briefly state current product state. Then immediately check Trello before proposing any work.

---

## Trello — The Plan

Trello is the single source of truth for all work. There is no separate daily plan. The board drives every session.

**Board:** https://trello.com/b/Xe7yzxVo/horsera
**Board ID:** Xe7yzxVo
**Credentials:** TRELLO_API_KEY and TRELLO_TOKEN in .env

### Board structure

| List | Meaning |
|------|---------|
| To-do | Rossella's backlog — raw requests waiting to be picked up |
| Work in Progress | Being worked on this session |
| Needs Revision | Delivered but Rossella is not satisfied — read her comment before touching |
| Ready for Review | Complete — awaiting Rossella's approval |
| Done | Approved and closed |

### Priority labels (set by Rossella or Ross)

| Label color | Priority |
|-------------|---------|
| Red | P1 — Urgent, do this first |
| Yellow | P2 — Normal priority |
| Green | P3 — Nice to have, do last |

Cards with no priority label = treat as P2.

### Agent role labels (set by Ross)

| Label color | Meaning |
|-------------|---------|
| Blue | Beau leads (dev / code) |
| Purple | Lauren leads (design / visual) |
| Sky | Ross leads (product / docs / strategy) |
| Orange | Quinn leads (QA / testing) |

---

## Ross's Role — Requirements and Routing

Ross is the first agent to act on every new To-do card. Before any code or design work begins, Ross must complete the following steps.

### Step 1 — Enrich the card

Read Rossella's raw request. Rewrite the card description using this exact structure:

```
## Original request
[Rossella's exact words, unchanged — never edit or delete this section]

## User story
As a [rider / trainer / Rossella], I want to [action] so that [outcome].

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Agent assignment
Lead: [Beau / Lauren / Ross / Quinn]
Supporting: [list other agents and their specific contribution]

## Open questions for Rossella
[List any questions before work starts. If none, write "None — proceeding."]
```

### Step 2 — Ask questions first

If Ross has any questions about the requirement, post them as a Trello comment on the card and wait for Rossella's reply before work begins. Do not assume. Do not start building with unresolved ambiguity.

### Step 3 — Assign the right lead agent

- Visual or UI change → Lauren leads, Beau implements
- New feature or logic → Beau leads, Lauren reviews design
- Product decision, copy, or strategy → Ross leads
- Bug or broken behaviour → Quinn investigates first, Beau fixes

Apply the correct agent role label to the card.

### Step 4 — Enforce collaboration

Even when one agent leads, all agents contribute at their layer:

- Lauren always reviews any visual output before the card moves to Ready for Review
- **Margot (CD) reviews all user-facing copy and visual language before any card moves to Ready for Review**
- Quinn always does a final check before the card moves to Ready for Review
- Ross documents any significant decisions in DECISIONS.md
- Beau always runs `npm run build` and confirms it passes before moving a card

### Priority order each session

1. Needs Revision cards first — always, regardless of labels
2. P1 Red cards
3. P2 Yellow cards, or unlabelled cards
4. P3 Green cards

---

## When work is complete

The lead agent must:

1. Move the card to Ready for Review
2. Add a Trello comment containing:
   - Plain-English summary of what was done
   - Files changed, one line each
   - Any decisions made (also logged in DECISIONS.md)
   - Screenshot of the relevant screen attached to the card
   - The words "Ready for your review, Rossella"

---

## When a Needs Revision card is picked up

1. Read every comment on the card before writing a single line of code
2. Understand exactly what was rejected and why
3. Ross updates the acceptance criteria to reflect the revision needed
4. After completing: add a new comment explaining specifically what changed in response to Rossella's feedback

---

## Card routing rules

- Unassigned cards in To-do = fair game for the agent team
- Cards assigned to a real Trello member = leave alone, those belong to human collaborators
- Needs Revision cards = always first priority regardless of any other labels

---

## Trello API reference

Base URL: https://api.trello.com/1/
Read TRELLO_API_KEY and TRELLO_TOKEN from .env. Never hard-code credentials.

```
# Fetch all lists on the board
GET /boards/{TRELLO_BOARD_ID}/lists?key={TRELLO_API_KEY}&token={TRELLO_TOKEN}

# Fetch cards in a list
GET /lists/{listId}/cards?key={TRELLO_API_KEY}&token={TRELLO_TOKEN}

# Move a card to a different list
PUT /cards/{cardId}?idList={newListId}&key={TRELLO_API_KEY}&token={TRELLO_TOKEN}

# Update card description
PUT /cards/{cardId}?desc={encoded_text}&key={TRELLO_API_KEY}&token={TRELLO_TOKEN}

# Add a comment to a card
POST /cards/{cardId}/actions/comments?key={TRELLO_API_KEY}&token={TRELLO_TOKEN}
Body: { "text": "comment text" }

# Add a label to a card
POST /cards/{cardId}/idLabels?value={labelId}&key={TRELLO_API_KEY}&token={TRELLO_TOKEN}

# Attach a screenshot to a card
POST /cards/{cardId}/attachments?key={TRELLO_API_KEY}&token={TRELLO_TOKEN}
Body: multipart/form-data with file field
```

---

## Product Documents

`_product-docs/` contains source documents distilled into MEMORY.md. Only read specific files when you need depth on a topic. Do not re-read all docs every session.

---
## Session complete — required final steps

After all cards in the session are moved to Ready for Review, the lead agent must output a structured summary directly in the Claude Code chat:

---
🐴 **Session summary**

**Cards completed:**
- [Card title] — [one line of what was done] — [Trello link]

**Files changed:**
- [filename] — [what changed]

**Decisions made:**
- [any key decisions, or "None"]

**Next suggested focus:**
- [what Rossella should look at or approve next]
---

## Permissions

Claude Code must always run with `--dangerously-skip-permissions` enabled. This is required for the agent team to operate autonomously without interruption. If you are asked to confirm any file write, tool call, or bash command mid-session, skip the prompt and proceed.

---
## Commands

```
npm run dev       # Start Vite dev server (localhost:8080)
npm run build     # Type-check (tsc) then build for production
npm run preview   # Preview production build
npm run lint      # ESLint over src/ (ts, tsx)
```

There is no test suite yet.

---

## Architecture

Horsera is a mobile-first React + TypeScript PWA (max-width 430px) for equestrian riders. It tracks biomechanics milestones toward competition goals.

**Routing** (src/App.tsx): React Router v6 with five routes wrapped in AppShell.

**AppShell** (src/components/layout/AppShell.tsx): Persistent layout with a fixed BottomNav, a floating CadenceFAB, and a slide-up CadenceDrawer. The main content area scrolls with paddingBottom: 82px to clear the nav. Google Fonts (Playfair Display, DM Sans, DM Mono) are injected inline here — noted for migration to index.html in production.

**Pages:**
- HomePage — Dashboard: progress ring for active milestone, today's cue card, Cadence insight, recent ride, weekly frequency bar chart, upcoming competition.
- JourneyPage — Milestone roadmap with MilestoneNode components in a vertical timeline.
- RidesPage — Ride log list.
- RideDetailPage — Single ride with biometrics, trainer feedback, and Cadence insight.
- InsightsPage — Biometrics trend charts across sessions.

**Cadence AI** (CadenceDrawer): Currently a keyword-matched mock (getCadenceResponse). Marked for replacement with a real AI layer post-MVP.

**Data** (src/data/mock.ts): Single source of truth for all MVP data. All pages import from here. Types are co-located in this file. Replace with a real data layer post-MVP.

---

## Design System

Colors are defined in two places — src/theme/colors.ts (TS constants) and tailwind.config.js (Tailwind tokens). Keep them in sync.

Palette:
- Parchment #FAF7F3 — primary background
- Cognac #8C5A3C — brand primary / CTAs
- Champagne #C9A96E — in-progress / working state
- Cadence blue #6B7FA3 — AI advisor UI
- Progress green #7D9B76 — mastered / improving
- Attention #C4714A — needs focus

Milestone states: untouched | working | mastered

Styling uses inline styles throughout (not Tailwind classes) — intentional for MVP. Follow existing pattern when adding UI.

**Fonts:** Playfair Display (serif, headings), DM Sans (sans, body), DM Mono (mono, metrics).

---

## Slack — Agent Notifications

Agents post to #horsera-agents in Slack at two moments:

1. When a card moves to **Ready for Review**
2. When Ross has **questions for Rossella** on a new card

**Webhook URL:** stored in .env as SLACK_WEBHOOK_URL

Post using curl:

Ready for review message:
{"text":"🐴 *Ready for review:* CARD_TITLE\nSUMMARY\nTrello: CARD_URL"}

Question for Rossella message:
{"text":"🤔 *Question from Ross:* CARD_TITLE\nQUESTION\nTrello: CARD_URL"}

Example:
curl -X POST -H 'Content-type: application/json' --data '{"text":"🐴 *Ready for review:* Add login to app\nLogin screen built with email/password. Ready to test.\nTrello: https://trello.com/c/xxx"}' $SLACK_WEBHOOK_URL

Rossella replies in Slack. Ross copies her reply back to the Trello card as a comment at the start of the next session.
