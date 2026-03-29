# Supabase to Firestore Migration Plan (Two-Phase, Decision-Complete)

## Summary
- Migrate active app runtime from Supabase to Firestore + Anonymous Firebase Auth.
- Persist `Past Rides` in Firestore, keep full skeleton overlay fidelity by storing keyframes in chunked subdocuments.
- Stop using Supabase Storage by reusing pose-uploaded GCS objects, pinning saved rides to a permanent prefix, and serving signed read URLs.
- Cut over with a fresh dataset: clear legacy local `horsera_rides` on first run after release (no backfill).
- Run a second cleanup phase to remove remaining non-runtime Supabase references across backend/infra/docs.

## Public Interfaces and Data Model Changes
- New frontend env vars:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_APP_ID`
- `StoredRide` schema additions:
  - `videoObjectPath?: string` (persistent GCS path for saved ride playback)
  - `poseJobId?: string`
  - `schemaVersion: 2`
- Firestore structure:
  - `users/{uid}/rides/{rideId}` for ride metadata and scores.
  - `users/{uid}/rides/{rideId}/keyframeChunks/{chunkId}` for full overlay data.
- Pose API additions:
  - `POST /videos/pin` to copy uploaded analysis video to permanent saved-rides location.
  - `POST /videos/read-url` to mint short-lived signed GET URL for playback.
- Frontend runtime API behavior:
  - `usePoseAPI` returns and propagates `job_id` + uploaded `object_path` through save flow.

## Implementation Changes
- Phase 1: Runtime migration.
- Add Firebase client integration + anonymous sign-in bootstrap at app start.
- Add a rides repository layer that reads/writes Firestore and mirrors a local cache for resilience.
- Replace Supabase writes in analysis/save flows:
  - Remove `ride_sessions` inserts/updates.
  - Remove Supabase storage upload-on-save.
  - Save flow now calls `/api/pose/videos/pin`, then writes ride + keyframe chunks to Firestore.
- Replace detail-page video replacement flow:
  - Upload via existing `/uploads/video-url`.
  - Pin with `/videos/pin`.
  - Update Firestore ride record.
- Playback flow:
  - On ride detail open, if `videoObjectPath` exists, request `/api/pose/videos/read-url` and stream via signed URL.
  - Refresh signed URL when expired.
- Preserve full overlay behavior:
  - Store keyframes in fixed chunks (100 frames/chunk) in subcollection docs.
  - Rehydrate chunks in ride detail before overlay render.
- Cutover logic:
  - On first launch of migration build, clear legacy `horsera_rides` and set `horsera_firestore_cutover_v1` flag.
- Phase 2: Repo-wide Supabase cleanup.
- Remove Supabase dependency and frontend integration folder.
- Remove Supabase fallback paths from pose API runtime and associated env usage.
- Remove legacy Supabase usage in unused Cadence backend files and infrastructure variables/secrets/docs.
- Delete stale Supabase functions/migrations folder if no runtime caller remains.

## Test Plan
- Unit tests:
  - Ride serialization/deserialization to Firestore docs.
  - Keyframe chunk split/reassemble fidelity.
  - Cutover flag behavior and legacy local clear.
- Integration tests:
  - `usePoseAPI` captures `object_path` and save flow pins video + persists ride.
  - Ride detail obtains signed read URL and refreshes after expiration.
- Manual acceptance scenarios:
  1. Upload, analyze, save ride, then see it in `Past Rides`.
  2. Reload app and confirm ride history restores from Firestore.
  3. Open saved ride and verify video + skeleton overlay both render.
  4. Replace video in ride detail and verify playback updates.
  5. Confirm no active Supabase runtime refs via `rg` in frontend runtime paths.
  6. Confirm old local ride history is cleared once at cutover.

## Assumptions and Defaults
- Anonymous Firebase Auth is enabled in the target Firebase project.
- Firestore security rules are user-scoped by `uid`.
- GCS keeps transient uploads short-lived, but pinned saved-ride objects are non-expiring.
- Start-fresh policy is intentional: no migration/import of prior local rides.
- Two-phase delivery is acceptable: runtime migration first, full repo cleanup second.
