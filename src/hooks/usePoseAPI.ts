// Horsera — usePoseAPI hook
// Wires the Horsera pose server pipeline.
//
// Flow:
//   1. Create blob URL immediately → video plays while analysis runs
//   2. Create ride_sessions row (no video_url yet)
//   3. Compress video in-browser (720p / 2 Mbps) via canvas+MediaRecorder
//      [progress 0→10%] — skipped for small files or unsupported browsers
//   4. Request signed upload URL + upload video directly to cloud storage
//      [progress 10→18%]
//   5. POST object path to /analyze/video/object
//   6. Poll GET /jobs/{job_id} every 3s              [progress 20→95%]
//   7. On complete: store result, mark done          [progress 100%]
//
// Storage upload is deferred to handleSaveSession in RidesPage.tsx —
// the user only pays the upload cost when they explicitly save the ride.
//
// Returns the same { status, progress, result, error, analyzeVideo, reset }
// shape as useVideoAnalysis so the rest of RidesPage.tsx is unchanged.

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../integrations/supabase/client';
import type { VideoAnalysisResult, AnalysisStatus, TimestampedFrame } from './useVideoAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';

const POSE_API  = import.meta.env.VITE_POSE_API_URL ?? 'https://horseraapp-production.up.railway.app';
const POLL_MS   = 3000;
const MAX_POLL  = 200; // 200 × 3s = 10 min max

// Only attempt compression for files above this threshold (smaller files upload fast as-is)
const COMPRESS_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

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

