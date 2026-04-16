// Horsera — VideoAnalysis component (full rebuild)
//
// Three issues addressed:
//   ISSUE 1: Full skeleton overlay — connected limb lines, Horsera colors, fixed confidence threshold
//   ISSUE 2: Rider Body Diagram ("The Rider Map") — warm, premium, unmistakably Horsera
//   ISSUE 3: Riding Quality panel — Layer 2 scores derived from biometrics
//
// Architecture: tabbed container
//   [Video frame — always shown]
//   [Tabs: Movement | Body Map | Quality]
//   [Tab content]

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  SKELETON_CONNECTIONS,
  JOINT_REGIONS,
  KP,
  computeRidingQualities,
} from '../../lib/poseAnalysis';
import type { PoseFrame, MovementInsight, RidingQualityScore } from '../../lib/poseAnalysis';
import type { BiometricsSnapshot } from '../../data/mock';
import { getHorseName } from '../../lib/userProfile';
import type { VideoAnalysisResult, AnalysisStatus, TimestampedFrame } from '../../hooks/useVideoAnalysis';
import { hasPoseFrame, resolvePoseFrameAtTime } from '../../lib/videoPlayback';

type AnalysisTab = 'movement' | 'body' | 'quality';

// ─────────────────────────────────────────────────────────
// COLOR HELPERS
// ─────────────────────────────────────────────────────────

// Horsera colors — not Ridesum's clinical palette
const C = {
  green:     '#7D9B76',  // Progress Green — strong
  champagne: '#C9A96E',  // Champagne — developing
  attention: '#C4714A',  // Attention — needs focus
} as const;

function scoreColor(score: number): string {
  if (score >= 0.80) return C.green;
  if (score >= 0.60) return C.champagne;
  return C.attention;
}

function scoreLabel(score: number): string {
  if (score >= 0.85) return 'Excellent';
  if (score >= 0.70) return 'Good';
  if (score >= 0.55) return 'Developing';
  return 'Focus area';
}

// Joint color for real skeleton overlay — uses metric region mapping
function jointColor(
  keypointIdx: number,
  biometrics: BiometricsSnapshot,
  confidence: number
): string {
  if (confidence < 0.15) return 'rgba(255,255,255,0.15)';
  const metricKey = JOINT_REGIONS[keypointIdx];
  const base = metricKey ? scoreColor(biometrics[metricKey]) : 'rgba(255,255,255,0.6)';
  const opacity = confidence < 0.35 ? 0.5 : 0.92;
  // Return color with opacity by interpolating — simpler: just return color directly
  // and rely on the SVG opacity attribute
  if (confidence < 0.35) return base + '80'; // 50% opacity hex
  return base;
}

// ─────────────────────────────────────────────────────────
// ISSUE 1 — Real skeleton overlay for MoveNet output
// ─────────────────────────────────────────────────────────

