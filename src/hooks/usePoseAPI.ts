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
import type { VideoAnalysisResult, AnalysisStatus, TimestampedFrame } from './useVideoAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';
import { createVideoUploadUrl, POSE_API_BASE, uploadFileToSignedUrl } from '../lib/poseApi';

const POSE_API  = POSE_API_BASE;
const ENABLE_LEGACY_UPLOAD_FALLBACK = import.meta.env.VITE_POSE_API_LEGACY_UPLOAD_FALLBACK === '1';
const POLL_MS   = 3000;
const MAX_POLL  = 200; // 200 × 3s = 10 min max

// Always compress — iPhone 4K HEVC videos are massive. Anything under this
// tiny floor is left alone (already small enough to upload fast).
const COMPRESS_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB

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

// ── Client-side video compression via canvas + MediaRecorder ──────────────────
// - Scales to 720p max (never upscales)
// - Strips audio (pose analysis doesn't use it)
// - Re-encodes at 1.5 Mbps
// - Uses requestVideoFrameCallback where supported for frame-accurate capture
//
// Throws if the browser doesn't support MediaRecorder or no codec is available.
// onProgress receives 0-100 tracking the video's playthrough.
function compressVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ blob: Blob; filename: string }> {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined') {
      return reject(new Error('MediaRecorder not supported'));
    }

    // Pick the best supported output codec (H.264 MP4 first — widest compatibility)
    const mimeType = (
      ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8'] as const
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
      const outW  = Math.floor(w * scale / 2) * 2 || 2;
      const outH  = Math.floor(h * scale / 2) * 2 || 2;

      const canvas  = document.createElement('canvas');
      canvas.width  = outW;
      canvas.height = outH;
      const ctx     = canvas.getContext('2d', { alpha: false })!;

      // captureStream with explicit fps so MediaRecorder has a stable clock.
      // Audio track NOT included (captureStream doesn't add audio on its own).
      const stream   = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1_500_000, // 1.5 Mbps — good for 720p pose analysis
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      let stopped = false;
      const stopRecording = () => {
        if (stopped) return;
        stopped = true;
        try {
          ctx.drawImage(video, 0, 0, outW, outH);
        } catch {
          // Ignore final frame draw failures during recorder shutdown.
        }
        recorder.stop();
      };

      recorder.onstop = () => {
        cleanup();
        const baseName = file.name.replace(/\.[^.]+$/, '');
        resolve({ blob: new Blob(chunks, { type: mimeType }), filename: `${baseName}${ext}` });
      };
      recorder.onerror = () => { cleanup(); reject(new Error('MediaRecorder error during compression')); };

      // Use requestVideoFrameCallback when available (fires on every decoded frame)
      // Falls back to requestAnimationFrame (~60fps) for smoother draw than ontimeupdate (~4/sec).
      const hasRVFC = 'requestVideoFrameCallback' in video;
      const drawFrame = () => {
        if (stopped) return;
        ctx.drawImage(video, 0, 0, outW, outH);
        if (duration > 0) {
          onProgress(Math.min(99, Math.round((video.currentTime / duration) * 100)));
        }
        if (hasRVFC) {
          const rvfcVideo = video as HTMLVideoElement & {
            requestVideoFrameCallback?: (callback: () => void) => number;
          };
          rvfcVideo.requestVideoFrameCallback?.(drawFrame);
        } else {
          requestAnimationFrame(drawFrame);
        }
      };

      video.onended = stopRecording;
      recorder.start(250);
      drawFrame();
      video.play().catch(() => { cleanup(); reject(new Error('Video.play() failed during compression')); });
    };
  });
}

