// Horsera — useVideoAnalysis hook
// Loads MoveNet Thunder dynamically, extracts pose frames from an uploaded video,
// computes biomechanics metrics, and finds the best-moment clip for display.
// Falls back to mock analysis when TF.js is unavailable (e.g. production bundle).

import { useState, useCallback, useRef } from 'react';
import {
  computeBiometricsFromFrames,
  generateInsights,
  findBestMomentTimestamp,
} from '../lib/poseAnalysis';
import type { PoseFrame, MovementInsight } from '../lib/poseAnalysis';
import type { BiometricsSnapshot } from '../data/mock';

export interface TimestampedFrame {
  time:  number;    // seconds into the video
  frame: PoseFrame; // normalized keypoints (x, y 0–1)
}

export interface VideoAnalysisResult {
  biometrics:        BiometricsSnapshot;
  insights:          MovementInsight[];
  frameCount:        number;

  // Video playback — show the actual clip with skeleton overlay
  videoPlaybackUrl:  string;          // blob URL — callers must revoke on unmount
  bestMomentStart:   number;          // start of 6s clip to show (seconds)
  allFrames:         TimestampedFrame[]; // all sampled keypoints for skeleton overlay

  // Static thumbnail fallback (if video playback is blocked)
  thumbnailDataUrl:  string;
  bestFrame:         PoseFrame | null;

  // Whether this is a demo analysis (TF.js unavailable)
  isDemo?:           boolean;
}

export type AnalysisStatus =
  | 'idle'
  | 'loading-model'
  | 'extracting'
  | 'processing'
  | 'done'
  | 'error';

const SAMPLE_INTERVAL_SEC = 5;
const MAX_FRAMES          = 600;

// Generate synthetic PoseFrame data for demo mode
function generateSyntheticFrames(count: number, duration: number): { allFrames: TimestampedFrame[]; frameKps: PoseFrame[] } {
  const allFrames: TimestampedFrame[] = [];
  const frameKps: PoseFrame[] = [];
  const interval = duration / count;

  for (let i = 0; i < count; i++) {
    const time = i * interval;
    // Create a realistic-looking pose with 17 MoveNet keypoints
    // Simulating a rider in side view with natural variation
    const variance = () => (Math.random() - 0.5) * 0.02;
    const kps: PoseFrame = [
      { x: 0.50 + variance(), y: 0.10 + variance(), score: 0.92 }, // nose
      { x: 0.49 + variance(), y: 0.08 + variance(), score: 0.88 }, // left eye
      { x: 0.51 + variance(), y: 0.08 + variance(), score: 0.88 }, // right eye
      { x: 0.48 + variance(), y: 0.09 + variance(), score: 0.75 }, // left ear
      { x: 0.52 + variance(), y: 0.09 + variance(), score: 0.75 }, // right ear
      { x: 0.44 + variance(), y: 0.22 + variance(), score: 0.90 }, // left shoulder
      { x: 0.56 + variance(), y: 0.22 + variance(), score: 0.90 }, // right shoulder
      { x: 0.38 + variance(), y: 0.35 + variance(), score: 0.85 }, // left elbow
      { x: 0.62 + variance(), y: 0.35 + variance(), score: 0.85 }, // right elbow
      { x: 0.42 + variance(), y: 0.45 + variance(), score: 0.82 }, // left wrist
      { x: 0.58 + variance(), y: 0.45 + variance(), score: 0.82 }, // right wrist
      { x: 0.46 + variance(), y: 0.48 + variance(), score: 0.88 }, // left hip
      { x: 0.54 + variance(), y: 0.48 + variance(), score: 0.88 }, // right hip
      { x: 0.44 + variance(), y: 0.65 + variance(), score: 0.80 }, // left knee
      { x: 0.56 + variance(), y: 0.65 + variance(), score: 0.80 }, // right knee
      { x: 0.43 + variance(), y: 0.82 + variance(), score: 0.78 }, // left ankle
      { x: 0.57 + variance(), y: 0.82 + variance(), score: 0.78 }, // right ankle
    ];
    allFrames.push({ time, frame: kps });
    frameKps.push(kps);
  }
  return { allFrames, frameKps };
}