function SkeletonOverlay({ frame, biometrics }: { frame: PoseFrame; biometrics: BiometricsSnapshot }) {
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {/* Dark outline layer for contrast on any background */}
      {SKELETON_CONNECTIONS.map(([a, b], i) => {
        const kpA = frame[a];
        const kpB = frame[b];
        if (!kpA || !kpB) return null;
        const minConf = Math.min(kpA.score, kpB.score);
        if (minConf < 0.12) return null;
        return (
          <line
            key={`outline-${i}`}
            x1={kpA.x} y1={kpA.y} x2={kpB.x} y2={kpB.y}
            stroke="rgba(0,0,0,0.45)"
            strokeWidth="0.026"
            strokeLinecap="round"
          />
        );
      })}

      {/* Colored skeleton lines */}
      {SKELETON_CONNECTIONS.map(([a, b], i) => {
        const kpA = frame[a];
        const kpB = frame[b];
        if (!kpA || !kpB) return null;
        const minConf = Math.min(kpA.score, kpB.score);
        if (minConf < 0.12) return null;
        const color = jointColor(a, biometrics, minConf);
        const op = minConf < 0.35 ? 0.55 : 0.90;
        return (
          <line
            key={`seg-${i}`}
            x1={kpA.x} y1={kpA.y} x2={kpB.x} y2={kpB.y}
            stroke={color}
            strokeWidth="0.018"
            strokeLinecap="round"
            opacity={op}
          />
        );
      })}

      {/* Joint dots — skip face */}
      {frame.map((kp, i) => {
        if (i <= KP.rightEar) return null;
        if (kp.score < 0.12) return null;
        const color = jointColor(i, biometrics, kp.score);
        const op = kp.score < 0.35 ? 0.55 : 0.95;
        return (
          <g key={`joint-${i}`} opacity={op}>
            <circle cx={kp.x} cy={kp.y} r="0.025" fill="rgba(0,0,0,0.4)" />
            {kp.score >= 0.45 && <circle cx={kp.x} cy={kp.y} r="0.022" fill={color} opacity={0.25} />}
            <circle cx={kp.x} cy={kp.y} r="0.014" fill={color} />
          </g>
        );
      })}

      {/* Legend */}
      {[
        { color: C.green,     label: 'Strong',     y: 0.88 },
        { color: C.champagne, label: 'Developing', y: 0.92 },
        { color: C.attention, label: 'Focus area', y: 0.96 },
      ].map(({ color, label, y }) => (
        <g key={label}>
          <circle cx="0.04" cy={y} r="0.018" fill={color} />
          <text x="0.07" y={y + 0.005} fontSize="0.036"
            fill="rgba(255,255,255,0.78)" fontFamily="DM Sans, sans-serif">{label}</text>
        </g>
      ))}

      <text x="0.72" y="0.975" fontSize="0.032" fill="rgba(201,169,110,0.7)"
        fontFamily="DM Mono, monospace">Cadence · AI</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// Mock video frame — improved full-body dressage rider skeleton
// Used when videoUploaded=true but no real analysis run yet
// ─────────────────────────────────────────────────────────

function MockVideoFrame({ biometrics }: { biometrics?: BiometricsSnapshot }) {
  const b: BiometricsSnapshot = biometrics ?? {
    lowerLegStability: 0.72, reinSteadiness: 0.81, reinSymmetry: 0.76,
    coreStability: 0.88, upperBodyAlignment: 0.79, pelvisStability: 0.84,
  };

  // Segment colors per metric
  const legCol  = scoreColor(b.lowerLegStability);   // lower leg
  const reinCol = scoreColor(b.reinSteadiness);       // near arm
  const symCol  = scoreColor(b.reinSymmetry);         // far arm
  const coreCol = scoreColor(b.coreStability);        // torso
  const ubCol   = scoreColor(b.upperBodyAlignment);   // shoulder/head
  const pelCol  = scoreColor(b.pelvisStability);      // hip/thigh

  // Rider positions — 320×180 viewBox, rider facing right, side view
  // Plumb line (ear-shoulder-hip-heel) at x≈170
  const P = {
    head:  [170, 24],
    sh_n:  [158, 43],  sh_f:  [182, 43],   // near/far shoulder
    el_n:  [144, 59],  el_f:  [188, 56],   // near/far elbow
    wr_n:  [130, 67],  wr_f:  [199, 62],   // near/far wrist
    hip_n: [160, 90],  hip_f: [180, 90],   // near/far hip
    knee:  [182, 118],                      // knee (forward)
    ankle: [170, 148],                      // ankle (stirrup)
  };

  const seg = (ax: number, ay: number, bx: number, by: number, color: string, w = 3) => (
    <>
      {/* Dark outline */}
      <line x1={ax} y1={ay} x2={bx} y2={by}
        stroke="rgba(0,0,0,0.35)" strokeWidth={w + 1.2} strokeLinecap="round" />
      {/* Colored segment */}
      <line x1={ax} y1={ay} x2={bx} y2={by}
        stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.92} />
    </>
  );

  const dot = (x: number, y: number, color: string, r = 4.5) => (
    <>
      <circle cx={x} cy={y} r={r + 1.5} fill="rgba(0,0,0,0.35)" />
      <circle cx={x} cy={y} r={r + 0.5} fill={color} opacity={0.2} />
      <circle cx={x} cy={y} r={r - 1} fill={color} />
    </>
  );

  return (
    <svg viewBox="0 0 320 180" width="100%" style={{ display: 'block' }}>
      {/* Dark arena background */}
      <rect width="320" height="180" fill="#1C1510" />
      <rect x="0" y="148" width="320" height="32" fill="#251A0F" />

      {/* Horse silhouette — simplified but readable */}
      <ellipse cx="175" cy="148" rx="72" ry="24" fill="#2A1E14" />
      {/* Neck */}
      <ellipse cx="112" cy="130" rx="18" ry="14" fill="#2A1E14" transform="rotate(-18 112 130)" />
      {/* Head */}
      <ellipse cx="96" cy="114" rx="10" ry="16" fill="#2A1E14" transform="rotate(-20 96 114)" />
      {/* Front legs */}
      <rect x="125" y="166" width="8" height="20" rx="3" fill="#2A1E14" />
      <rect x="148" y="166" width="8" height="20" rx="3" fill="#2A1E14" />
      {/* Back legs */}
      <rect x="195" y="164" width="8" height="20" rx="3" fill="#2A1E14" />
      <rect x="215" y="162" width="8" height="20" rx="3" fill="#2A1E14" />

      {/* ── Rider skeleton ── */}

      {/* Head glow */}
      <circle cx={P.head[0]} cy={P.head[1]} r="10" fill="none"
        stroke={ubCol} strokeWidth="1.5" opacity={0.3} />

      {/* Torso */}
      {seg(170, P.head[1] + 8, 170, P.hip_n[1] + 4, coreCol, 3.5)}

      {/* Shoulder line */}
      {seg(P.sh_n[0], P.sh_n[1], P.sh_f[0], P.sh_f[1], ubCol, 3)}

      {/* Near arm */}
      {seg(P.sh_n[0], P.sh_n[1], P.el_n[0], P.el_n[1], reinCol, 3)}
      {seg(P.el_n[0], P.el_n[1], P.wr_n[0], P.wr_n[1], reinCol, 2.5)}

      {/* Far arm */}
      {seg(P.sh_f[0], P.sh_f[1], P.el_f[0], P.el_f[1], symCol, 3)}
      {seg(P.el_f[0], P.el_f[1], P.wr_f[0], P.wr_f[1], symCol, 2.5)}

      {/* Hip line */}
      {seg(P.hip_n[0], P.hip_n[1], P.hip_f[0], P.hip_f[1], pelCol, 3)}

      {/* Thigh */}
      {seg(P.hip_n[0], P.hip_n[1], P.knee[0], P.knee[1], pelCol, 3.5)}

      {/* Lower leg */}
      {seg(P.knee[0], P.knee[1], P.ankle[0], P.ankle[1], legCol, 3)}

      {/* Joint dots */}
      {dot(P.head[0], P.head[1], ubCol, 5)}
      {dot(P.sh_n[0], P.sh_n[1], ubCol)}
      {dot(P.sh_f[0], P.sh_f[1], ubCol)}
      {dot(P.el_n[0], P.el_n[1], reinCol)}
      {dot(P.wr_n[0], P.wr_n[1], reinCol)}
      {dot(P.el_f[0], P.el_f[1], symCol)}
      {dot(P.wr_f[0], P.wr_f[1], symCol)}
      {dot(P.hip_n[0], P.hip_n[1], pelCol)}
      {dot(P.hip_f[0], P.hip_f[1], pelCol)}
      {dot(P.knee[0], P.knee[1], legCol)}
      {dot(P.ankle[0], P.ankle[1], legCol)}

      {/* Legend */}
      <circle cx="14" cy="14" r="4" fill={C.green} />
      <text x="22" y="18.5" fontSize="8" fill="rgba(255,255,255,0.75)"
        fontFamily="DM Sans, sans-serif">Strong</text>
      <circle cx="14" cy="28" r="4" fill={C.champagne} />
      <text x="22" y="32.5" fontSize="8" fill="rgba(255,255,255,0.75)"
        fontFamily="DM Sans, sans-serif">Developing</text>
      <circle cx="14" cy="42" r="4" fill={C.attention} />
      <text x="22" y="46.5" fontSize="8" fill="rgba(255,255,255,0.75)"
        fontFamily="DM Sans, sans-serif">Focus area</text>
      <text x="238" y="172" fontSize="7.5" fill="rgba(201,169,110,0.6)"
        fontFamily="DM Mono, monospace">Cadence · Sample</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// ISSUE 2 — "The Rider Map" body diagram (Ridesum-inspired redesign)
// Design: dark navy/charcoal silhouette, arc gauges at joints,
// floating callout cards, overall gradient bar at bottom.
// ─────────────────────────────────────────────────────────

// Helper: compute SVG arc path for a semicircle gauge
// cx,cy = center; r = radius; startAngle/endAngle in degrees (0=right, clockwise)
// Returns a partial arc path string
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// ArcGauge: background arc (gray) + colored fill arc based on score
function ArcGauge({
  cx, cy, r, score,
  startDeg = 210, spanDeg = 120,
}: {
  cx: number; cy: number; r: number; score: number;
  startDeg?: number; spanDeg?: number;
}) {
  const col = scoreColor(score);
  const endFullDeg = startDeg + spanDeg;
  const fillEndDeg = startDeg + spanDeg * score;
  const bgPath   = arcPath(cx, cy, r, startDeg, endFullDeg);
  const fillPath = arcPath(cx, cy, r, startDeg, fillEndDeg);
  return (
    <>
      <path d={bgPath}   fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" strokeLinecap="round" />
      <path d={fillPath} fill="none" stroke={col} strokeWidth="3.5" strokeLinecap="round" opacity={0.92} />
    </>
  );
}

function RiderBodyDiagram({ biometrics }: { biometrics: BiometricsSnapshot }) {
  const pct = (v: number) => Math.round(v * 100);

  // Overall score 0–1
  const overallScore = (
    biometrics.lowerLegStability + biometrics.reinSteadiness +
    biometrics.reinSymmetry + biometrics.coreStability +
    biometrics.upperBodyAlignment + biometrics.pelvisStability
  ) / 6;

  // ── SVG viewBox: 280 × 320
  // Rider: side view, facing right, seated dressage position
  // Silhouette color: deep navy/charcoal #2C3E50
  // Plumb line at x ≈ 140
  const SILHOUETTE = '#2C3E50';
  const SILHOUETTE_DARK = '#1C2B3A';

  // Key joint positions
  const P = {
    head:   [140, 38],
    neck:   [138, 54],
    sh:     [132, 72],   // shoulder (near)
    sh_f:   [150, 70],   // shoulder (far, slightly back)
    el_n:   [118, 90],   // near elbow
    wr_n:   [104, 104],  // near wrist
    el_f:   [158, 88],   // far elbow
    wr_f:   [168, 103],  // far wrist
    hip:    [136, 118],  // near hip
    hip_f:  [152, 116],  // far hip
    knee:   [156, 148],  // knee
    ankle:  [144, 178],  // ankle/stirrup
  } as const;

  // Limb segment helper — thick rounded, dark navy
  const limb = (
    ax: number, ay: number, bx: number, by: number, w: number
  ) => (
    <>
      <line x1={ax} y1={ay} x2={bx} y2={by}
        stroke={SILHOUETTE_DARK} strokeWidth={w + 2.5} strokeLinecap="round" />
      <line x1={ax} y1={ay} x2={bx} y2={by}
        stroke={SILHOUETTE} strokeWidth={w} strokeLinecap="round" />
    </>
  );

  // Joint cap helper
  const cap = (x: number, y: number, r: number) => (
    <>
      <circle cx={x} cy={y} r={r + 1.5} fill={SILHOUETTE_DARK} />
      <circle cx={x} cy={y} r={r} fill={SILHOUETTE} />
    </>
  );

  return (
    <div style={{ padding: '16px 16px 0' }}>

      {/* ── Diagram + callout cards ── */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 380 }}>

        {/* SVG body diagram — 280×320 viewBox */}
        <svg
          viewBox="0 0 280 320"
          width="100%"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            {/* Subtle spotlight behind rider */}
            <radialGradient id="riderSpot" cx="50%" cy="42%" r="48%">
              <stop offset="0%"   stopColor="#3A5068" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#1C2B3A" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Dark background panel */}
          <rect width="280" height="298" rx="10" fill="#1C2B3A" opacity={0.06} />

          {/* Spotlight glow */}
          <ellipse cx="140" cy="130" rx="90" ry="110" fill="url(#riderSpot)" />

          {/* Horse barrel (context — subtle) */}
          <ellipse cx="145" cy="215" rx="70" ry="18" fill="#2C3E50" opacity={0.22} />
          <ellipse cx="145" cy="213" rx="64" ry="14" fill="#2C3E50" opacity={0.18} />
          {/* Stirrup iron suggestion */}
          <rect x="136" y="182" width="16" height="5" rx="2.5" fill="#2C3E50" opacity={0.35} />

          {/* ── Rider silhouette — thick rounded limbs ── */}

          {/* Torso */}
          {limb(139, P.neck[1] + 2, 138, P.hip[1] + 2, 13)}
          {/* Shoulder line */}
          {limb(P.sh[0], P.sh[1], P.sh_f[0], P.sh_f[1], 10)}
          {/* Hip line */}
          {limb(P.hip[0], P.hip[1], P.hip_f[0], P.hip_f[1], 10)}
          {/* Near arm — upper */}
          {limb(P.sh[0], P.sh[1], P.el_n[0], P.el_n[1], 9)}
          {/* Near arm — lower */}
          {limb(P.el_n[0], P.el_n[1], P.wr_n[0], P.wr_n[1], 7)}
          {/* Far arm — upper */}
          {limb(P.sh_f[0], P.sh_f[1], P.el_f[0], P.el_f[1], 9)}
          {/* Far arm — lower */}
          {limb(P.el_f[0], P.el_f[1], P.wr_f[0], P.wr_f[1], 7)}
          {/* Thigh */}
          {limb(P.hip[0], P.hip[1], P.knee[0], P.knee[1], 12)}
          {/* Lower leg */}
          {limb(P.knee[0], P.knee[1], P.ankle[0], P.ankle[1], 10)}

          {/* Head — helmet shape */}
          <ellipse cx={P.head[0]} cy={P.head[1] - 2} rx="13" ry="15"
            fill={SILHOUETTE_DARK} />
          <ellipse cx={P.head[0]} cy={P.head[1] - 2} rx="11" ry="13"
            fill={SILHOUETTE} />
          {/* Helmet brim */}
          <rect x={P.head[0] - 14} y={P.head[1] + 9} width="28" height="4"
            rx="2" fill={SILHOUETTE_DARK} />

          {/* Joint caps — sit on top of limbs */}
          {cap(P.sh[0],    P.sh[1],    6)}
          {cap(P.sh_f[0],  P.sh_f[1],  6)}
          {cap(P.el_n[0],  P.el_n[1],  5)}
          {cap(P.wr_n[0],  P.wr_n[1],  4)}
          {cap(P.el_f[0],  P.el_f[1],  5)}
          {cap(P.wr_f[0],  P.wr_f[1],  4)}
          {cap(P.hip[0],   P.hip[1],   6)}
          {cap(P.hip_f[0], P.hip_f[1], 6)}
          {cap(P.knee[0],  P.knee[1],  6)}
          {cap(P.ankle[0], P.ankle[1], 5)}

          {/* ── Arc gauges at key joints ── */}
          {/* Shoulder (upper body alignment) — arc opens upward-left */}
          <ArcGauge cx={P.sh[0]}   cy={P.sh[1]}   r={14} score={biometrics.upperBodyAlignment} startDeg={200} spanDeg={140} />
          {/* Near elbow (rein steadiness) — arc opens left */}
          <ArcGauge cx={P.el_n[0]} cy={P.el_n[1]} r={12} score={biometrics.reinSteadiness}     startDeg={190} spanDeg={130} />
          {/* Far elbow (rein symmetry) — arc opens right */}
          <ArcGauge cx={P.el_f[0]} cy={P.el_f[1]} r={12} score={biometrics.reinSymmetry}       startDeg={350} spanDeg={130} />
          {/* Hip (pelvis stability) — arc opens down-right */}
          <ArcGauge cx={P.hip[0]}  cy={P.hip[1]}  r={14} score={biometrics.pelvisStability}    startDeg={30}  spanDeg={130} />
          {/* Knee (core stability) — arc opens down */}
          <ArcGauge cx={P.knee[0]} cy={P.knee[1]} r={13} score={biometrics.coreStability}      startDeg={20}  spanDeg={130} />
          {/* Ankle (lower leg stability) — arc opens down-left */}
          <ArcGauge cx={P.ankle[0]} cy={P.ankle[1]} r={12} score={biometrics.lowerLegStability} startDeg={200} spanDeg={130} />

          {/* ── Callout connector lines ── */}
          {/* Left callouts */}
          {/* Rein Steadiness — near elbow → left */}
          <line x1={P.el_n[0] - 12} y1={P.el_n[1]} x2="56" y2={P.el_n[1]}
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="3 2" />
          {/* Lower Leg — ankle → left */}
          <line x1={P.ankle[0] - 12} y1={P.ankle[1]} x2="56" y2={P.ankle[1]}
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="3 2" />
          {/* Right callouts */}
          {/* Upper Body — shoulder → right */}
          <line x1={P.sh_f[0] + 12} y1={P.sh_f[1]} x2="224" y2={P.sh_f[1]}
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="3 2" />
          {/* Rein Symmetry — far elbow → right */}
          <line x1={P.el_f[0] + 12} y1={P.el_f[1]} x2="224" y2={P.el_f[1]}
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="3 2" />
          {/* Pelvis — hip → right */}
          <line x1={P.hip_f[0] + 12} y1={P.hip_f[1]} x2="224" y2={P.hip_f[1]}
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="3 2" />
          {/* Core — knee → right */}
          <line x1={P.knee[0] + 12} y1={P.knee[1]} x2="224" y2={P.knee[1]}
            stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeDasharray="3 2" />
        </svg>

        {/* ── Floating callout cards — absolutely positioned ── */}
        {/* Left side */}
        {/* Rein Steadiness */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: `${(P.el_n[1] / 320) * 100}%`,
          transform: 'translateY(-50%)',
          width: 68,
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '4px 7px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.10)',
          border: '1px solid #EDE7DF',
        }}>
          <div style={{ fontSize: 8, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2, marginBottom: 1 }}>
            Rein Steady
          </div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(biometrics.reinSteadiness), lineHeight: 1 }}>
            {pct(biometrics.reinSteadiness)}%
          </div>
          <div style={{ fontSize: 7.5, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
            Ideal: ≥80%
          </div>
        </div>

        {/* Lower Leg */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: `${(P.ankle[1] / 320) * 100}%`,
          transform: 'translateY(-50%)',
          width: 68,
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '4px 7px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.10)',
          border: '1px solid #EDE7DF',
        }}>
          <div style={{ fontSize: 8, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2, marginBottom: 1 }}>
            Lower Leg
          </div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(biometrics.lowerLegStability), lineHeight: 1 }}>
            {pct(biometrics.lowerLegStability)}%
          </div>
          <div style={{ fontSize: 7.5, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
            Ideal: ≥80%
          </div>
        </div>

        {/* Right side */}
        {/* Upper Body */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: `${(P.sh_f[1] / 320) * 100}%`,
          transform: 'translateY(-50%)',
          width: 72,
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '4px 7px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.10)',
          border: '1px solid #EDE7DF',
        }}>
          <div style={{ fontSize: 8, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2, marginBottom: 1 }}>
            Upper Body
          </div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(biometrics.upperBodyAlignment), lineHeight: 1 }}>
            {pct(biometrics.upperBodyAlignment)}%
          </div>
          <div style={{ fontSize: 7.5, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
            Ideal: ≥80%
          </div>
        </div>

        {/* Rein Symmetry */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: `${(P.el_f[1] / 320) * 100}%`,
          transform: 'translateY(-50%)',
          width: 72,
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '4px 7px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.10)',
          border: '1px solid #EDE7DF',
        }}>
          <div style={{ fontSize: 8, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2, marginBottom: 1 }}>
            Rein Symm.
          </div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(biometrics.reinSymmetry), lineHeight: 1 }}>
            {pct(biometrics.reinSymmetry)}%
          </div>
          <div style={{ fontSize: 7.5, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
            Ideal: ≥80%
          </div>
        </div>

        {/* Pelvis */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: `${(P.hip_f[1] / 320) * 100}%`,
          transform: 'translateY(-50%)',
          width: 72,
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '4px 7px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.10)',
          border: '1px solid #EDE7DF',
        }}>
          <div style={{ fontSize: 8, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2, marginBottom: 1 }}>
            Pelvis
          </div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(biometrics.pelvisStability), lineHeight: 1 }}>
            {pct(biometrics.pelvisStability)}%
          </div>
          <div style={{ fontSize: 7.5, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
            Ideal: ≥80%
          </div>
        </div>

        {/* Core */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: `${(P.knee[1] / 320) * 100}%`,
          transform: 'translateY(-50%)',
          width: 72,
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '4px 7px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.10)',
          border: '1px solid #EDE7DF',
        }}>
          <div style={{ fontSize: 8, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2, marginBottom: 1 }}>
            Core
          </div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(biometrics.coreStability), lineHeight: 1 }}>
            {pct(biometrics.coreStability)}%
          </div>
          <div style={{ fontSize: 7.5, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
            Ideal: ≥80%
          </div>
        </div>

      </div>{/* end diagram container */}

      {/* ── Overall gradient bar ── */}
      <div style={{ padding: '4px 0 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: '#B5A898', fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Overall position
          </span>
          <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: scoreColor(overallScore) }}>
            {pct(overallScore)}%
          </span>
        </div>
        {/* Gradient track */}
        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'linear-gradient(to right, #C4714A 0%, #C9A96E 45%, #7D9B76 100%)' }}>
          {/* Dot marker showing rider's position */}
          <div style={{
            position: 'absolute',
            left: `calc(${pct(overallScore)}% - 6px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 12, height: 12,
            borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: `0 0 0 2px ${scoreColor(overallScore)}, 0 2px 6px rgba(26,20,14,0.22)`,
          }} />
        </div>
        {/* Scale labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 8, color: '#C4714A', fontFamily: "'DM Mono', monospace" }}>Needs focus</span>
          <span style={{ fontSize: 8, color: '#C9A96E', fontFamily: "'DM Mono', monospace" }}>Developing</span>
          <span style={{ fontSize: 8, color: '#7D9B76', fontFamily: "'DM Mono', monospace" }}>Strong</span>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────
// IssueSummarySection — per-metric cards for scores < 0.80
// Collapsible exercise lists (unmounted + mounted)
// ─────────────────────────────────────────────────────────

type MetricKey = keyof BiometricsSnapshot;

interface IssueConfig {
  key: MetricKey;
  label: string;
  cue: string;
  unmounted: string[];
  mounted: string[];
}

const ISSUE_CONFIG: IssueConfig[] = [
  {
    key: 'lowerLegStability',
    label: 'Lower Leg',
    cue: "Your lower leg is drifting, breaking the ear–shoulder–hip–heel line. Wrap your leg around the horse — don't grip. Think 'heavy heel, soft knee.'",
    unmounted: ['Heel drops on a step', 'Single-leg balance holds', 'Yoga warrior 1'],
    mounted: ['No-stirrup work at walk', 'Stretching exercises at walk', 'Counting strides at trot'],
  },
  {
    key: 'reinSteadiness',
    label: 'Rein Steadiness',
    cue: "Your hands are moving with the horse's mouth rather than maintaining a steady connection. Think of your elbows as shock absorbers — they absorb the movement, not your wrists.",
    unmounted: ['Resistance band elbow exercises', 'Mirror work with raised hands'],
    mounted: ['Carrying a whip across both wrists', 'Working in a neck strap'],
  },
  {
    key: 'reinSymmetry',
    label: 'Rein Symmetry',
    cue: "One hand is consistently higher or wider than the other. Carry both hands level, thumbs uppermost, as if holding a tray you don't want to spill.",
    unmounted: ['Mirror exercises with both arms', 'Wrist stretches and rotations'],
    mounted: ['Work on a 20m circle tracking both reins equally', 'Halt transitions, checking hand position'],
  },
  {
    key: 'coreStability',
    label: 'Core Stability',
    cue: "Your core is not stabilising your upper body through transitions and gait changes. A strong core creates stillness — the horse feels your aids more clearly when your torso doesn't move.",
    unmounted: ['Pilates bridge holds', 'Plank holds (30–60 s)', 'Dead bug exercise'],
    mounted: ['Eyes closed at walk on a loose rein', 'Jazz hands at trot to test upper body independence'],
  },
  {
    key: 'upperBodyAlignment',
    label: 'Upper Body',
    cue: "You are leaning — either forward, back, or to one side. Your upper body should feel like a plumb line: ear, shoulder, hip, heel in one vertical line.",
    unmounted: ['Wall posture check (back against wall)', 'Alexander technique sessions', 'Pilates roll-down'],
    mounted: ['Halt transitions with eyes closed', 'Shoulder rolls at sitting trot', 'Sitting trot on a circle'],
  },
  {
    key: 'pelvisStability',
    label: 'Pelvis',
    cue: "Your pelvis is bouncing more than the horse requires. A following seat absorbs movement in the hip joint, not by gripping. Let your hips swing with the horse — not against.",
    unmounted: ['Hip circle stretches', 'Yoga cat-cow', 'Seated balance ball exercises'],
    mounted: ['Rising trot to sitting trot transitions', 'Sitting trot on a loose rein'],
  },
];

function CollapsibleExercises({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '2px 0', width: '100%',
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 600, color: '#8C5A3C', fontFamily: "'DM Sans', sans-serif" }}>
          {title}
        </span>
        <span style={{
          fontSize: 9, color: '#B5A898', fontFamily: "'DM Mono', monospace",
          transform: open ? 'rotate(90deg)' : 'none',
          display: 'inline-block', transition: 'transform 0.15s ease',
          marginLeft: 2,
        }}>›</span>
      </button>
      {open && (
        <ul style={{ margin: '4px 0 0 0', padding: '0 0 0 14px', listStyle: 'disc' }}>
          {items.map(item => (
            <li key={item} style={{
              fontSize: 11, color: '#7A6B5D',
              fontFamily: "'DM Sans', sans-serif",
              lineHeight: 1.5, marginBottom: 2,
            }}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueSummarySection({ biometrics }: { biometrics: BiometricsSnapshot }) {
  const issues = ISSUE_CONFIG.filter(cfg => biometrics[cfg.key] < 0.80);

  if (issues.length === 0) {
    return (
      <div style={{ padding: '12px 16px 16px' }}>
        <div style={{
          background: '#F2F7F2', borderRadius: 10,
          padding: '12px 14px', textAlign: 'center',
          border: '1px solid #C8DEC6',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7D9B76', fontFamily: "'DM Sans', sans-serif", marginBottom: 2 }}>
            All areas strong
          </div>
          <div style={{ fontSize: 11, color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif" }}>
            Every metric is at 80% or above. Keep it up.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: '#B5A898',
        letterSpacing: '0.12em', textTransform: 'uppercase',
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: 10,
      }}>
        Areas to address
      </div>

      {issues.map((cfg, i) => {
        const score = biometrics[cfg.key];
        const col = scoreColor(score);
        const pct = Math.round(score * 100);
        return (
          <div key={cfg.key} style={{
            background: '#FDFCFA',
            border: '1px solid #EDE7DF',
            borderRadius: 10,
            padding: '12px 13px',
            marginBottom: i < issues.length - 1 ? 10 : 0,
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              {/* Severity dot */}
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: col, flexShrink: 0,
                boxShadow: `0 0 0 3px ${col}22`,
              }} />
              <span style={{
                fontSize: 12, fontWeight: 700, color: '#1A140E',
                fontFamily: "'DM Sans', sans-serif", flex: 1,
              }}>
                {cfg.label}
              </span>
              <span style={{
                fontSize: 11, fontFamily: "'DM Mono', monospace",
                fontWeight: 700, color: col,
              }}>
                {pct}%
              </span>
            </div>

            {/* Coaching cue */}
            <p style={{
              fontSize: 11.5, color: '#5A4E44',
              fontFamily: "'DM Sans', sans-serif",
              lineHeight: 1.55, margin: '0 0 8px',
            }}>
              {cfg.cue}
            </p>

            {/* Collapsible exercise sections */}
            <div style={{ borderTop: '1px solid #EDE7DF', paddingTop: 8 }}>
              <CollapsibleExercises title="Unmounted exercises ›" items={cfg.unmounted} />
              <CollapsibleExercises title="Mounted exercises ›"   items={cfg.mounted}   />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ISSUE 3 — Riding Quality Panel (Layer 2)
// USDF Scales of Training order
// ─────────────────────────────────────────────────────────

// Extended content for each Scale row — description + training suggestions
const SCALE_DETAIL: Record<string, { description: string; suggestions: string[] }> = {
  Rhythm: {
    description: `Rhythm is the first and most fundamental Scale. It means the regularity and tempo of the footfalls — each gait has a distinct beat (4-beat walk, 2-beat trot, 3-beat canter) that should remain constant. When your lower leg drifts, it disrupts ${getHorseName("your horse")}'s rhythm with every stride.`,
    suggestions: ['Trot counting exercise: count aloud "1-2, 1-2" for 10 strides without stopping', 'Transitions within trot (medium to working to collected) on a 20m circle', 'No-stirrup trot to develop a quiet, absorbing lower leg'],
  },
  Relaxation: {
    description: "Relaxation (Losgelassenheit) means mental and physical freedom from tension — in both horse and rider. A tense rider creates a tense horse. When your pelvis and core are supple, your horse swings freely through the back and breathes naturally.",
    suggestions: [`Stretching circles: allow ${getHorseName('your horse')} to stretch forward and down on a loose rein at rising trot`, 'Singing or humming while riding to prevent breath-holding', 'Transitions halt–walk–halt on a loose rein to encourage self-carriage'],
  },
  Contact: {
    description: "Contact is the soft, elastic connection from your hand to the horse's mouth through the rein. It is not pulling — it's a steady, following conversation. Unsteady hands create an inconsistent signal; the horse cannot trust a contact that moves unpredictably.",
    suggestions: ['Carry a neck strap: practice giving with one rein to neck strap and back without losing the other rein', 'Shoulder-in: demands steady, equal contact on both reins simultaneously', 'Half-halts every 5 strides to develop feel for throughness in the contact'],
  },
  Impulsion: {
    description: "Impulsion is the stored, controlled energy that flows forward from active hindquarters. It is not speed — it is power. A rider whose core collapses on each stride blocks the energy from travelling through the horse's back.",
    suggestions: ['Transitions trot–canter–trot every quarter circle on a 20m circle', 'Leg yield in trot: engages the inside hind, building impulsion laterally', 'Lengthen and shorten stride down the long side (not faster/slower — bigger/smaller)'],
  },
  Straightness: {
    description: "Straightness means the horse's hind feet follow in the track of the front feet on straight lines and arcs. Most horses (and riders) are naturally asymmetric. Uneven reins and uneven weight in the saddle are the most common causes of crookedness.",
    suggestions: ['Ride down the centre line and halt: film from the front to check straightness', 'Leg yield from the quarter line to the track — tests and corrects asymmetry', `Shoulder-fore on the rein where ${getHorseName('your horse')} tends to fall out`],
  },
  Balance: {
    description: "Balance in the Scales refers to the horse carrying more weight on the hindquarters — what is called 'collection.' A rider who leans forward shifts the horse's balance onto the forehand, making collection impossible regardless of how the horse is trained.",
    suggestions: ['Working pirouette (large) at walk: demands maximum engagement of hindquarters', 'Sitting trot to canter transitions: the moment of canter depart tests balance acutely', 'Travers (haunches-in) on a 10m circle: develops collection and balance in one movement'],
  },
};

