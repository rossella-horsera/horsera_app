// Horsera — usePoseAPI hook
// Wires the Railway YOLOv8s-pose server pipeline.
//
// Flow:
//   1. Create blob URL immediately → video plays while analysis runs
//   2. Create ride_sessions row (no video_url yet)
//   3. POST video to Railway /analyze/video → job_id  [progress 0→10%]
//   4. Poll GET /jobs/{job_id} every 3s              [progress 10→95%]
//   5. On complete: store result, mark done          [progress 100%]
//
// Storage upload is deferred to handleSaveSession in RidesPage.tsx —
// the user only pays the upload cost when they explicitly save the ride.
//
// Returns the same { status, progress, result, error, analyzeVideo, reset }
// shape as useVideoAnalysis so the rest of RidesPage.tsx is unchanged.

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../integrations/supabase/client';
import type { VideoAnalysisResult, AnalysisStatus } from './useVideoAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';

const POSE_API  = 'https://horseraapp-production.up.railway.app';
const POLL_MS   = 3000;
const MAX_POLL  = 200; // 200 × 3s = 10 min max

// ── Convert plain-text insight strings → MovementInsight objects ──────────────
function toMovementInsights(texts: string[]): MovementInsight[] {
  const palette = [
    { icon: '↑', iconColor: '#7D9B76', trendColor: '#7D9B76', trend: 'strength'  },
    { icon: '→', iconColor: '#C9A96E', trendColor: '#C9A96E', trend: 'consistent'},
    { icon: '↓', iconColor: '#C4714A', trendColor: '#C4714A', trend: 'focus'     },
    { icon: '◎', iconColor: '#6B7FA3', trendColor: '#6B7FA3', trend: 'note'      },
  ];
  return texts.map((text, i) => {
    let slot = i % palette.length;
    const lower = text.toLowerCase();
    if (lower.includes('strong') || lower.includes('excellent') || lower.includes('build on')) slot = 0;
    else if (lower.includes('attention') || lower.includes('focus') || lower.includes('needs')) slot = 2;
    else if (lower.includes('angle') || lower.includes('approximate') || lower.includes('confidence')) slot = 3;
    const { icon, iconColor, trend, trendColor } = palette[slot];
    const metricMatch = text.match(/^([A-Z][a-z]+(?: [a-z]+)?)/);
    const metric = metricMatch ? metricMatch[1] : 'Analysis';
    return { metric, quality: slot === 0 ? 'good' : slot === 2 ? 'poor' : 'moderate', icon, iconColor, trend, trendColor, text };
  });
}

export function usePoseAPI(): {
  status:       AnalysisStatus;
  progress:     number;
  result:       VideoAnalysisResult | null;
  error:        string | null;
  sessionId:    string | null;
  analyzeVideo: (file: File) => Promise<void>;
  reset:        () => void;
} {
  const [status,    setStatus]    = useState<AnalysisStatus>('idle');
  const [progress,  setProgress]  = useState(0);
  const [result,    setResult]    = useState<VideoAnalysisResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobUrlRef  = useRef<string>('');

  const analyzeVideo = useCallback(async (file: File) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

    setStatus('loading-model');
    setProgress(0);
    setError(null);
    setResult(null);
    setSessionId(null);

    // Blob URL for immediate in-session video playback (no upload needed)
    const blobUrl = URL.createObjectURL(file);
    blobUrlRef.current = blobUrl;

    try {
      // ── 1. Create ride_sessions row (no video_url yet) ───────────────────────
      let dbSessionId: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sess, error: sessErr } = await (supabase as any)
          .from('ride_sessions')
          .insert({ status: 'processing' })
          .select('id')
          .single();
        if (sessErr) throw sessErr;
        dbSessionId = sess?.id ?? null;
        setSessionId(dbSessionId);
      } catch (dbErr) {
        console.warn('[Horsera] ride_sessions insert skipped:', dbErr);
      }

      // ── 2. POST video to Railway API ─────────────────────────────────────────
      setStatus('extracting');
      setProgress(3);

      const formData = new FormData();
      formData.append('file', file);

      const apiRes = await fetch(`${POSE_API}/analyze/video`, {
        method: 'POST',
        body: formData,
      });

      if (!apiRes.ok) {
        const body = await apiRes.text().catch(() => '');
        throw new Error(`Pose API ${apiRes.status}: ${body || apiRes.statusText}`);
      }

      const { job_id } = await apiRes.json();
      setProgress(10);

      // Store job_id on ride_sessions row
      if (dbSessionId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('ride_sessions')
            .update({ job_id })
            .eq('id', dbSessionId);
        } catch { /* non-fatal */ }
      }

      // ── 3. Poll for results ──────────────────────────────────────────────────
      setStatus('processing');
      let attempts = 0;

      pollRef.current = setInterval(async () => {
        attempts++;

        if (attempts > MAX_POLL) {
          clearInterval(pollRef.current!);
          setStatus('error');
          setError('Analysis timed out — try a shorter clip (under 10 minutes)');
          return;
        }

        try {
          const pollRes = await fetch(`${POSE_API}/jobs/${job_id}`);
          if (!pollRes.ok) return; // transient error, keep polling
          const job = await pollRes.json();

          if (job.status === 'pending' || job.status === 'processing') {
            // Progress: 10% → 95% over ~80 poll cycles (~4 min)
            setProgress(Math.min(95, 10 + Math.round((attempts / 80) * 85)));
            return;
          }

          if (job.status === 'complete') {
            clearInterval(pollRef.current!);
            const r = job.result;

            // Update ride_sessions with scores (video_url added on Save Ride)
            if (dbSessionId) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any)
                  .from('ride_sessions')
                  .update({
                    status:         'complete',
                    overall_score:  r.overallScore,
                    detection_rate: r.detectionRate,
                    biometrics:     r.biometrics,
                    riding_quality: r.ridingQuality,
                    insights:       r.insights,
                  })
                  .eq('id', dbSessionId);
              } catch { /* non-fatal */ }
            }

            setResult({
              biometrics:       r.biometrics,
              insights:         toMovementInsights(r.insights ?? []),
              frameCount:       r.framesAnalyzed ?? 0,
              videoPlaybackUrl: blobUrl,
              bestMomentStart:  0,
              allFrames:        [],
              thumbnailDataUrl: '',
              bestFrame:        null,
            });
            setProgress(100);
            setStatus('done');

          } else if (job.status === 'failed') {
            clearInterval(pollRef.current!);
            setStatus('error');
            setError(job.error || 'Analysis failed on the server — try again');
            if (dbSessionId) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any)
                  .from('ride_sessions')
                  .update({ status: 'failed' })
                  .eq('id', dbSessionId);
              } catch { /* non-fatal */ }
            }
          }
        } catch (pollErr) {
          console.warn('[Horsera] Poll error (will retry):', pollErr);
        }
      }, POLL_MS);

    } catch (err) {
      console.error('[Horsera] usePoseAPI error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Analysis failed — please try again');
    }
  }, []);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = ''; }
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
    setSessionId(null);
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  return { status, progress, result, error, sessionId, analyzeVideo, reset };
}
