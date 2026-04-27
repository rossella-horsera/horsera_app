import { useRef, useState, useEffect, useMemo, type CSSProperties } from 'react';
import type { TimestampedFrame } from '../hooks/useVideoAnalysis';
import { hasPoseFrame, resolvePoseFrameAtTime } from '../lib/videoPlayback';

interface VideoWithSkeletonProps {
  videoUrl: string;
  keyframes: TimestampedFrame[];
  biometrics: {
    lowerLegStability: number;
    reinSteadiness: number;
    reinSymmetry: number;
    coreStability: number;
    upperBodyAlignment: number;
    pelvisStability: number;
  };
}

const CONNECTIONS = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [11, 12], [5, 11], [6, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [0, 5], [0, 6],
];

const MIN_CONF = 0.2;

const JOINT_METRIC: Record<number, keyof VideoWithSkeletonProps['biometrics']> = {
  0: 'upperBodyAlignment', 5: 'upperBodyAlignment', 6: 'upperBodyAlignment',
  7: 'reinSteadiness', 8: 'reinSteadiness',
  9: 'reinSymmetry', 10: 'reinSymmetry',
  11: 'pelvisStability', 12: 'pelvisStability',
  13: 'lowerLegStability', 14: 'lowerLegStability',
  15: 'lowerLegStability', 16: 'lowerLegStability',
};

function jointColor(idx: number, bm: VideoWithSkeletonProps['biometrics']): string {
  const score = bm[JOINT_METRIC[idx] ?? 'coreStability'] ?? 0;
  if (score >= 0.80) return '#5B9E56';
  if (score >= 0.60) return '#E8A857';
  return '#C14A2A';
}

function isNormalizedFrame(keypoints: Array<{ x: number; y: number; score: number }>): boolean {
  const firstKp = keypoints.find(k => k.score > 0.2);
  return firstKp ? (firstKp.x <= 1.5 && firstKp.y <= 1.5) : true;
}

