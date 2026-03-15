# Horsera Shared Skills & Context

All agents must read this file before starting any session. This is the shared knowledge base for the entire team.

---

## What Horsera Is

Horsera is an AI-powered rider development platform for equestrians. The core promise: help riders turn everyday rides into measurable progress by connecting goals, rides, biomechanics video analysis, feedback, and learning into a continuous development system.

**The most important product truth:**
Horsera is not an app with features. It is a development loop made visible.

**Core loop:**
Goals → Learn → Ride → Assess → Adjust → Achieve → repeat

The product should feel like a continuous rider journey, not a collection of disconnected tools.

---

## The Three-Layer Progression Model

Every milestone connects three layers. This model is the architectural skeleton of the entire product:

**Layer 1 — Biomechanics** (what the rider can directly control)
Lower leg stability, rein symmetry, core stability, upper body alignment, balance, symmetry

**Layer 2 — Riding Qualities** (what a judge or trainer sees)
Rhythm, balance, contact, impulsion, straightness, collection

**Layer 3 — Performance Tasks** (what must be demonstrated)
20m circle, correct canter lead, flying change, specific test movements

This three-layer model must always be present in the Journey and Insights screens.

---

## Cadence — The AI Advisor

**Name:** Cadence
**Description:** "your intelligent riding advisor"
**Personality:** Ambient, contextual, elegant, warm, non-intrusive. Never feels like a generic chatbot.

**What makes Cadence different:**
Cadence builds longitudinal context — it knows this rider, this horse, and this moment in their development journey. Its guidance compounds in specificity and value with every ride. It doesn't just answer questions — it knows you.

**UI rules for Cadence:**
- Slate blue color: #6B7FA3
- Always labeled "AI insight" — never hidden
- Appears as ambient cards within context, never as interruptions
- Floating FAB button: bottom-right, 50px, dark background with champagne orb
- Slide-up drawer: 72% screen height, smooth ease-in-out animation
- Speaks in whispers — suggests, never announces

**Current state:** Mock keyword-matching in CadenceDrawer.tsx. Replace with real Claude API post-MVP.

---

## Navigation Structure

**Bottom nav (4 tabs):**
- Home
- Journey
- Rides
- Insights

**Cadence:** Persistent floating button (not a nav tab) — accessible from every screen

**Profile/Vault:** Top-right avatar icon — administrative, not developmental

---

## Screen Purposes

**Home** — "What should I do today?"
Daily briefing. Led by milestone progress ring (visual hero). Narrative: grounding → direction → AI interpretation → evidence → momentum.

**Journey** — "Where am I, and where am I going?"
Progression map, goals, milestones, readiness. Learning content embedded at the milestone level. Three-layer model visible per milestone.

**Rides** — "What happened, and what did I capture?"
Evidence capture and review. Ride log, notes, self-reflection, video upload, trainer feedback, ride history, ride detail.

**Insights** — "What is actually improving?"
Biomechanics trends, pattern detection, readiness signals, progress summaries. Feels like Oura — data that tells a story.

---

## Design DNA

**The philosophy:** "The ride is primary. Horsera is the quiet intelligence behind it."

**Feel:** Premium, warm, elegant, modern, athletic, equestrian without being traditional

**Inspirations:**
- Apple — clarity and hierarchy
- Oura — calm data presentation
- Arc Browser — thoughtful modern UX
- Hermès — luxury, material warmth, refined restraint

**Color palette:**
| Token | Hex | Use |
|-------|-----|-----|
| Parchment | #FAF7F3 | Primary background |
| Stone | #F0EBE4 | Secondary surfaces |
| Dusk | #1C1510 | Dark mode, video screens |
| Cognac | #8C5A3C | Brand primary, CTAs, active states |
| Cognac Light | #C2896A | Hover, secondary buttons |
| Champagne | #C9A96E | Working state, achievements |
| Cadence Blue | #6B7FA3 | All AI/Cadence elements |
| Progress Green | #7D9B76 | Mastered state, positive trends |
| Attention | #C4714A | Needs focus, alerts |
| Ink | #1A140E | Primary text |
| Ink Muted | #7A6B5D | Secondary text |
| Ink Subtle | #B5A898 | Placeholders, disabled |

**Typography:**
- Playfair Display — headings, emotional moments, milestone names
- DM Sans — all interface text, body, labels
- DM Mono — all numeric data, timestamps, metrics

**Milestone states:**
- `untouched` — empty circle, Stone border
- `working` — partial arc fill in Champagne, warm glow
- `mastered` — filled Cognac circle, checkmark

---

## Product Documents

Full source documents live in `_product-docs/`. Read these before making any product or design decisions:

- Product Strategy — full vision, pillars, competitive landscape
- Pitch and Description — elevator pitch, problem, solution
- Architecture — app structure and navigation decisions
- Biomechanics Metrics — the six metric groups and their definitions
- Progression Maps — Pony Club and USDF level structures
- Roadmap — phased feature plan

---

## V2 Features — Do Not Build Yet

These are planned but must not be built in MVP. Architecture must support them:

- **"Ride the Test" / "Judge's Eye"** — rider records a discipline-specific test, gets movement-by-movement judge-like feedback and readiness signal
- Trainer portal (trainers contribute feedback; full workflow is V2)
- Multi-horse profiles (MVP supports one horse)
- Competition management (full compliance layer is V2)
- Social / community features
- Sensor / GPS / wearable integration
- Multiple discipline tracks (MVP launches with Pony Club + USDF)

---

## Decision & Update Workflow

For any significant change — to docs, architecture, or product direction:
1. Discuss the change with Rossella first
2. Propose the specific wording, approach, or implementation
3. Wait for explicit approval ("go ahead", "yes", "looks good")
4. Only then make the change, commit, and push
5. Report back what was changed and why

**Autonomy rules:**
- ✅ Bug fixes and small UI improvements — autonomous, clear commit message
- ✅ Code refactoring that doesn't change behavior — autonomous
- ✅ Technical doc updates (architecture, roadmap) — autonomous with notification
- ⚠️ New features or screen changes — discuss first
- ⚠️ Product strategy or vision doc updates — always get approval
- ❌ Never change the core development loop or three-layer model without explicit discussion

---

## Document Update Protocol

When product decisions change, update the relevant file in `_product-docs/`:
- Product strategy or vision changes → update Product Strategy doc
- New features or scope changes → update Roadmap doc
- Architecture or navigation changes → update Architecture doc
- New biomechanics metrics → update Biomechanics Metrics doc

Commit message format for doc updates:
`docs: update [document name] — [what changed and why]`

---

## GitHub Workflow

```bash
git pull                    # Always pull before making changes
# make changes
git add .
git commit -m "[scope]: description of what changed and why"
git push
```

**Repository:** https://github.com/rossella-horsera/horsera-x-claude
**Branch:** main
**Lovable:** syncs automatically from main — changes appear in preview after push