// ── Client-side video compression via canvas + MediaRecorder ─────────────────
// Scales to 720p max, re-encodes at ~2 Mbps.
// Throws if the browser doesn't support MediaRecorder or no codec is available.
// onProgress receives 0-100 as the source video plays through.
function compressVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ blob: Blob; filename: string }> {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined') {
      return reject(new Error('MediaRecorder not supported'));
    }

    // Pick the best supported output codec
    const mimeType = (
      ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'] as const
    ).find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      return reject(new Error('No supported MediaRecorder codec'));
    }

    const ext      = mimeType.startsWith('video/mp4') ? '.mp4' : '.webm';
    const srcUrl   = URL.createObjectURL(file);
    const video    = document.createElement('video');
    video.src      = srcUrl;
    video.muted    = true;
    video.playsInline = true;
    video.preload  = 'metadata';

    const cleanup = () => URL.revokeObjectURL(srcUrl);

    video.onerror = () => { cleanup(); reject(new Error('Failed to decode video for compression')); };

    video.onloadedmetadata = () => {
      const { videoWidth: w, videoHeight: h, duration } = video;

      // Scale to 1280×720 max — never upscale
      const scale = Math.min(1, 1280 / w, 720 / h);
      // Force even dimensions (required by most codecs)
      const outW  = Math.floor(w * scale / 2) * 2 || 2;
      const outH  = Math.floor(h * scale / 2) * 2 || 2;

      const canvas   = document.createElement('canvas');
      canvas.width   = outW;
      canvas.height  = outH;
      const ctx      = canvas.getContext('2d')!;

      const stream   = canvas.captureStream(25);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_000_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = () => {
        cleanup();
        const baseName = file.name.replace(/\.[^.]+$/, '');
        resolve({ blob: new Blob(chunks, { type: mimeType }), filename: `${baseName}${ext}` });
      };

      recorder.onerror = () => { cleanup(); reject(new Error('MediaRecorder error during compression')); };

      // Draw the current video frame to canvas whenever the time advances
      video.ontimeupdate = () => {
        ctx.drawImage(video, 0, 0, outW, outH);
        if (duration > 0) {
          onProgress(Math.min(99, Math.round((video.currentTime / duration) * 100)));
        }
      };

      video.onended = () => {
        ctx.drawImage(video, 0, 0, outW, outH); // flush last frame
        recorder.stop();
      };

      recorder.start(200); // emit data chunks every 200 ms
      video.play().catch(() => { cleanup(); reject(new Error('Video.play() failed during compression')); });
    };
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
      // Best-effort — silently skipped if unauthenticated (401) or Supabase unavailable.
      // Auth is not required for Railway analysis; we'll add auth gating later.
      let dbSessionId: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sess, error: sessErr } = await (supabase as any)
          .from('ride_sessions')
          .insert({ status: 'processing' })
          .select('id')
          .single();
        if (!sessErr) {
          dbSessionId = sess?.id ?? null;
          setSessionId(dbSessionId);
        }
      } catch { /* non-fatal — proceed to Railway upload regardless */ }

      // ── 2. Compress video (0→10%) ─────────────────────────────────────────────
      let uploadBlob: Blob = file;
      let uploadFilename   = file.name;

      if (file.size >= COMPRESS_THRESHOLD_BYTES) {
        setStatus('compressing');
        setProgress(0);
        try {
          const { blob, filename } = await compressVideo(file, (videoPct) => {
            // Map video's 0–100% playthrough → our 0–10% progress band
            setProgress(Math.round(videoPct / 10));
          });
          uploadBlob     = blob;
          uploadFilename = filename;
          console.info(
            `[Horsera] Compressed ${(file.size / 1024 ** 2).toFixed(1)} MB → ` +
            `${(blob.size / 1024 ** 2).toFixed(1)} MB (${filename})`
          );
        } catch (compressErr) {
          // Non-fatal — fall back to the original file
          console.warn('[Horsera] Compression skipped (falling back to original):', compressErr);
          uploadBlob     = file;
          uploadFilename = file.name;
        }
      }

      setProgress(10);

      // ── 3. Signed upload flow (URL request + direct storage upload) ───────────
      setStatus('extracting');

      const uploadViaLegacyEndpoint = async (): Promise<string> => {
        return await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.timeout = 10 * 60 * 1000; // 10 min hard limit
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress(10 + Math.round((e.loaded / e.total) * 8));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                if (!data.job_id) throw new Error('No job_id in response');
                resolve(data.job_id);
              } catch {
                reject(new Error('Unexpected response from Pose API'));
              }
            } else {
              reject(new Error(`Pose API ${xhr.status}: ${xhr.responseText || xhr.statusText}`));
            }
          };
          xhr.onerror = () => reject(new Error('Network error reaching the analysis server — check your connection'));
          xhr.ontimeout = () => reject(new Error('Upload timed out after 10 minutes — try a shorter or smaller clip'));
          xhr.open('POST', `${POSE_API}/analyze/video`);
          const formData = new FormData();
          formData.append('file', uploadBlob, uploadFilename);
          xhr.send(formData);
        });
      };

      let job_id: string;
      try {
        const signedUploadRes = await fetch(`${POSE_API}/uploads/video-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: uploadFilename,
            content_type: uploadBlob.type || 'video/mp4',
            size_bytes: uploadBlob.size,
          }),
        });
        if (!signedUploadRes.ok) {
          throw new Error(`Failed to create upload URL: ${signedUploadRes.status} ${signedUploadRes.statusText}`);
        }

        const signedUpload = await signedUploadRes.json() as {
          upload_url: string;
          object_path: string;
          required_headers?: Record<string, string>;
        };
        if (!signedUpload.upload_url || !signedUpload.object_path) {
          throw new Error('Invalid signed upload response from Pose API');
        }

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.timeout = 10 * 60 * 1000; // 10 min hard limit
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress(10 + Math.round((e.loaded / e.total) * 8));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed ${xhr.status}: ${xhr.responseText || xhr.statusText}`));
          };
          xhr.onerror = () => reject(new Error('Network error while uploading video to storage'));
          xhr.ontimeout = () => reject(new Error('Upload timed out after 10 minutes — try a shorter or smaller clip'));
          xhr.open('PUT', signedUpload.upload_url);
          if (signedUpload.required_headers) {
            Object.entries(signedUpload.required_headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
          } else if (uploadBlob.type) {
            xhr.setRequestHeader('Content-Type', uploadBlob.type);
          }
          xhr.send(uploadBlob);
        });

        const analyzeRes = await fetch(`${POSE_API}/analyze/video/object`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            object_path: signedUpload.object_path,
            filename: uploadFilename,
            size_mb: Number((uploadBlob.size / (1024 ** 2)).toFixed(1)),
          }),
        });
        if (!analyzeRes.ok) {
          const body = await analyzeRes.text();
          throw new Error(`Pose API ${analyzeRes.status}: ${body || analyzeRes.statusText}`);
        }
        const analyzePayload = await analyzeRes.json() as { job_id?: string };
        if (!analyzePayload.job_id) {
          throw new Error('No job_id in analyze response');
        }
        job_id = analyzePayload.job_id;
      } catch (signedUploadErr) {
        console.warn('[Horsera] Signed upload flow unavailable; falling back to legacy /analyze/video:', signedUploadErr);
        job_id = await uploadViaLegacyEndpoint();
      }

      setProgress(20);

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

      // ── 4. Poll for results (20→95%) ──────────────────────────────────────────
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
          console.log('[Horsera] poll job:', job);

          if (job.status === 'pending' || job.status === 'processing') {
            // Progress: 20% → 95% over ~80 poll cycles (~4 min)
            setProgress(Math.min(95, 20 + Math.round((attempts / 80) * 75)));
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

            const allFrames: TimestampedFrame[] = (r.framesData ?? []).map(
              (fd: { frame_time?: number; keypoints: [number, number, number][] }) => ({
                time:  fd.frame_time ?? 0,
                frame: fd.keypoints.map(([x, y, conf]) => ({ x, y, score: conf })),
              })
            );
            setResult({
              biometrics:       r.biometrics,
              insights:         toMovementInsights(r.insights ?? []),
              frameCount:       r.framesAnalyzed ?? 0,
              videoPlaybackUrl: blobUrl,
              bestMomentStart:  allFrames.length > 0 ? allFrames[0].time : 0,
              allFrames,
              thumbnailDataUrl: '',
              bestFrame:        allFrames.length > 0 ? allFrames[0].frame : null,
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
