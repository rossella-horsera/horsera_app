# Horsera - Product Context

_Last updated: 2026-04-26_

Horsera is an AI-powered rider development platform. It closes the learning loop in equestrian training by helping riders preserve ride evidence, understand position and riding-quality patterns, and decide what to focus on next.

## Product Model

The intended product model is:

```txt
Rider biomechanics -> riding quality -> tasks -> levels -> progression guidance
```

The implemented runtime is currently strongest at:

```txt
upload ride video -> analyze pose/keyframes -> save ride -> review playback, scores, insights, trends
```

That difference matters: the shipped app is still ride/session-centric, while the long-term product should become progression-engine-centric.

## Current Product Surface

- Ride upload and cloud pose analysis.
- Saved rides with metadata, scores, insights, keyframes, and playback URLs.
- Ride detail playback and progress views over saved rides.
- Journey/progression views driven by static definitions and heuristics.
- Cadence assistant drawer with browser-side model access when configured.

## Deferred Or Incomplete

- First-class progression engine: tasks, levels, evidence, assessments, recommendations.
- Server-owned Cadence backend.
- Cross-device account recovery beyond anonymous Firebase auth.
- Trainer portal and multi-user/barn workflows.
- Horse as a first-class multi-horse entity.
- Competition record integrations.

## Current Product Risk

The app can appear more progression-complete than the runtime data model really is. Future product work should move readiness, evidence, tasks, and levels into canonical domain models instead of continuing to grow page-level heuristics.