export function useVideoAnalysis(previousBiometrics?: BiometricsSnapshot) {
  const [status,   setStatus]   = useState<AnalysisStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [result,   setResult]   = useState<VideoAnalysisResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const detectorRef = useRef<{
    estimatePoses: (input: HTMLCanvasElement) => Promise<{
      keypoints: Array<{ x: number; y: number; score?: number }>;
    }[]>;
  } | null>(null);

  // Track previous blob URL so we can revoke it when analysis restarts
  const prevPlaybackUrlRef = useRef<string>('');

  const analyzeVideo = useCallback(async (file: File) => {
    // Revoke previous blob URL to free memory
    if (prevPlaybackUrlRef.current) {
      URL.revokeObjectURL(prevPlaybackUrlRef.current);
      prevPlaybackUrlRef.current = '';
    }

    setStatus('loading-model');
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      // Create blob URL for video playback (needed for both real and demo modes)
      const videoPlaybackUrl = URL.createObjectURL(file);
      prevPlaybackUrlRef.current = videoPlaybackUrl;

      // Load video to get duration and thumbnail
      const video = document.createElement('video');
      video.src = videoPlaybackUrl;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Could not read video file. Supported formats: MP4, MOV.'));
        setTimeout(() => reject(new Error('Video load timed out. Try a shorter clip.')), 30_000);
      });

      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        throw new Error('Video duration could not be determined. Try re-saving the file.');
      }

      // ── Try to load TF.js + MoveNet ──────────────────────────────────
      let tfAvailable = false;
      try {
        const [poseDetection, tfCore] = await Promise.all([
          import('@tensorflow-models/pose-detection'),
          import('@tensorflow/tfjs'),
        ]);
        await (tfCore as { ready: () => Promise<void> }).ready();

        if (!detectorRef.current) {
          const model = (poseDetection as {
            SupportedModels: { MoveNet: string };
            movenet: { modelType: { SINGLEPOSE_THUNDER: string } };
            createDetector: (model: string, config: object) => Promise<typeof detectorRef.current>;
          });
          detectorRef.current = await model.createDetector(
            model.SupportedModels.MoveNet,
            { modelType: model.movenet.modelType.SINGLEPOSE_THUNDER }
          );
        }
        tfAvailable = true;
      } catch {
        // TF.js not available — will use demo mode
        console.log('[Horsera] TF.js unavailable, using demo analysis mode');
        tfAvailable = false;
      }

      if (tfAvailable && detectorRef.current) {
        // ── REAL ANALYSIS MODE ──────────────────────────────────────────
        setStatus('extracting');

        const totalSamples = Math.min(Math.floor(duration / SAMPLE_INTERVAL_SEC), MAX_FRAMES);
        const actualInterval = duration / totalSamples;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = Math.max(1, Math.round(256 * video.videoHeight / video.videoWidth));
        const ctx = canvas.getContext('2d')!;

        const allFrames: TimestampedFrame[] = [];
        const frameKps: PoseFrame[] = [];
        let thumbnailDataUrl = '';

        for (let i = 0; i < totalSamples; i++) {
          const seekTime = i * actualInterval;
          video.currentTime = seekTime;

          await new Promise<void>(resolve => {
            const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
            video.addEventListener('seeked', onSeeked);
            setTimeout(resolve, 800);
          });

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setStatus('processing');

          const poses = await detectorRef.current!.estimatePoses(canvas);
          if (poses.length > 0) {
            const kps: PoseFrame = poses[0].keypoints.map(kp => ({
              x: kp.x / canvas.width,
              y: kp.y / canvas.height,
              score: kp.score ?? 0,
            }));
            allFrames.push({ time: seekTime, frame: kps });
            frameKps.push(kps);

            if (i === Math.floor(totalSamples * 0.2)) {
              thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.80);
            }
          }
          setProgress(Math.round(((i + 1) / totalSamples) * 100));
        }

        const timestamps = allFrames.map(f => f.time);
        const rawBestTime = findBestMomentTimestamp(frameKps, timestamps, 15);
        const bestMomentStart = Math.max(0, rawBestTime - 2);

        const bestFrameEntry = allFrames.reduce((closest, f) =>
          Math.abs(f.time - rawBestTime) < Math.abs(closest.time - rawBestTime) ? f : closest,
          allFrames[0]
        );

        const biometrics = computeBiometricsFromFrames(frameKps);
        const insights = generateInsights(biometrics, previousBiometrics);

        setResult({
          biometrics,
          insights,
          frameCount: allFrames.length,
          videoPlaybackUrl,
          bestMomentStart,
          allFrames,
          thumbnailDataUrl,
          bestFrame: bestFrameEntry?.frame ?? null,
        });
      } else {
        // ── DEMO ANALYSIS MODE ──────────────────────────────────────────
        // TF.js unavailable — generate realistic mock data
        setStatus('extracting');

        // Simulate progress for a smooth UX
        const totalSteps = 10;
        for (let i = 0; i < totalSteps; i++) {
          await new Promise(r => setTimeout(r, 200));
          setProgress(Math.round(((i + 1) / totalSteps) * 50));
        }

        setStatus('processing');

        // Extract a thumbnail from the video
        let thumbnailDataUrl = '';
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth));
          const ctx = canvas.getContext('2d')!;

          video.currentTime = Math.min(duration * 0.2, 5);
          await new Promise<void>(resolve => {
            const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
            video.addEventListener('seeked', onSeeked);
            setTimeout(resolve, 2000);
          });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.80);
        } catch {
          // Thumbnail extraction failed, proceed without
        }

        // Generate synthetic frames
        const syntheticCount = Math.min(Math.floor(duration / SAMPLE_INTERVAL_SEC), 20);
        const { allFrames, frameKps } = generateSyntheticFrames(Math.max(5, syntheticCount), duration);

        // Simulate more progress
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 150));
          setProgress(50 + Math.round(((i + 1) / 5) * 50));
        }

        const biometrics = computeBiometricsFromFrames(frameKps);
        const insights = generateInsights(biometrics, previousBiometrics);

        const bestMomentStart = Math.max(0, duration * 0.3 - 2);
        const bestFrame = allFrames.length > 0 ? allFrames[Math.floor(allFrames.length * 0.3)]?.frame ?? null : null;

        setResult({
          biometrics,
          insights,
          frameCount: allFrames.length,
          videoPlaybackUrl,
          bestMomentStart,
          allFrames,
          thumbnailDataUrl,
          bestFrame,
          isDemo: true,
        });
      }

      setStatus('done');
      setProgress(100);
    } catch (err) {
      console.error('[Horsera] Video analysis error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed — please try again.');
      setStatus('error');
    }
  }, [previousBiometrics]);

  const reset = useCallback(() => {
    if (prevPlaybackUrlRef.current) {
      URL.revokeObjectURL(prevPlaybackUrlRef.current);
      prevPlaybackUrlRef.current = '';
    }
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
  }, []);

  return { status, progress, result, error, analyzeVideo, reset };
}
