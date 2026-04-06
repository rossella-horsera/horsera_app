import { useRef, useState, useEffect, useMemo } from 'react';

interface VideoWithSkeletonProps {
  videoUrl: string;
  keyframes: Array<{ time: number; frame: Array<{ x: number; y: number; score: number }> }>;
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

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Array<{ x: number; y: number; score: number }>,
  biometrics: VideoWithSkeletonProps['biometrics'],
  scaleX: number,
  scaleY: number,
  ghost: boolean,
) {
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
    ctx.moveTo(kpA.x * scaleX, kpA.y * scaleY);
    ctx.lineTo(kpB.x * scaleX, kpB.y * scaleY);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  keypoints.forEach((kp, idx) => {
    if (!kp || kp.score < MIN_CONF) return;
    const cx = kp.x * scaleX;
    const cy = kp.y * scaleY;
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

  // Fullscreen: request on the wrapper so skeleton + overlays stay visible.
  // Handles webkit-prefixed API for iOS Safari.
  const toggleFullscreen = () => {
    const el = wrapperRef.current as any;
    const doc = document as any;
    if (!el) return;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitCurrentFullScreenElement;
    if (isFs) {
      (doc.exitFullscreen || doc.webkitExitFullscreen || doc.webkitCancelFullScreen)?.call(doc);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen)?.call(el);
    }
  };

  useEffect(() => {
    const handler = () => {
      const doc = document as any;
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitCurrentFullScreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  const ghostFrame = useMemo(() => {
    if (!keyframes.length) return null;
    return keyframes.reduce((best, kf) => {
      const detected = kf.frame.filter(k => k.score > 0.3).length;
      const bestDetected = best.frame.filter(k => k.score > 0.3).length;
      return detected > bestDetected ? kf : best;
    }).frame;
  }, [keyframes]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !keyframes.length) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!keyframes.length) return;

      const t = video.currentTime;
      const closest = keyframes.reduce((best, kf) =>
        Math.abs(kf.time - t) < Math.abs(best.time - t) ? kf : best
      );

      const firstKp = closest.frame.find(k => k.score > 0.2);
      const isNormalized = firstKp ? (firstKp.x <= 1.5 && firstKp.y <= 1.5) : true;
      const scaleX = isNormalized ? canvas.width : 1;
      const scaleY = isNormalized ? canvas.height : 1;

      if (ghostOn && ghostFrame) {
        drawSkeleton(ctx, ghostFrame, biometrics, scaleX, scaleY, true);
      }

      drawSkeleton(ctx, closest.frame, biometrics, scaleX, scaleY, false);
    };

    video.addEventListener('timeupdate', draw);
    video.addEventListener('seeked', draw);
    video.addEventListener('loadeddata', draw);

    return () => {
      video.removeEventListener('timeupdate', draw);
      video.removeEventListener('seeked', draw);
      video.removeEventListener('loadeddata', draw);
    };
  }, [keyframes, ghostOn, ghostFrame, biometrics]);

  // No keyframes — plain video fallback
  if (!keyframes.length) {
    return (
      <video
        src={videoUrl}
        controls
        playsInline
        style={{ width: '100%', aspectRatio: '16/9', background: '#000', display: 'block' }}
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative', width: '100%',
        aspectRatio: isFullscreen ? undefined : '16/9',
        height: isFullscreen ? '100%' : undefined,
        background: '#000',
      }}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        playsInline
        controlsList="nodownload"
        // @ts-ignore — webkit-specific attribute for iOS Safari inline fullscreen
        webkit-playsinline="true"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: isFullscreen ? 'contain' : 'cover',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />

      {/* Color legend */}
      <div style={{
        position: 'absolute', top: 10, left: 12, zIndex: 10,
        background: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: '4px 12px',
        display: 'flex', gap: 12, fontSize: 10, fontWeight: 500,
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
          position: 'absolute', bottom: 56, left: 12, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 7,
          background: ghostOn ? 'rgba(160,200,255,0.18)' : 'rgba(0,0,0,0.55)',
          border: `1px solid ${ghostOn ? 'rgba(160,200,255,0.6)' : 'rgba(255,255,255,0.2)'}`,
          borderRadius: 20, padding: '5px 12px',
          color: ghostOn ? 'rgba(200,225,255,0.9)' : 'rgba(255,255,255,0.5)',
          fontSize: 11, fontWeight: 500, cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3,2" />
          <circle cx="6" cy="6" r="1.6" fill="currentColor" />
        </svg>
        {ghostOn ? 'Ghost On ✓' : 'Ghost Rider'}
      </button>
    </div>
  );
}