export function usePoseAPI(): {
  status:       AnalysisStatus;
  progress:     number;
  result:       VideoAnalysisResult | null;
  error:        string | null;
  analysisJobId: string | null;
  uploadedObjectPath: string | null;
  analyzeVideo: (file: File) => Promise<void>;
  reset:        () => void;
} {
  const [status,    setStatus]    = useState<AnalysisStatus>('idle');
  const [progress,  setProgress]  = useState(0);
  const [result,    setResult]    = useState<VideoAnalysisResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [uploadedObjectPath, setUploadedObjectPath] = useState<string | null>(null);

  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobUrlRef  = useRef<string>('');
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingBlobRevoke = useCallback(() => {
    if (revokeTimerRef.current) {
      clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = null;
    }
  }, []);

  const scheduleBlobUrlRevoke = useCallback((blobUrl?: string) => {
    if (!blobUrl) return;
    cancelPendingBlobRevoke();
    // Give React/router time to unmount the preview player before revoking the blob URL.
    revokeTimerRef.current = setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      if (blobUrlRef.current === blobUrl) {
        blobUrlRef.current = '';
      }
      revokeTimerRef.current = null;
    }, 5000);
  }, [cancelPendingBlobRevoke]);

  const analyzeVideo = useCallback(async (file: File) => {
    if (pollRef.current) clearInterval(pollRef.current);
    cancelPendingBlobRevoke();
    scheduleBlobUrlRevoke(blobUrlRef.current);

    setStatus('loading-model');
    setProgress(0);
    setError(null);
    setResult(null);
    setAnalysisJobId(null);
    setUploadedObjectPath(null);

    // Blob URL for immediate in-session video playback (no upload needed)
    const blobUrl = URL.createObjectURL(file);
    blobUrlRef.current = blobUrl;

    try {
      // ── 1. Upload directly — no client-side compression ────────────────────────
      // Server-side pipeline handles transcode + analysis in one pass.
      // Client compression was a real-time bottleneck (10-min video = 10-min wait).
      // Phase 1: upload original, let Cloud Run GPU decode.
      const uploadBlob: Blob = file;
      const uploadFilename   = file.name;
      const _benchStart = performance.now();
      const _bench = (label: string) => {
        const elapsed = ((performance.now() - _benchStart) / 1000).toFixed(1);
        console.info(`[Horsera bench] ${elapsed}s — ${label}`);
      };
      _bench(`start: ${(file.size / 1024 ** 2).toFixed(1)} MB, ${file.type}`);

      setProgress(10);

      // ── 2. Signed upload flow (URL request + direct storage upload) ───────────
      setStatus('extracting');
      _bench('upload: requesting signed URL');

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
        const signedUpload = await createVideoUploadUrl(
          uploadFilename,
          uploadBlob.type || 'video/mp4',
          uploadBlob.size,
        );
        setUploadedObjectPath(signedUpload.object_path);
        _bench('upload: signed URL received — starting GCS upload');
        await uploadFileToSignedUrl(uploadBlob, signedUpload, (pct) => {
          setProgress(10 + Math.round(pct * 8));
          if (pct === 1) _bench(`upload: GCS upload complete (${(uploadBlob.size / 1024 ** 2).toFixed(1)} MB sent)`);
        });

        _bench('analyze: submitting job');
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
        setAnalysisJobId(job_id);
      } catch (signedUploadErr) {
        if (!ENABLE_LEGACY_UPLOAD_FALLBACK) {
          throw signedUploadErr;
        }
        console.warn('[Horsera] Signed upload flow unavailable; falling back to legacy /analyze/video:', signedUploadErr);
        job_id = await uploadViaLegacyEndpoint();
        setAnalysisJobId(job_id);
      }

      setProgress(20);

      // ── 3. Poll for results (20→95%) ──────────────────────────────────────────
      _bench('poll: starting — job_id=' + job_id);
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
            _bench(`DONE: analysis complete after ${attempts} polls`);
            const r = job.result;

            const sampleIntervalSec = typeof r.sampleIntervalSec === 'number' ? r.sampleIntervalSec : undefined;
            const allFrames: TimestampedFrame[] = (r.framesData ?? []).map(
              (fd: {
                frame_time?: number;
                detected?: boolean;
                sample_index?: number;
                source_frame_index?: number;
                keypoints?: [number, number, number][] | null;
              }) => ({
                time: fd.frame_time ?? 0,
                detected: fd.detected,
                sampleIndex: fd.sample_index,
                sourceFrameIndex: fd.source_frame_index,
                sampleIntervalSec,
                frame: Array.isArray(fd.keypoints)
                  ? fd.keypoints.map(([x, y, conf]) => ({ x, y, score: conf }))
                  : null,
              })
            );
            const firstDetectedFrame = allFrames.find((frame) => Array.isArray(frame.frame));
            setResult({
              biometrics:       r.biometrics,
              insights:         toMovementInsights(r.insights ?? []),
              frameCount:       r.framesAnalyzed ?? 0,
              videoPlaybackUrl: blobUrl,
              bestMomentStart:  allFrames.length > 0 ? allFrames[0].time : 0,
              allFrames,
              thumbnailDataUrl: '',
              bestFrame:        firstDetectedFrame?.frame ?? null,
            });
            setProgress(100);
            setStatus('done');

          } else if (job.status === 'failed') {
            clearInterval(pollRef.current!);
            setStatus('error');
            setError(job.error || 'Analysis failed on the server — try again');
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
  }, [cancelPendingBlobRevoke, scheduleBlobUrlRevoke]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    scheduleBlobUrlRevoke(blobUrlRef.current);
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
    setAnalysisJobId(null);
    setUploadedObjectPath(null);
  }, [scheduleBlobUrlRevoke]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    scheduleBlobUrlRevoke(blobUrlRef.current);
  }, [scheduleBlobUrlRevoke]);

  return { status, progress, result, error, analysisJobId, uploadedObjectPath, analyzeVideo, reset };
}