function getVideoDrawRect(video: HTMLVideoElement, canvasWidth: number, canvasHeight: number) {
  const sourceWidth = Math.max(video.videoWidth || canvasWidth, 1);
  const sourceHeight = Math.max(video.videoHeight || canvasHeight, 1);
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
    sourceWidth,
    sourceHeight,
  };
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Array<{ x: number; y: number; score: number }>,
  biometrics: VideoWithSkeletonProps['biometrics'],
  drawRect: ReturnType<typeof getVideoDrawRect>,
  ghost: boolean,
) {
  const normalized = isNormalizedFrame(keypoints);
  const scaleX = normalized ? drawRect.width : (drawRect.width / drawRect.sourceWidth);
  const scaleY = normalized ? drawRect.height : (drawRect.height / drawRect.sourceHeight);
  const offsetX = drawRect.x;
  const offsetY = drawRect.y;

  ctx.lineWidth = ghost ? 1.5 : 3;

  CONNECTIONS.forEach(([a, b]) => {
    const kpA = keypoints[a];
    const kpB = keypoints[b];
    if (!kpA || !kpB || kpA.score < MIN_CONF || kpB.score < MIN_CONF) return;

    if (ghost) {
      ctx.strokeStyle = 'rgba(200, 220, 255, 0.55)';
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = jointColor(a, biometrics);
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(offsetX + (kpA.x * scaleX), offsetY + (kpA.y * scaleY));
    ctx.lineTo(offsetX + (kpB.x * scaleX), offsetY + (kpB.y * scaleY));
    ctx.stroke();
  });
  ctx.setLineDash([]);

  keypoints.forEach((kp, idx) => {
    if (!kp || kp.score < MIN_CONF) return;
    const cx = offsetX + (kp.x * scaleX);
    const cy = offsetY + (kp.y * scaleY);
    const r = ghost ? 3 : 5;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = ghost ? 'rgba(200,220,255,0.6)' : '#fff';
    ctx.fill();

    if (!ghost) {
      ctx.strokeStyle = jointColor(idx, biometrics);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

export default function VideoWithSkeleton({ videoUrl, keyframes, biometrics }: VideoWithSkeletonProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [ghostOn, setGhostOn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageAspectRatio, setStageAspectRatio] = useState(16 / 9);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);

  useEffect(() => {
    setStageAspectRatio(16 / 9);
  }, [videoUrl]);

  useEffect(() => {
    setFullscreenSupported(typeof document !== 'undefined');
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateAspectRatio = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setStageAspectRatio(video.videoWidth / video.videoHeight);
      }
    };

    video.addEventListener('loadedmetadata', updateAspectRatio);
    video.addEventListener('loadeddata', updateAspectRatio);
    updateAspectRatio();

    return () => {
      video.removeEventListener('loadedmetadata', updateAspectRatio);
      video.removeEventListener('loadeddata', updateAspectRatio);
    };
  }, [videoUrl]);

  // Fullscreen: request on the wrapper so skeleton + overlays stay visible.
  // Handles webkit-prefixed API for iOS Safari.
  const toggleFullscreen = () => {
    const el = wrapperRef.current as (HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      webkitEnterFullscreen?: () => Promise<void> | void;
    }) | null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitCurrentFullScreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitCancelFullScreen?: () => Promise<void> | void;
    };
    if (!el) return;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitCurrentFullScreenElement;
    if (!isFs && isFullscreen) {
      setIsFullscreen(false);
      return;
    }
    if (isFs) {
      (doc.exitFullscreen || doc.webkitExitFullscreen || doc.webkitCancelFullScreen)?.call(doc);
    } else {
      const requestFullscreen = el.requestFullscreen || el.webkitRequestFullscreen;
      if (requestFullscreen) {
        Promise.resolve(requestFullscreen.call(el)).catch(() => setIsFullscreen(true));
      } else {
        setIsFullscreen(true);
      }
    }
  };

  useEffect(() => {
    const handler = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitCurrentFullScreenElement?: Element | null;
      };
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitCurrentFullScreenElement));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const ghostFrame = useMemo(() => {
    const framesWithPose = keyframes.filter(hasPoseFrame);
    if (!framesWithPose.length) return null;
    return framesWithPose.reduce((best, kf) => {
      const detected = kf.frame.filter(k => k.score > 0.3).length;
      const bestDetected = best.frame.filter(k => k.score > 0.3).length;
      return detected > bestDetected ? kf : best;
    }).frame;
  }, [keyframes]);

  const inlineMaxStageHeight = 'min(78dvh, 860px)';
  const inlineStageWidth = `min(100%, calc(${inlineMaxStageHeight} * ${stageAspectRatio}))`;
  const overlayTop = isFullscreen ? 'calc(env(safe-area-inset-top, 0px) + 16px)' : 10;
  const overlayBottom = isFullscreen ? 'calc(env(safe-area-inset-bottom, 0px) + 18px)' : 56;
  const legendLeft = isFullscreen ? 'calc(env(safe-area-inset-left, 0px) + 16px)' : 12;
  const actionRight = isFullscreen ? 'calc(env(safe-area-inset-right, 0px) + 16px)' : 12;
  const actionButtonSize = isFullscreen ? 42 : 36;
  const actionButtonRadius = actionButtonSize / 2;
  const stageStyle: CSSProperties = {
    position: isFullscreen ? 'fixed' : 'relative',
    inset: isFullscreen ? 0 : undefined,
    zIndex: isFullscreen ? 9999 : undefined,
    width: isFullscreen ? '100vw' : inlineStageWidth,
    maxWidth: '100%',
    margin: isFullscreen ? undefined : '0 auto',
    aspectRatio: isFullscreen ? undefined : stageAspectRatio,
    height: isFullscreen ? '100dvh' : undefined,
    maxHeight: isFullscreen ? undefined : inlineMaxStageHeight,
    background: '#000',
    overflow: 'hidden',
    borderRadius: isFullscreen ? 0 : 18,
    boxShadow: isFullscreen ? 'none' : '0 16px 40px rgba(16, 10, 7, 0.18)',
  };
  const fullscreenButtonPosition: CSSProperties = isFullscreen
    ? { top: overlayTop, right: actionRight }
    : { bottom: overlayBottom, right: actionRight };
  const ghostButtonPosition: CSSProperties = isFullscreen
    ? { top: 'calc(env(safe-area-inset-top, 0px) + 64px)', right: actionRight }
    : { bottom: overlayBottom, left: 12 };

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!video || !canvas || !wrapper || !keyframes.length) return;

    let rafId: number | null = null;
    let videoFrameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const cancelScheduledDraw = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const videoWithCallback = video as HTMLVideoElement & {
        cancelVideoFrameCallback?: (handle: number) => void;
      };
      if (videoFrameId !== null && videoWithCallback.cancelVideoFrameCallback) {
        videoWithCallback.cancelVideoFrameCallback(videoFrameId);
        videoFrameId = null;
      }
    };

    const draw = (time = video.currentTime) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!keyframes.length) return;
      const drawRect = getVideoDrawRect(video, canvas.width, canvas.height);
      const activeFrame = resolvePoseFrameAtTime(keyframes, time);

      if (ghostOn && ghostFrame && activeFrame) {
        drawSkeleton(ctx, ghostFrame, biometrics, drawRect, true);
      }

      if (activeFrame) {
        drawSkeleton(ctx, activeFrame, biometrics, drawRect, false);
      }
    };

    const scheduleDraw = () => {
      cancelScheduledDraw();
      const videoWithCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      if (videoWithCallback.requestVideoFrameCallback) {
        videoFrameId = videoWithCallback.requestVideoFrameCallback(() => {
          videoFrameId = null;
          draw(video.currentTime);
          if (!video.paused && !video.ended) {
            scheduleDraw();
          }
        });
      } else {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          draw(video.currentTime);
          if (!video.paused && !video.ended) {
            scheduleDraw();
          }
        });
      }
    };

    const handlePlay = () => scheduleDraw();
    const handlePause = () => {
      cancelScheduledDraw();
      draw(video.currentTime);
    };
    const handleSeeked = () => draw(video.currentTime);
    const handleLoadedData = () => {
      draw(video.currentTime);
      if (!video.paused && !video.ended) {
        scheduleDraw();
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('loadedmetadata', handleLoadedData);

    const handleResize = () => draw(video.currentTime);
    window.addEventListener('resize', handleResize);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        draw(video.currentTime);
      });
      resizeObserver.observe(wrapper);
    }

    draw(video.currentTime);
    if (!video.paused && !video.ended) {
      scheduleDraw();
    }

    return () => {
      cancelScheduledDraw();
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('loadedmetadata', handleLoadedData);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [keyframes, ghostOn, ghostFrame, biometrics, isFullscreen]);

  // No keyframes — plain video fallback
  if (!keyframes.length) {
    return (
      <div
        ref={wrapperRef}
        style={stageStyle}
        onDoubleClick={toggleFullscreen}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          playsInline
          controlsList="nofullscreen nodownload"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            background: '#000',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: isFullscreen
              ? 'linear-gradient(180deg, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.14) 16%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 68%, rgba(0,0,0,0.16) 84%, rgba(0,0,0,0.48) 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.10) 16%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 72%, rgba(0,0,0,0.24) 100%)',
          }}
        />
        {fullscreenSupported ? (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            style={{
              position: 'absolute',
              zIndex: 10,
              width: actionButtonSize,
              height: actionButtonSize,
              borderRadius: actionButtonRadius,
              border: '1px solid rgba(255,255,255,0.22)',
              background: 'rgba(0,0,0,0.55)',
              color: 'rgba(255,255,255,0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              ...fullscreenButtonPosition,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {isFullscreen ? (
                <>
                  <path d="M9 15H5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 15h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 9H5V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 9h4V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <>
                  <path d="M9 3H5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 3h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 21H5v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 21h4v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
            </svg>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={stageStyle}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        playsInline
        controlsList="nofullscreen nodownload"
        // @ts-expect-error - webkit-specific attribute for iOS Safari inline fullscreen
        webkit-playsinline="true"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'contain',
          zIndex: 0,
        }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          pointerEvents: 'none',
          background: isFullscreen
            ? 'linear-gradient(180deg, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.14) 16%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 68%, rgba(0,0,0,0.16) 84%, rgba(0,0,0,0.48) 100%)'
            : 'linear-gradient(180deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.10) 16%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 72%, rgba(0,0,0,0.24) 100%)',
        }}
      />

      {/* Color legend */}
      <div style={{
        position: 'absolute', top: overlayTop, left: legendLeft, zIndex: 10,
        background: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: isFullscreen ? '8px 14px' : '4px 12px',
        display: 'flex', gap: isFullscreen ? 14 : 12, fontSize: isFullscreen ? 11 : 10, fontWeight: 500,
        maxWidth: isFullscreen ? 'min(calc(100% - 32px), 420px)' : 'calc(100% - 24px)',
        flexWrap: 'wrap',
        backdropFilter: 'blur(8px)',
      }}>
        {[
          { color: '#5B9E56', label: 'On target' },
          { color: '#E8A857', label: 'Working' },
          { color: '#C14A2A', label: 'Needs focus' },
        ].map(d => (
          <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>{d.label}</span>
          </span>
        ))}
      </div>

      {/* Ghost Rider toggle */}
      <button
        onClick={() => setGhostOn(g => !g)}
        style={{
          position: 'absolute',
          zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 7,
          background: ghostOn ? 'rgba(160,200,255,0.18)' : 'rgba(0,0,0,0.55)',
          border: `1px solid ${ghostOn ? 'rgba(160,200,255,0.6)' : 'rgba(255,255,255,0.2)'}`,
          borderRadius: 20, padding: isFullscreen ? '8px 14px' : '5px 12px',
          color: ghostOn ? 'rgba(200,225,255,0.9)' : 'rgba(255,255,255,0.5)',
          fontSize: isFullscreen ? 12 : 11, fontWeight: 500, cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          backdropFilter: 'blur(8px)',
          ...ghostButtonPosition,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3,2" />
          <circle cx="6" cy="6" r="1.6" fill="currentColor" />
        </svg>
        {ghostOn ? 'Ghost On ✓' : 'Ghost Rider'}
      </button>

      {fullscreenSupported ? (
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          style={{
            position: 'absolute',
            zIndex: 10,
            width: actionButtonSize,
            height: actionButtonSize,
            borderRadius: actionButtonRadius,
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'rgba(0,0,0,0.55)',
            color: 'rgba(255,255,255,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            ...fullscreenButtonPosition,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {isFullscreen ? (
              <>
                <path d="M9 15H5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 15h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 9H5V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 9h4V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <>
                <path d="M9 3H5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 3h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 21H5v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 21h4v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
          </svg>
        </button>
      ) : null}
    </div>
  );
}
