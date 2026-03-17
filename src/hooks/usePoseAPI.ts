// Horsera — usePoseAPI hook
// Replaces useVideoAnalysis with the Railway YOLOv8s-pose server pipeline.
//
// Flow:
//   1. Upload video to Supabase Storage "ride-videos" bucket → permanent URL
//   2. Create ride_sessions row (status=processing)
//   3. POST to Railway /analyze/video → job_id
//   4. Update ride_sessions.job_id
//   5. Poll GET /jobs/{job_id} every 3s
//   6. On complete: update ride_sessions, resolve result
//
// Returns the same { status, progress, result, error, analyzeVideo, reset } shape
// as useVideoAnalysis so RidesPage.tsx needs minimal changes.
// Also returns sessionId for callers that need to update the row after save.

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../integrations/supabase/client';
import type { VideoAnalysisResult, AnalysisStatus } from './useVideoAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';

const POSE_API        = 'https://horseraapp-production.up.railway.app';
const POLL_MS         = 3000;
const MAX_POLL        = 200; // 200 × 3s = 10 min max

// ── Convert plain-text insight strings → MovementInsight objects ──────────────
// The server returns string[], but InsightsCard expects MovementInsight[].
// We assign visual properties based on content keywords.
function toMovementInsights(texts: string[]): MovementInsight[] {
  const palette = [
    { icon: '↑', iconColor: '#7D9B76', trendColor: '#7D9B76', trend: 'strength' },
    { icon: '→', iconColor: '#C9A96E', trendColor: '#C9A96E', trend: 'consistent' },
    { icon: '↓', iconColor: '#C4714A', trendColor: '#C4714A', trend: 'focus' },
    { icon: '◎', iconColor: '#6B7FA3', trendColor: '#6B7FA3', trend: 'note' },
  ];

  return texts.map((text, i) => {
    // Heuristic: pick colour based on tone keywords
    let slot = i % palette.length;
    const lower = text.toLowerCase();
    if (lower.includes('strong') || lower.includes('excellent') || lower.includes('build on')) slot = 0;
    else if (lower.includes('attention') || lower.includes('focus') || lower.includes('needs')) slot = 2;
    else if (lower.includes('angle') || lower.includes('approximate') || lower.includes('confidence')) slot = 3;

    const { icon, iconColor, trend, trendColor } = palette[slot];

    // Extract a short metric name from the text (first few words before any dash or comma)
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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analyzeVideo = useCallback(async (file: File) => {
    if (pollRef.current) clearInterval(pollRef.current);

    setStatus('loading-model');
    setProgress(0);
    setError(null);
    setResult(null);
    setSessionId(null);

    try {
      // ── 1. Upload to Supabase Storage ────────────────────────────────────────
      setStatus('extracting');
      setProgress(5);

      let videoUrl = '';
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      try {
        const { data: up, error: upErr } = await supabase.storage
          .from('ride-videos')
          .upload(safeName, file, { cacheControl: '3600', upsert: false });

        if (upErr) throw upErr;

        const { data: { publicUrl } } = supabase.storage
          .from('ride-videos')
          .getPublicUrl(up.path);

        videoUrl = publicUrl;
      } catch (storageErr) {
        // Storage bucket may not exist yet — fall back to a blob URL (session-only)
        console.warn('[Horsera] Storage upload skipped:', storageErr);
        videoUrl = URL.createObjectURL(file);
      }

      setProgress(20);

      // ── 2. Create ride_sessions row ──────────────────────────────────────────
      let dbSessionId: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sess, error: sessErr } = await (supabase as any)
          .from('ride_sessions')
          .insert({ video_url: videoUrl, status: 'processing' })
          .select('id')
          .single();

        if (sessErr) throw sessErr;
        dbSessionId = sess?.id ?? null;
        setSessionId(dbSessionId);
      } catch (dbErr) {
        console.warn('[Horsera] ride_sessions insert skipped:', dbErr);
      }

      setProgress(25);

      // ── 3. POST video to Railway API ─────────────────────────────────────────
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
      setProgress(30);

      // ── 4. Store job_id on ride_sessions row ─────────────────────────────────
      if (dbSessionId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('ride_sessions')
            .update({ job_id })
            .eq('id', dbSessionId);
        } catch { /* non-fatal */ }
      }

      // ── 5. Poll for results ──────────────────────────────────────────────────
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
          if (!pollRes.ok) return; // transient network error, keep polling
          const job = await pollRes.json();

          if (job.status === 'pending' || job.status === 'processing') {
            // Smooth progress: 30% → 92% over expected ~60 poll cycles (3 min)
            setProgress(Math.min(92, 30 + Math.round((attempts / 60) * 62)));
            return;
          }

          if (job.status === 'complete') {
            clearInterval(pollRef.current!);
            setProgress(100);
            const r = job.result;

            // ── 6. Update ride_sessions with summary ─────────────────────────
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

            // Map server result → VideoAnalysisResult shape expected by the UI
            setResult({
              biometrics:       r.biometrics,
              insights:         toMovementInsights(r.insights ?? []),
              frameCount:       r.framesAnalyzed ?? 0,
              videoPlaybackUrl: videoUrl,
              bestMomentStart:  0,
              allFrames:        [],
              thumbnailDataUrl: '',
              bestFrame:        null,
            });
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
      setError(err instanceof Error ? err.message : 'Upload or analysis failed — please try again');
    }
  }, []);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
    setSessionId(null);
  }, []);

  // Clean up polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return { status, progress, result, error, sessionId, analyzeVideo, reset };
}
