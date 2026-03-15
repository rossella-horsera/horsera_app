# Horsera — Jobs to Be Done & User Journey Map

**Author:** Lauren (UX) + Ross (Product)
**Date:** 2026-03-13
**Status:** V1 — awaiting Rossella's review before any onboarding screens are designed

---

## What this document is

A Jobs-to-Be-Done map covering the full rider journey from first contact with Horsera through long-term habitual use. For each job, we define: what triggers it, what the rider is trying to accomplish, what they currently do (without Horsera), what Horsera does, and what gaps we have.

This document is the UX foundation before any new screens are designed.

---

## The Rider Mindset (Lauren's frame)

Riders don't think in features. They think in moments:

- "I just finished a ride and felt something click — I want to capture it"
- "My trainer said I need to work on my lower leg but I don't know if I'm improving"
- "My show is in 6 weeks — am I ready?"
- "I can't afford weekly lessons — I need to keep developing on my own"

Horsera's job is to be the intelligent presence that makes every one of these moments feel supported, not solo.

---

## Journey Map: 7 Stages

---

### Stage 1 — Discovery & Download

**Trigger:** A rider hears about Horsera from a trainer, friend, or social post. Or they're searching for something to help them develop between lessons.

**Job to be done:** "Help me understand if this app is for me — quickly."

**What they do today:** Search Instagram, ask their barn friends, browse the App Store. High trust in word-of-mouth (trainer recommendation = almost guaranteed download).

**What Horsera needs to deliver:**
- A clear value proposition visible before download: "Track your development, not just your rides"
- Social proof from riders at their level, not just champions
- Instant comprehension of what it does (30-second concept)

**Horsera's role:** First impression. Make the value unmistakable.

**Gaps / open questions:**
- How do we get trainer endorsements built into the distribution model?
- What is our App Store listing copy and screenshots? (Not yet designed)
- How do we communicate "AI advisor" without it sounding gimmicky?

---

### Stage 2 — First Open & Onboarding

**Trigger:** App downloads. The rider opens it for the first time, often within an hour of downloading.

**Job to be done:** "Place me correctly and show me something useful in under 2 minutes."

**What they do today:** Give up on confusing apps. Stay with generic note-taking (Notes app, a diary). Pay for lessons they can't afford more frequently.

**What Horsera needs to deliver:**
1. **Placement** — a 5–7 question conversational flow that places the rider at the right starting milestone. Questions drawn from Pony Club/USDF criteria. Facilitated by Cadence, not a form.
2. **Horse setup** — rider names their horse (creates emotional investment immediately)
3. **First goal** — rider selects their discipline and goal type (competition / experience / skill)
4. **First insight** — Cadence delivers a personalized opening observation: "Based on where you are, I'll be watching your lower leg stability. That's what unlocks rhythm at this level."

**Horsera's role:** Make the rider feel known before they've done anything.

**Key UX principle (Lauren):** Onboarding is not a form. It is a conversation. Cadence leads. The rider responds. By the end of the 90-second setup, the app knows their name, their horse, their level, and their goal. That is magic.

**Gaps / open questions:**
- The placement questions need to be authored from the Pony Club / USDF progression maps. Ross to do this as a separate deliverable.
- Video-assisted placement (optional): "Upload a short video clip and I'll refine your starting level." This is V1.5 — offer after initial placement, not as a blocker.
- How do we handle riders who don't know their level? Need a non-threatening path ("I'm not sure — help me figure it out").

---

### Stage 3 — First Ride Recorded (The Activation Moment)

**Trigger:** Rider has completed their first ride since downloading Horsera. They want to capture it.

**Job to be done:** "Record this ride while it's still fresh — and show me something useful from it."

**What they do today:** Nothing. Or they write a note in Notes app. The feeling of the ride fades in hours.

**What Horsera needs to deliver:**
1. **Fast record flow** — under 60 seconds to log a ride: type, duration, focus, reflection (optional), video (optional)
2. **Immediate feedback** — even without video, Cadence can respond to the reflection text with a relevant observation
3. **Progress signal** — the rider's milestone ring moves, even slightly. They feel: "that ride counted."

**This is the moment Horsera becomes real.** If the first ride record feels meaningful, the rider comes back. If it feels like filling out a form, they don't.

**Horsera's role:** Make recording feel like talking to a trainer who listens.

**Gaps:**
- The reflection text field needs to feel like a conversation, not a textarea. Placeholder copy matters: "How did it feel?" not "Enter reflection".
- Cadence's immediate response to a reflection (even without video) is not yet implemented. V1.5 with real API.

---

### Stage 4 — Regular Use Loop (Weekly/Daily Habit)

**Trigger:** After 3–5 rides, the rider has established enough data to see a pattern. Horsera becomes a regular check-in.

**Job to be done:** "Show me if I'm actually improving — and what to do next."

**What they do today:** Try to remember how last week felt. Ask their trainer at the next lesson. Often feel they're working hard but not making progress (invisible progress problem).

**What Horsera needs to deliver:**

**Before the ride (briefing):**
- Home screen = "What should I do today?" — current milestone, key exercise, Cadence's observation
- One clear focus, not a list of tasks

**After the ride (capture):**
- Fast record with Cadence response
- Progress ring visibly moves

**Between rides (reflection):**
- Insights screen shows trends that matter ("your lower leg has improved 12pts in 3 weeks")
- Pattern detection: "You always improve in the second half of your rides — try a longer warm-up"
- Cadence available for questions any time

