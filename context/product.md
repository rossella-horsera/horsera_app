# Horsera — Product Context

_Last updated: 2026-03-13_

## What Horsera Is

Horsera is the first AI-powered rider development platform. It closes the learning loop that has always been broken in equestrian training: effort resets instead of compounding. Riders can never clearly answer "Am I improving?" or "What should I focus on next?" — Horsera gives them an evidence-based answer.

## Core Problem

Rider development today is fragmented:
- Verbal trainer feedback gets lost
- Ride videos are scattered across apps
- Competition records live in separate systems
- Goals exist only in the rider's head

The learning loop never closes. Horsera fixes this with a longitudinal system of record that compounds over time.

## Four-Layer Architecture

1. **Capture** — Ride logging, video upload, self-reflection (voice or text)
2. **Analysis** — AI biomechanics via MoveNet Thunder pose estimation (20+ metrics)
3. **Intelligence (Cadence)** — AI advisor that contextualizes data over time, surfaces insights, answers "am I improving?"
4. **Progression** — Milestone framework anchored to equestrian standards (Pony Club / USDF-inspired)

## AI Advisors

- **Rides** — Focused on individual ride analysis and biomechanics feedback
- **Insights (Cadence)** — Longitudinal intelligence layer; contextualizes trends, readiness signals, and what to focus on next

## MVP Scope (Current)

### In scope
- Video upload + MoveNet biomechanics analysis
- Real-time score overlay on video playback (key biomechanics metrics shown as rider watches)
- Cadence AI advisor wired to real LLM (OpenAI) with rider context
- Simplified navigation: video-first flow
- Basic ride logging with focus areas
- Basic persistence via Firebase Auth + Firestore
- "Journey" shown as teaser/coming soon

### Deferred (V2+)
- Full progression milestone framework (requires equestrian expert input)
- Horse as first-class entity
- Trainer and barn multi-persona support
- Competition record integration

## Versioning Plan

- **V1 (current MVP)** — Rider-focused: video analysis + Cadence + ride logging
- **V2** — Progression framework + trainer persona
- **V3** — Horse as first-class entity, barn operations, multi-persona network effects

## Pricing (Planned)

| Tier | Monthly |
|------|---------|
| Riders | $8–15/mo |
| Trainers | $20–40/mo |
| Barns | $40–75/mo |

## Market

- 7–8M riders in the US
- $50B+ equestrian industry
- SOM: ~$4M–$28M ARR at 10–40% adoption of qualified US buyers
- Phase 4 ceiling: ~$52M–$78M+ ARR

## Competitors

| Competitor | Gap |
|------------|-----|
| Equilab | GPS/activity tracking only, no development loop |
| Ride iQ | Video lessons only, not personalized analysis |
| Ridely | Training diary, no AI or biomechanics |
| Ridesum | Trainer comms, not rider-centered |

None close the full development loop. Horsera's moat is the longitudinal system of record.

## Key Milestone

- User testing at barn: target before 2026-03-30
- YC application in progress