function RidingQualityPanel({ biometrics }: { biometrics: BiometricsSnapshot }) {
  const qualities = computeRidingQualities(biometrics);
  const pct = (v: number) => Math.round(v * 100);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div style={{ padding: '16px 16px 14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div style={{
          fontSize: '9px', fontWeight: 700, color: '#B5A898',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          The Scales of Training
        </div>
        <div style={{
          fontSize: '8.5px', color: '#6B7FA3',
          background: '#EEF2F8', padding: '2px 7px', borderRadius: '6px',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          USDF
        </div>
      </div>

      <p style={{
        fontSize: '10.5px', color: '#B5A898',
        fontFamily: "'DM Sans', sans-serif",
        margin: '0 0 14px', lineHeight: 1.4,
      }}>
        Tap any scale to understand what it means and how to improve it.
      </p>

      {qualities.map((q: RidingQualityScore, i: number) => {
        const col      = scoreColor(q.score);
        const label    = scoreLabel(q.score);
        const isOpen   = expandedIdx === i;
        const detail   = SCALE_DETAIL[q.name];
        return (
          <div
            key={q.name}
            style={{
              marginBottom: i < qualities.length - 1 ? '10px' : 0,
              border: '1px solid',
              borderColor: isOpen ? `${col}40` : '#F0EBE4',
              borderRadius: '12px',
              background: isOpen ? `${col}06` : '#FDFCFA',
              overflow: 'hidden',
              transition: 'border-color 0.15s ease',
            }}
          >
            {/* Tappable header row */}
            <button
              onClick={() => setExpandedIdx(isOpen ? null : i)}
              style={{
                width: '100%', background: 'none', border: 'none',
                cursor: 'pointer', padding: '11px 13px 0', textAlign: 'left',
              }}
            >
              {/* Name + score + chevron */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontFamily: "'Playfair Display', serif",
                    fontSize: '15px', color: '#1A140E',
                  }}>
                    {q.name}
                  </span>
                  <span style={{
                    fontSize: '9px', color: col,
                    background: `${col}18`, padding: '1px 6px', borderRadius: '5px',
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                  }}>
                    {label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '15px', fontWeight: 600, color: col }}>
                    {pct(q.score)}%
                  </span>
                  <span style={{
                    fontSize: '11px', color: '#B5A898',
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    display: 'inline-block', transition: 'transform 0.15s ease',
                  }}>›</span>
                </div>
              </div>

              {/* Bar */}
              <div style={{ height: '5px', background: '#EDE7DF', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{
                  height: '100%', width: `${pct(q.score)}%`,
                  background: `linear-gradient(90deg, ${col}CC, ${col})`,
                  borderRadius: '3px', transition: 'width 0.7s ease',
                }} />
              </div>

              {/* Driver annotation — always visible */}
              <div style={{ fontSize: '9.5px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif", paddingBottom: '11px' }}>
                driven by {q.driverLabel} · {q.qualityNote}
              </div>
            </button>

            {/* Expanded content */}
            {isOpen && detail && (
              <div style={{ padding: '0 13px 13px', borderTop: '1px solid #F0EBE4' }}>
                <p style={{
                  fontSize: '12px', color: '#5A4E44',
                  fontFamily: "'DM Sans', sans-serif",
                  lineHeight: 1.6, margin: '12px 0 10px',
                }}>
                  {detail.description}
                </p>

                <div style={{
                  fontSize: '9px', fontWeight: 700, color: '#B5A898',
                  letterSpacing: '0.10em', textTransform: 'uppercase',
                  fontFamily: "'DM Sans', sans-serif", marginBottom: '6px',
                }}>
                  Training suggestions
                </div>
                <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                  {detail.suggestions.map((s, si) => (
                    <li key={si} style={{
                      fontSize: '11.5px', color: '#7A6B5D',
                      fontFamily: "'DM Sans', sans-serif",
                      lineHeight: 1.55, marginBottom: '4px',
                    }}>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Movement Insights rows (Layer 1 → Layer 2 narrative)
// ─────────────────────────────────────────────────────────

function InsightRows({ insights }: { insights: MovementInsight[] }) {
  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 600, color: '#B5A898',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          Movement Insights
        </span>
        <span style={{
          fontSize: '9.5px', color: '#6B7FA3',
          background: '#EEF2F8', padding: '2px 8px',
          borderRadius: '8px', fontFamily: "'DM Sans', sans-serif",
        }}>
          Cadence · AI
        </span>
      </div>
      {insights.map((insight, i) => (
        <div key={i} style={{
          display: 'flex', gap: '10px',
          padding: '9px 0',
          borderBottom: i < insights.length - 1 ? '1px solid #F0EBE4' : 'none',
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '8px',
            background: `${insight.iconColor}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{ fontSize: '13px', color: insight.iconColor, fontWeight: 700 }}>
              {insight.icon}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#1A140E', fontFamily: "'DM Sans', sans-serif" }}>
                {insight.metric}
              </span>
              <span style={{ fontSize: '9.5px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>
                → {insight.quality}
              </span>
              <span style={{
                marginLeft: 'auto', fontSize: '9px', fontWeight: 600,
                color: insight.trendColor, background: `${insight.trendColor}15`,
                padding: '1px 6px', borderRadius: '5px',
                fontFamily: "'DM Sans', sans-serif", textTransform: 'capitalize',
              }}>
                {insight.trend}
              </span>
            </div>
            <p style={{
              fontSize: '12px', color: '#7A6B5D', lineHeight: 1.5,
              fontFamily: "'DM Sans', sans-serif", margin: 0,
            }}>
              {insight.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Processing progress
// ─────────────────────────────────────────────────────────

function AnalysisProgress({ status, progress }: { status: AnalysisStatus; progress: number }) {
  const labels: Partial<Record<AnalysisStatus, string>> = {
    'loading-model': 'Loading Cadence AI model…',
    'extracting':    'Reading video frames…',
    'processing':    `Analysing movement — ${progress}%`,
  };
  return (
    <div style={{
      background: '#1C1510', aspectRatio: '16/9',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '12px', padding: '24px',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        background: 'radial-gradient(circle at 40% 35%, #9BAFC8, #6B7FA3)',
        boxShadow: '0 0 20px rgba(107,127,163,0.5)',
        animation: 'cadence-breathe 2s ease-in-out infinite',
      }} />
      <div style={{ fontSize: '13px', color: 'rgba(250,247,243,0.8)', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' }}>
        {labels[status] ?? 'Working…'}
      </div>
      <div style={{ width: '180px', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          width: `${progress}%`, height: '100%',
          background: 'linear-gradient(90deg, #6B7FA3, #9BAFC8)',
          borderRadius: '2px', transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{ fontSize: '10px', color: 'rgba(250,247,243,0.35)', fontFamily: "'DM Mono', monospace" }}>
        Processing on your device · No upload needed
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Tab switcher (reuses InsightsPage style)
// ─────────────────────────────────────────────────────────

function TabSwitcher({
  activeTab,
  onChange,
}: {
  activeTab: AnalysisTab;
  onChange: (t: AnalysisTab) => void;
}) {
  const tabs: { id: AnalysisTab; label: string }[] = [
    { id: 'movement', label: 'Movement'      },
    { id: 'body',     label: 'Your Position' },
    { id: 'quality',  label: 'The Scales'    },
  ];
  return (
    <div style={{
      display: 'flex', gap: '3px',
      background: '#F0EBE4', borderRadius: '10px',
      padding: '3px', margin: '0 16px 0',
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1, padding: '6px 4px',
            background: activeTab === t.id ? '#FFFFFF' : 'transparent',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '12px',
            fontWeight: activeTab === t.id ? 600 : 400,
            color: activeTab === t.id ? '#8C5A3C' : '#B5A898',
            fontFamily: "'DM Sans', sans-serif",
            transition: 'all 0.15s ease',
            boxShadow: activeTab === t.id ? '0 1px 4px rgba(26,20,14,0.08)' : 'none',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Video clip player — highlight loop + full-ride mode
// Default: 6s best-moment loop, muted, autoplay.
// Full mode: full session playback with scrub, speed controls.
// ─────────────────────────────────────────────────────────

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function VideoClipPlayer({
  videoUrl,
  bestMomentStart,
  allFrames,
  biometrics,
  frameCount,
}: {
  videoUrl:         string;
  bestMomentStart:  number;
  allFrames:        TimestampedFrame[];
  biometrics:       BiometricsSnapshot;
  frameCount:       number;
}) {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const [activeFrame,  setActiveFrame]  = useState<PoseFrame | null>(
    allFrames.find(hasPoseFrame)?.frame ?? null
  );
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [fullMode,     setFullMode]     = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const clipEnd = bestMomentStart + 6;

  const syncActiveFrame = useCallback((time: number) => {
    setActiveFrame(resolvePoseFrameAtTime(allFrames, time));
    setCurrentTime(time);
  }, [allFrames]);

  // Re-run whenever mode changes or video URL changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let rafId: number | null = null;
    let videoFrameId: number | null = null;

    const cancelScheduledSync = () => {
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

    const syncFromVideo = () => {
      let time = video.currentTime;
      if (!fullMode && time >= clipEnd) {
        video.currentTime = bestMomentStart;
        time = bestMomentStart;
      }
      syncActiveFrame(time);
    };

    const scheduleSync = () => {
      cancelScheduledSync();
      const videoWithCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      if (videoWithCallback.requestVideoFrameCallback) {
        videoFrameId = videoWithCallback.requestVideoFrameCallback(() => {
          videoFrameId = null;
          syncFromVideo();
          if (!video.paused && !video.ended) {
            scheduleSync();
          }
        });
      } else {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          syncFromVideo();
          if (!video.paused && !video.ended) {
            scheduleSync();
          }
        });
      }
    };

    if (!fullMode) {
      video.currentTime = bestMomentStart;
      video.playbackRate = 1;
    }
    syncActiveFrame(video.currentTime);

    const onLoadedMetadata = () => setDuration(video.duration);
    const onPlay  = () => {
      setIsPlaying(true);
      scheduleSync();
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelScheduledSync();
      syncFromVideo();
    };
    const onSeeked = () => syncFromVideo();

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play',           onPlay);
    video.addEventListener('pause',          onPause);
    video.addEventListener('seeked',         onSeeked);

    if (!fullMode) {
      video.play().catch(() => {});
    } else if (!video.paused && !video.ended) {
      scheduleSync();
    }

    return () => {
      cancelScheduledSync();
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play',           onPlay);
      video.removeEventListener('pause',          onPause);
      video.removeEventListener('seeked',         onSeeked);
      if (!fullMode) video.pause();
    };
  }, [videoUrl, bestMomentStart, clipEnd, fullMode, syncActiveFrame]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else              video.pause();
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const t = parseFloat(e.target.value);
    video.currentTime = t;
    syncActiveFrame(t);
  };

  const cycleSpeed = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = playbackRate === 1 ? 2 : playbackRate === 2 ? 0.5 : 1;
    video.playbackRate = next;
    setPlaybackRate(next);
  };

  const enterFullMode = () => {
    const video = videoRef.current;
    if (video) video.pause();
    setFullMode(true);
  };

  const exitFullMode = () => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = bestMomentStart;
      video.playbackRate = 1;
      setPlaybackRate(1);
      video.play().catch(() => {});
    }
    setFullMode(false);
  };

  return (
    <div style={{ position: 'relative', background: '#1C1510', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        style={{ width: '100%', display: 'block' }}
      />

      {/* Live skeleton overlay */}
      {activeFrame && (
        <SkeletonOverlay frame={activeFrame} biometrics={biometrics} />
      )}

      {/* ── Highlight mode UI ── */}
      {!fullMode && (
        <>
          {/* Tap to play/pause */}
          {!isPlaying && (
            <div onClick={togglePlay} style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(28,21,16,0.28)', cursor: 'pointer',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(201,169,110,0.88)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 0, height: 0, borderStyle: 'solid',
                  borderWidth: '9px 0 9px 17px',
                  borderColor: 'transparent transparent transparent #1C1510',
                  marginLeft: '5px',
                }} />
              </div>
            </div>
          )}

          {/* Best moment badge top-left */}
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: 'rgba(0,0,0,0.52)', borderRadius: '6px',
            padding: '2px 8px', fontSize: '9px',
            color: 'rgba(201,169,110,0.9)', fontFamily: "'DM Mono', monospace",
          }}>
            Best moment · 6s
          </div>

          {/* Frame count top-right */}
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(0,0,0,0.52)', borderRadius: '6px',
            padding: '2px 8px', fontSize: '9.5px',
            color: 'rgba(201,169,110,0.85)', fontFamily: "'DM Mono', monospace",
          }}>
            {frameCount} frames
          </div>

          {/* Watch full ride button — bottom right */}
          <button
            onClick={enterFullMode}
            style={{
              position: 'absolute', bottom: 10, right: 10,
              background: 'rgba(250,247,243,0.92)',
              border: 'none', borderRadius: '8px',
              padding: '5px 10px', cursor: 'pointer',
              fontSize: '11px', fontWeight: 600,
              color: '#1A140E', fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            Watch full ride ↗
          </button>
        </>
      )}

      {/* ── Full ride mode UI ── */}
      {fullMode && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(28,21,16,0.9))',
          padding: '32px 12px 10px',
        }}>
          {/* Scrub bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '9.5px', color: 'rgba(250,247,243,0.7)', fontFamily: "'DM Mono', monospace", minWidth: '32px' }}>
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.5}
              value={currentTime}
              onChange={handleScrub}
              style={{
                flex: 1, height: '3px', accentColor: '#C9A96E',
                cursor: 'pointer', appearance: 'none',
                background: `linear-gradient(to right, #C9A96E ${(currentTime/(duration||1))*100}%, rgba(255,255,255,0.2) 0)`,
                borderRadius: '2px', outline: 'none', border: 'none',
              }}
            />
            <span style={{ fontSize: '9.5px', color: 'rgba(250,247,243,0.7)', fontFamily: "'DM Mono', monospace", minWidth: '32px', textAlign: 'right' }}>
              {formatTime(duration)}
            </span>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Back to highlight */}
            <button onClick={exitFullMode} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '10px', color: 'rgba(250,247,243,0.55)',
              fontFamily: "'DM Sans', sans-serif", padding: '4px 0',
            }}>
              ← Highlight
            </button>

            {/* Play/pause */}
            <button onClick={togglePlay} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(201,169,110,0.85)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {isPlaying ? (
                // Pause icon
                <div style={{ display: 'flex', gap: '3px' }}>
                  <div style={{ width: 3, height: 12, background: '#1C1510', borderRadius: '1px' }} />
                  <div style={{ width: 3, height: 12, background: '#1C1510', borderRadius: '1px' }} />
                </div>
              ) : (
                // Play triangle
                <div style={{
                  width: 0, height: 0, borderStyle: 'solid',
                  borderWidth: '7px 0 7px 13px',
                  borderColor: 'transparent transparent transparent #1C1510',
                  marginLeft: '4px',
                }} />
              )}
            </button>

            {/* Speed */}
            <button onClick={cycleSpeed} style={{
              background: 'rgba(255,255,255,0.12)', border: 'none',
              borderRadius: '6px', padding: '4px 8px', cursor: 'pointer',
              fontSize: '11px', fontWeight: 600,
              color: 'rgba(250,247,243,0.85)', fontFamily: "'DM Mono', monospace",
            }}>
              {playbackRate === 1 ? '1×' : playbackRate === 2 ? '2×' : '0.5×'}
            </button>

            {/* Best moment jump */}
            <button
              onClick={() => {
                const video = videoRef.current;
                if (video) { video.currentTime = bestMomentStart; setCurrentTime(bestMomentStart); }
              }}
              style={{
                marginLeft: 'auto', background: 'rgba(201,169,110,0.15)',
                border: '1px solid rgba(201,169,110,0.35)', borderRadius: '6px',
                padding: '4px 8px', cursor: 'pointer',
                fontSize: '10px', color: 'rgba(201,169,110,0.9)',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Best moment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Main VideoAnalysis component
// ─────────────────────────────────────────────────────────

interface VideoAnalysisProps {
  hasVideo:         boolean;
  analysisResult:   VideoAnalysisResult | null;
  analysisStatus:   AnalysisStatus;
  analysisProgress: number;
  analysisError:    string | null;
  onVideoSelected:  (file: File) => void;
  mockBiometrics?:  BiometricsSnapshot;
  mockInsights?:    MovementInsight[];
}

export default function VideoAnalysis({
  hasVideo,
  analysisResult,
  analysisStatus,
  analysisProgress,
  analysisError,
  onVideoSelected,
  mockBiometrics,
  mockInsights,
}: VideoAnalysisProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('movement');

  const triggerFileSelect = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onVideoSelected(file);
  };

  // ── Analyzing ───────────────────────────────────────────
  if (['loading-model', 'extracting', 'processing'].includes(analysisStatus)) {
    return (
      <div style={{ background: '#FFFFFF', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>
        <AnalysisProgress status={analysisStatus} progress={analysisProgress} />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────
  if (analysisStatus === 'error' && analysisError) {
    return (
      <div style={{ border: '1.5px solid #EDE7DF', borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '20px', marginBottom: '6px' }}>⚠️</div>
        <div style={{ fontSize: '13px', fontWeight: 500, color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif", marginBottom: '4px' }}>Analysis failed</div>
        <div style={{ fontSize: '11px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginBottom: '14px' }}>{analysisError}</div>
        <button onClick={triggerFileSelect} style={{
          background: '#8C5A3C', border: 'none', borderRadius: '10px',
          padding: '8px 18px', cursor: 'pointer',
          fontSize: '12px', color: '#FAF7F3',
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
        }}>
          Try again
        </button>
        <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>
    );
  }

  // ── No video uploaded — empty state ────────────────────
  if (!hasVideo && !analysisResult) {
    return (
      <>
        <div onClick={triggerFileSelect} style={{
          border: '1.5px dashed #EDE7DF', borderRadius: '16px',
          padding: '24px 20px', textAlign: 'center', cursor: 'pointer',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '6px' }}>🎬</div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif" }}>
            Add a video to this ride
          </div>
          <div style={{ fontSize: '11px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif", marginTop: '3px', lineHeight: 1.5 }}>
            Upload your video — Cadence analyses your position<br />
            <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace" }}>
              Processed on your device · Private
            </span>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
      </>
    );
  }

  // ── Data state — real analysis OR mock (hasVideo) ──────
  const activeBiometrics = analysisResult?.biometrics ?? mockBiometrics;
  const activeInsights   = analysisResult
    ? analysisResult.insights
    : (mockInsights ?? []);

  return (
    <div style={{ background: '#FFFFFF', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>

      {/* ── Video / Skeleton frame ── */}
      {analysisResult?.videoPlaybackUrl && activeBiometrics ? (
        <VideoClipPlayer
          videoUrl={analysisResult.videoPlaybackUrl}
          bestMomentStart={analysisResult.bestMomentStart}
          allFrames={analysisResult.allFrames}
          biometrics={activeBiometrics}
          frameCount={analysisResult.frameCount}
        />
      ) : (
        /* Mock skeleton — click to upload */
        <div style={{ position: 'relative', background: '#1C1510', overflow: 'hidden' }}>
          <div style={{ cursor: 'pointer', position: 'relative' }} onClick={triggerFileSelect}>
            <MockVideoFrame biometrics={mockBiometrics} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(28,21,16,0.38)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                background: 'rgba(201,169,110,0.12)',
                border: '1px solid rgba(201,169,110,0.4)',
                borderRadius: '10px', padding: '7px 15px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '11.5px', color: '#C9A96E', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
                  Upload your ride video
                </div>
                <div style={{ fontSize: '9px', color: 'rgba(201,169,110,0.6)', fontFamily: "'DM Mono', monospace", marginTop: '2px' }}>
                  Cadence will analyse your position
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab switcher ── */}
      <div style={{ paddingTop: '14px', paddingBottom: '2px' }}>
        <TabSwitcher activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'movement' && <InsightRows insights={activeInsights} />}

      {activeTab === 'body' && activeBiometrics && (
        <>
          <RiderBodyDiagram biometrics={activeBiometrics} />
          <IssueSummarySection biometrics={activeBiometrics} />
        </>
      )}

      {activeTab === 'quality' && activeBiometrics && (
        <RidingQualityPanel biometrics={activeBiometrics} />
      )}

      {/* File input (hidden) */}
      <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  );
}