**The habit trigger (Lauren's insight):** Riders open the app when they feel either proud or confused. We need to serve both states:
- **Pride:** "Look how far I've come" → Journey view + progress rings
- **Confusion:** "What's wrong and what do I do?" → Cadence conversation

**Horsera's role:** Invisible coach between lessons. Always there. Never nagging.

**Gaps:**
- Push notifications are not implemented (V1.5). Currently no "come back" trigger.
- Cadence is still mock keyword-matching. Real API is the unlock for this stage.
- The "briefing" on Home is partially implemented but doesn't yet feel like a coach handoff — it feels like a dashboard.

---

### Stage 5 — Progress Milestones (Achievement Moments)

**Trigger:** A skill ring reaches Mastered status, or a level is completed.

**Job to be done:** "Acknowledge what I've achieved — and show me what comes next."

**What they do today:** Nothing marks the moment. Progress is invisible. Riders often don't know they've advanced.

**What Horsera needs to deliver:**
1. **Mastery moment** — a celebratory visual when a milestone is mastered (not a notification, a beautiful in-app moment)
2. **Next step** — immediately surfaces the next milestone so momentum continues
3. **Cadence acknowledgment** — personalized, warm: "You've mastered your lower leg stability at Training Level — that's the foundation of everything that comes next."

**Horsera's role:** Make invisible progress visible and emotionally resonant.

**Gaps:**
- No mastery celebration animation yet. V1.5.
- No automatic "next milestone" surfacing. V1.5.
- Cadence acknowledgment not yet triggered by state changes. V1.5.

---

### Stage 6 — Trainer Interaction

**Trigger:** Rider has a lesson, or wants to share their development data with their trainer.

**Job to be done:** "Make my trainer's feedback part of my development record — and let them see how I'm doing."

**What they do today:** Trainer gives verbal feedback at the end of a lesson. Rider tries to remember it. It fades. There's no continuity between lessons.

**What Horsera needs to deliver (V1.5 — link-based):**
1. Rider taps "Invite trainer feedback" on any ride
2. A unique short link is generated
3. Rider texts/emails the link to their trainer
4. Trainer opens link → sees the ride data → submits text feedback
5. Feedback appears on the rider's Ride Detail, referenced by Cadence

**What Horsera delivers (V2 — trainer portal):**
- Trainer has own account
- Can proactively add feedback to any of their riders' sessions
- Can see all their riders' development data
- Gets notified when a rider has a new ride

**Horsera's role:** The bridge between lesson and practice. Make trainer feedback persistent.

**Gaps:**
- V1.5 trainer link flow not yet built (card created)
- Trainer portal is firmly V2 — do not scope now

---

### Stage 7 — Competition Preparation

**Trigger:** A competition is 4–8 weeks away. The rider needs to know if they're ready and what to prioritize.

**Job to be done:** "Tell me honestly whether I'm ready — and help me use my remaining practice time well."

**What they do today:** Ask their trainer (if they have one). Ride the test from memory. Hope for the best. Often over-prepare some movements and ignore others.

**What Horsera needs to deliver:**
1. **Readiness signal** — "Development Readiness" score in context: "You're 73% ready for your First Level test. Your strongest area is rhythm. Your biggest gap is contact — specifically rein steadiness at the canter transition."
2. **Prioritized practice plan** — "You have 5 weeks. Focus these next 3 sessions on canter transitions. Then revisit."
3. **Ride the Test (V2)** — record a full test run, get a judge's-eye breakdown of each movement
4. **Show prep checklist** — Journey screen already shows this. It needs to be data-connected (not hardcoded).

**Horsera's role:** The honest, data-backed coach who tells you the truth with kindness.

**Gaps:**
- Show prep checklist is currently hardcoded mock data — needs to be connected to actual milestone progress
- "Ride the Test" is V2 — architecture ready (locked card in Journey)
- Competition entry / logistics management is firmly out of scope for MVP

---

## Identified Gaps (Summary for Prioritization)

### Must fix before first real users (MVP blockers):
- [ ] Onboarding flow — no placement, no horse name, no first goal setup
- [ ] Video upload — broken (fixed this session)
- [ ] Add Goal — broken (fixed this session)
- [ ] Cadence is mock — riders who try to ask real questions will feel misled

### V1.5 (next sprint):
- [ ] Real Cadence API (claude-haiku-3 with rider context in system prompt)
- [ ] Trainer feedback link
- [ ] Placement question set authored from progression maps
- [ ] Push notifications (basic ride reminder)
- [ ] Mastery celebration moment
- [ ] Settings screen (horse profile, rider profile)

### V2 (don't design yet):
- [ ] Full trainer portal
- [ ] Ride the Test / Judge's Eye
- [ ] Multi-horse profiles
- [ ] Social / community features

---

## Open Questions for Rossella

1. **Placement:** Do we want Cadence to facilitate the placement conversation, or is a more structured quiz acceptable for V1? (Ross recommends: Cadence facilitates — higher trust, more distinctive)

2. **Onboarding gate:** Does the rider see any of the app before completing placement? Or is placement a required first step? (Ross recommends: show the full app in a "demo mode" for 1 ride, then prompt placement — reduces friction)

3. **Trainer distribution:** Is there a specific trainer community we should target for early adoption? Trainer-led distribution (trainer recommends Horsera to students) is the highest-conversion channel.

---

*Authored by Lauren (UX journey, rider empathy) and Ross (JTBD framework, product layer)*
*This document should be reviewed by Rossella before any onboarding screens are designed.*
