import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockRides, mockGoal } from '../data/mock';
import type { Ride, BiometricsSnapshot } from '../data/mock';
import { useVideoAnalysis } from '../hooks/useVideoAnalysis';
import { computeRidingQualities, generateInsights } from '../lib/poseAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';
import { saveRide, getRides } from '../lib/storage';
import type { StoredRide } from '../lib/storage';
import { getUserProfile, isProfileComplete } from '../lib/userProfile';
import VideoSilhouetteOverlay from '../components/VideoSilhouetteOverlay';
import ProfileSetupModal from '../components/ProfileSetupModal';

// ─────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────

const COLORS = {
  parchment:  '#FAF7F3',
  cognac:     '#8C5A3C',
  champagne:  '#C9A96E',
  green:      '#7D9B76',
  attention:  '#C4714A',
  charcoal:   '#1A140E',
  muted:      '#B5A898',
  border:     '#EDE7DF',
  cardBg:     '#FFFFFF',
  softBg:     '#F0EBE4',
  cadence:    '#6B7FA3',
};

const FONTS = {
  heading: "'Playfair Display', serif",
  body:    "'DM Sans', sans-serif",
  mono:    "'DM Mono', monospace",
};

const signalConfig = {
  improving:    { color: COLORS.green,     symbol: '↑', label: 'Improving' },
  consistent:   { color: COLORS.champagne, symbol: '→', label: 'Consistent' },
  'needs-work': { color: COLORS.attention, symbol: '↓', label: 'Needs work' },
};

const rideTypeLabel: Record<string, string> = {
  training:    '🐎 Training',
  lesson:      '👩‍🏫 Lesson',
  'mock-test': '📋 Mock Test',
  hack:        '🌳 Hack',
};

function scoreColor(score: number): string {
  if (score >= 0.80) return COLORS.green;
  if (score >= 0.60) return COLORS.champagne;
  return COLORS.attention;
}

function scoreLabel(score: number): string {
  if (score >= 0.85) return 'Excellent';
  if (score >= 0.70) return 'Good';
  if (score >= 0.55) return 'Developing';
  return 'Focus area';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Card #59 — allowed formats + size threshold
const ALLOWED_FORMATS = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
const SIZE_WARN_MB = 500;

// Card #59 — cycling processing messages
const PROCESSING_MESSAGES = [
  'Reading your ride…',
  'Analyzing movement…',
  'Calculating scores…',
];

// ─────────────────────────────────────────────────────────
// CAMERA TIPS CHIPS (#59)
// ─────────────────────────────────────────────────────────

function CameraTips() {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
      {[
        { icon: '📐', text: 'Side view works best' },
        { icon: '☀️', text: 'Good lighting helps' },
        { icon: '📱', text: 'Any orientation works' },
      ].map(tip => (
        <div
          key={tip.text}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            background: 'rgba(201,169,110,0.12)',
            border: '1px solid rgba(201,169,110,0.35)',
            borderRadius: '20px', padding: '5px 10px',
            fontSize: '11px', color: '#7A6B5D',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <span style={{ fontSize: '12px' }}>{tip.icon}</span>
          {tip.text}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// BRANDED PULSE (#60)
// ─────────────────────────────────────────────────────────

function BrandedPulse() {
  return (
    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 8, height: 8,
            borderRadius: '50%',
            background: '#C9A96E',
            animation: `champagnePulse 1.4s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MOCK DATA FOR RIDE DETAIL
// ─────────────────────────────────────────────────────────

const MOCK_DETAIL_BIO: BiometricsSnapshot = {
  lowerLegStability:  0.72,
  reinSteadiness:     0.68,
  reinSymmetry:       0.59,
  coreStability:      0.88,
  upperBodyAlignment: 0.81,
  pelvisStability:    0.74,
};

const METRIC_DETAIL_CONFIG = [
  {
    key: 'lowerLegStability' as keyof BiometricsSnapshot,
    label: 'Lower Leg Stability',
    shortLabel: 'Lower Leg',
    score: 72,
    trend: '↑' as const,
    trendDir: 'up' as const,
    insight: 'Minor drift detected on left rein — improves in second half of ride.',
  },
  {
    key: 'reinSteadiness' as keyof BiometricsSnapshot,
    label: 'Rein Steadiness',
    shortLabel: 'Rein Steady',
    score: 68,
    trend: '→' as const,
    trendDir: 'flat' as const,
    insight: 'Consistent through walk and canter; some bounce visible in rising trot.',
  },
  {
    key: 'reinSymmetry' as keyof BiometricsSnapshot,
    label: 'Rein Symmetry',
    shortLabel: 'Symmetry',
    score: 59,
    trend: '↓' as const,
    trendDir: 'down' as const,
    insight: 'Right hand sits 2–3cm higher. Watch elbow angle on right rein transitions.',
  },
  {
    key: 'coreStability' as keyof BiometricsSnapshot,
    label: 'Core Stability',
    shortLabel: 'Core',
    score: 88,
    trend: '↑' as const,
    trendDir: 'up' as const,
    insight: 'Your strongest metric. Torso steady through all gait transitions.',
  },
  {
    key: 'upperBodyAlignment' as keyof BiometricsSnapshot,
    label: 'Upper Body Alignment',
    shortLabel: 'Upper Body',
    score: 81,
    trend: '↑' as const,
    trendDir: 'up' as const,
    insight: 'Shoulder–hip–heel line clean throughout. Slight forward lean on downward transitions.',
  },
  {
    key: 'pelvisStability' as keyof BiometricsSnapshot,
    label: 'Pelvis Stability',
    shortLabel: 'Pelvis',
    score: 74,
    trend: '→' as const,
    trendDir: 'flat' as const,
    insight: 'Good sitting trot absorption. Some lateral tilt visible in canter left.',
  },
];

// ─────────────────────────────────────────────────────────
// RIDE DETAIL — HERO SCORE CIRCLE
// ─────────────────────────────────────────────────────────

function HeroScoreCircle({
  value,
  label,
  size = 88,
  strokeWidth = 7,
  color,
}: {
  value: number;
  label: string;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const r = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - value / 100);
  const c = color || scoreColor(value / 100);
  const cx = size / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke={COLORS.softBg} strokeWidth={strokeWidth} />
          <circle
            cx={cx} cy={cx} r={r}
            fill="none"
            stroke={c}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.9s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: size > 80 ? '22px' : '16px', fontWeight: 700, color: c, lineHeight: 1 }}>
            {value}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: '9px', color: COLORS.muted, lineHeight: 1, marginTop: 2 }}>
            /100
          </span>
        </div>
      </div>
      <span style={{ fontFamily: FONTS.body, fontSize: '11px', color: COLORS.muted, fontWeight: 500, textAlign: 'center' }}>
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RIDE DETAIL — PER-METRIC CARD
// ─────────────────────────────────────────────────────────

function MetricDetailCard({
  label,
  score,
  trend,
  trendDir,
  insight,
}: {
  label: string;
  score: number;
  trend: '↑' | '↓' | '→';
  trendDir: 'up' | 'down' | 'flat';
  insight: string;
}) {
  const sc = scoreColor(score / 100);
  const trendColor = trendDir === 'up' ? COLORS.green : trendDir === 'down' ? COLORS.attention : COLORS.champagne;
  const barWidth = `${score}%`;

  return (
    <div style={{
      background: COLORS.cardBg, borderRadius: 16, padding: '14px 16px',
      boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
      borderLeft: `3px solid ${sc}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: FONTS.body, fontSize: '12.5px', fontWeight: 600, color: COLORS.charcoal }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: '15px', fontWeight: 700, color: sc }}>{score}</span>
          <span style={{
            fontFamily: FONTS.mono, fontSize: '13px', color: trendColor,
            background: `${trendColor}15`, borderRadius: 6, padding: '1px 5px',
            fontWeight: 600,
          }}>{trend}</span>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ height: 4, background: COLORS.softBg, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          height: '100%', width: barWidth, background: sc,
          borderRadius: 2, transition: 'width 0.7s ease',
        }} />
      </div>

      {/* Color indicator chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc, flexShrink: 0 }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: '9px', color: sc, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {scoreLabel(score / 100)}
        </span>
      </div>

      <p style={{ fontFamily: FONTS.body, fontSize: '11.5px', color: '#7A6B5D', lineHeight: 1.5, margin: 0 }}>
        {insight}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RIDE DETAIL — KEY MOMENTS
// ─────────────────────────────────────────────────────────

function KeyMomentsSection({ duration }: { duration: number }) {
  const bestTs = Math.floor(duration * 60 * 0.38);
  const needsTs = Math.floor(duration * 60 * 0.67);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontFamily: FONTS.heading, fontSize: 15, color: COLORS.charcoal }}>Key Moments</span>
      </div>

      <div style={{
        background: `${COLORS.green}10`, borderRadius: 14, padding: '12px 14px',
        border: `1px solid ${COLORS.green}30`,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: `${COLORS.green}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontSize: 14 }}>⭐</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontFamily: FONTS.body, fontSize: '12px', fontWeight: 600, color: COLORS.green }}>Best Moment</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: '10px', color: COLORS.muted, background: COLORS.softBg, padding: '2px 6px', borderRadius: 6 }}>
              {fmt(bestTs)}
            </span>
          </div>
          <p style={{ fontFamily: FONTS.body, fontSize: '11.5px', color: '#5A7A56', lineHeight: 1.5, margin: 0 }}>
            Extended trot — shoulder-in left. Core and upper body in excellent alignment. Horse working through from behind.
          </p>
        </div>
      </div>

      <div style={{
        background: `${COLORS.attention}08`, borderRadius: 14, padding: '12px 14px',
        border: `1px solid ${COLORS.attention}25`,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: `${COLORS.attention}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontSize: 14 }}>🎯</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontFamily: FONTS.body, fontSize: '12px', fontWeight: 600, color: COLORS.attention }}>Needs Work</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: '10px', color: COLORS.muted, background: COLORS.softBg, padding: '2px 6px', borderRadius: 6 }}>
              {fmt(needsTs)}
            </span>
          </div>
          <p style={{ fontFamily: FONTS.body, fontSize: '11.5px', color: '#7A5A4A', lineHeight: 1.5, margin: 0 }}>
            Canter–trot transition right rein. Right hand tension causing rein asymmetry spike. Loss of inside leg contact.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RIDE DETAIL — ACTIONABLE TIPS
// ─────────────────────────────────────────────────────────

function ActionableTips({ bio }: { bio: BiometricsSnapshot }) {
  // Find 3 lowest-scoring metrics
  const metrics = [
    { key: 'lowerLegStability' as keyof BiometricsSnapshot, label: 'Lower Leg Stability', score: bio.lowerLegStability },
    { key: 'reinSteadiness' as keyof BiometricsSnapshot, label: 'Rein Steadiness', score: bio.reinSteadiness },
    { key: 'reinSymmetry' as keyof BiometricsSnapshot, label: 'Rein Symmetry', score: bio.reinSymmetry },
    { key: 'coreStability' as keyof BiometricsSnapshot, label: 'Core Stability', score: bio.coreStability },
    { key: 'upperBodyAlignment' as keyof BiometricsSnapshot, label: 'Upper Body Alignment', score: bio.upperBodyAlignment },
    { key: 'pelvisStability' as keyof BiometricsSnapshot, label: 'Pelvis Stability', score: bio.pelvisStability },
  ].sort((a, b) => a.score - b.score);

  const tipMap: Record<string, { tip: string; drill: string }> = {
    lowerLegStability:  { tip: 'Anchor your lower leg', drill: 'Try 10 minutes of stirrup-less walk and trot to reset your ankle position.' },
    reinSteadiness:     { tip: 'Soften the contact', drill: 'Tunnel rein exercise: thread reins through a loop so hands can\'t cross the midline.' },
    reinSymmetry:       { tip: 'Level your elbows', drill: 'Place a crop across your forearms to monitor left–right height before each set.' },
    coreStability:      { tip: 'Engage the deep core', drill: 'Practise breathing into your lower back through every gait transition.' },
    upperBodyAlignment: { tip: 'Sit tall through transitions', drill: 'Pick a spot ahead and keep eyes level. Ask your trainer to watch your downward transitions.' },
    pelvisStability:    { tip: 'Follow the swing, don\'t grip', drill: 'Loosen hip flexors: 5-minute lunge in walk before each ride, focus on pelvis follow-through.' },
  };

  const tips = metrics.slice(0, 3).map(m => ({ label: m.label, ...tipMap[m.key] }));

  return (
    <div>
      <div style={{ fontFamily: FONTS.heading, fontSize: 15, color: COLORS.charcoal, marginBottom: 10 }}>
        Actionable Tips
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tips.map((t, i) => (
          <div key={i} style={{
            background: COLORS.cardBg, borderRadius: 14, padding: '12px 14px',
            boxShadow: '0 2px 8px rgba(26,20,14,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                background: `${COLORS.cognac}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONTS.mono, fontSize: '10px', fontWeight: 700, color: COLORS.cognac,
                flexShrink: 0, marginTop: 1,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONTS.body, fontSize: '12px', fontWeight: 600, color: COLORS.charcoal, marginBottom: 2 }}>
                  {t.tip}
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: '9px', color: COLORS.champagne, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  {t.label}
                </div>
                <p style={{ fontFamily: FONTS.body, fontSize: '11px', color: '#7A6B5D', lineHeight: 1.5, margin: 0 }}>
                  {t.drill}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RIDE DETAIL — GAIT BREAKDOWN
// ─────────────────────────────────────────────────────────

function GaitBreakdown({ duration }: { duration: number }) {
  const gaits = [
    { name: 'Walk', pct: 22, color: COLORS.cadence },
    { name: 'Trot', pct: 51, color: COLORS.champagne },
    { name: 'Canter', pct: 27, color: COLORS.cognac },
  ];

  return (
    <div style={{
      background: COLORS.cardBg, borderRadius: 16, padding: '14px 16px',
      boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
    }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: '10px', fontWeight: 600, color: COLORS.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
        Gait Breakdown
      </div>

      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        {gaits.map(g => (
          <div key={g.name} style={{ width: `${g.pct}%`, background: g.color, transition: 'width 0.6s ease' }} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {gaits.map(g => (
          <div key={g.name} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: '16px', fontWeight: 700, color: g.color }}>{g.pct}%</div>
            <div style={{ fontFamily: FONTS.body, fontSize: '10px', color: COLORS.muted }}>{g.name}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: '9px', color: COLORS.muted, marginTop: 1 }}>
              {Math.round(duration * 60 * g.pct / 100 / 60)}m {Math.round((duration * 60 * g.pct / 100) % 60)}s
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RICH RIDE DETAIL VIEW — CARD #56
// ─────────────────────────────────────────────────────────

function RideDetailView({
  ride,
  storedRide,
  onClose,
}: {
  ride: Ride;
  storedRide?: StoredRide;
  onClose: () => void;
}) {
  const bio = storedRide?.biometrics ?? ride.biometrics ?? MOCK_DETAIL_BIO;
  const effectiveBio = bio || MOCK_DETAIL_BIO;

  const qualities = computeRidingQualities(effectiveBio);
  const d = new Date(ride.date);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const overallRaw = storedRide?.overallScore
    ?? (Object.values(effectiveBio).reduce((a, b) => a + b, 0) / Object.values(effectiveBio).length);
  const overallPct = Math.round(overallRaw * 100);

  // Movement score = avg of the 3 movement-related metrics
  const movementPct = Math.round(
    ((effectiveBio.lowerLegStability + effectiveBio.reinSteadiness + effectiveBio.coreStability) / 3) * 100
  );
  // Position score = avg of position-related metrics
  const positionPct = Math.round(
    ((effectiveBio.upperBodyAlignment + effectiveBio.pelvisStability + effectiveBio.reinSymmetry) / 3) * 100
  );

  // Build metric cards with live bio scores
  const metricCards = [
    {
      key: 'lowerLegStability' as keyof BiometricsSnapshot,
      label: 'Lower Leg Stability',
      score: Math.round(effectiveBio.lowerLegStability * 100),
      trend: effectiveBio.lowerLegStability >= 0.75 ? '↑' : effectiveBio.lowerLegStability >= 0.60 ? '→' : '↓',
      trendDir: effectiveBio.lowerLegStability >= 0.75 ? 'up' : effectiveBio.lowerLegStability >= 0.60 ? 'flat' : 'down',
      insight: METRIC_DETAIL_CONFIG[0].insight,
    },
    {
      key: 'reinSteadiness' as keyof BiometricsSnapshot,
      label: 'Rein Steadiness',
      score: Math.round(effectiveBio.reinSteadiness * 100),
      trend: effectiveBio.reinSteadiness >= 0.75 ? '↑' : effectiveBio.reinSteadiness >= 0.60 ? '→' : '↓',
      trendDir: effectiveBio.reinSteadiness >= 0.75 ? 'up' : effectiveBio.reinSteadiness >= 0.60 ? 'flat' : 'down',
      insight: METRIC_DETAIL_CONFIG[1].insight,
    },
    {
      key: 'reinSymmetry' as keyof BiometricsSnapshot,
      label: 'Rein Symmetry',
      score: Math.round(effectiveBio.reinSymmetry * 100),
      trend: effectiveBio.reinSymmetry >= 0.75 ? '↑' : effectiveBio.reinSymmetry >= 0.60 ? '→' : '↓',
      trendDir: effectiveBio.reinSymmetry >= 0.75 ? 'up' : effectiveBio.reinSymmetry >= 0.60 ? 'flat' : 'down',
      insight: METRIC_DETAIL_CONFIG[2].insight,
    },
    {
      key: 'coreStability' as keyof BiometricsSnapshot,
      label: 'Core Stability',
      score: Math.round(effectiveBio.coreStability * 100),
      trend: effectiveBio.coreStability >= 0.82 ? '↑' : effectiveBio.coreStability >= 0.65 ? '→' : '↓',
      trendDir: effectiveBio.coreStability >= 0.82 ? 'up' : effectiveBio.coreStability >= 0.65 ? 'flat' : 'down',
      insight: METRIC_DETAIL_CONFIG[3].insight,
    },
    {
      key: 'upperBodyAlignment' as keyof BiometricsSnapshot,
      label: 'Upper Body Alignment',
      score: Math.round(effectiveBio.upperBodyAlignment * 100),
      trend: effectiveBio.upperBodyAlignment >= 0.78 ? '↑' : effectiveBio.upperBodyAlignment >= 0.60 ? '→' : '↓',
      trendDir: effectiveBio.upperBodyAlignment >= 0.78 ? 'up' : effectiveBio.upperBodyAlignment >= 0.60 ? 'flat' : 'down',
      insight: METRIC_DETAIL_CONFIG[4].insight,
    },
    {
      key: 'pelvisStability' as keyof BiometricsSnapshot,
      label: 'Pelvis Stability',
      score: Math.round(effectiveBio.pelvisStability * 100),
      trend: effectiveBio.pelvisStability >= 0.75 ? '↑' : effectiveBio.pelvisStability >= 0.60 ? '→' : '↓',
      trendDir: effectiveBio.pelvisStability >= 0.75 ? 'up' : effectiveBio.pelvisStability >= 0.60 ? 'flat' : 'down',
      insight: METRIC_DETAIL_CONFIG[5].insight,
    },
  ] as { key: keyof BiometricsSnapshot; label: string; score: number; trend: '↑'|'↓'|'→'; trendDir: 'up'|'down'|'flat'; insight: string }[];

  const discipline = ride.type === 'mock-test' ? 'Dressage' : ride.type === 'hack' ? 'Hacking' : 'Flatwork';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 100, background: COLORS.parchment,
      animation: 'slideInRight 0.25s ease-out',
      overflowY: 'auto',
    }}>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes detailFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Sticky Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 20px',
        paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
        borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.parchment, position: 'sticky', top: 0, zIndex: 2,
        backdropFilter: 'blur(8px)',
      }}>
        <button
          onClick={onClose}
          style={{
            background: COLORS.softBg, border: 'none', cursor: 'pointer', padding: '6px 8px',
            display: 'flex', alignItems: 'center', borderRadius: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke={COLORS.charcoal} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONTS.heading, fontSize: '15px', color: COLORS.charcoal }}>
            {rideTypeLabel[ride.type] ?? ride.type} · {ride.horse}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: '10px', color: COLORS.muted }}>
            {dateStr}
          </div>
        </div>
        <div style={{
          background: `${scoreColor(overallRaw)}15`, color: scoreColor(overallRaw),
          padding: '5px 12px', borderRadius: 10,
          fontFamily: FONTS.mono, fontSize: '14px', fontWeight: 700,
        }}>
          {overallPct}
        </div>
      </div>

      <div style={{ padding: '0 0 40px', animation: 'detailFadeIn 0.35s ease' }}>

        {/* ── 1. VIDEO THUMBNAIL / PLACEHOLDER ── */}
        <div style={{
          width: '100%', aspectRatio: '16/9',
          background: 'linear-gradient(135deg, #1C1510 0%, #3A2518 50%, #1C1510 100%)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Decorative overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at 60% 40%, rgba(201,169,110,0.12) 0%, transparent 60%)',
          }} />
          {/* Content */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8,
          }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect x="3" y="5" width="30" height="26" rx="4" stroke="rgba(201,169,110,0.5)" strokeWidth="1.5" />
              <path d="M15 12l10 6-10 6V12z" fill="rgba(201,169,110,0.7)" />
            </svg>
            <span style={{ fontFamily: FONTS.body, fontSize: '12px', color: 'rgba(250,247,243,0.5)' }}>
              {ride.horse} · {discipline}
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: '10px', color: 'rgba(201,169,110,0.6)' }}>
              {dateStr} · {ride.duration}min
            </span>
          </div>
        </div>

        {/* ── 2. HERO SCORES ── */}
        <div style={{
          background: COLORS.cardBg, margin: '0 0 0',
          padding: '22px 20px 20px',
          boxShadow: '0 2px 12px rgba(26,20,14,0.07)',
        }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: '10px', fontWeight: 600, color: COLORS.muted, letterSpacing: '0.14em', textTransform: 'uppercase', textAlign: 'center', marginBottom: 16 }}>
            Analysis Results
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
            <HeroScoreCircle value={overallPct} label="Overall" size={92} strokeWidth={7} />
            <HeroScoreCircle value={movementPct} label="Movement" size={80} strokeWidth={6} color={COLORS.cadence} />
            <HeroScoreCircle value={positionPct} label="Position" size={80} strokeWidth={6} color={COLORS.champagne} />
          </div>
        </div>

        {/* ── 3. PER-METRIC BREAKDOWN ── */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: FONTS.heading, fontSize: 17, color: COLORS.charcoal }}>Metric Breakdown</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>6 Tier-1 metrics</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {metricCards.map(m => (
              <MetricDetailCard
                key={m.key}
                label={m.label}
                score={m.score}
                trend={m.trend}
                trendDir={m.trendDir}
                insight={m.insight}
              />
            ))}
          </div>
        </div>

        {/* ── 4. KEY MOMENTS ── */}
        <div style={{ padding: '20px 16px 0' }}>
          <KeyMomentsSection duration={ride.duration} />
        </div>

        {/* ── 5. ACTIONABLE TIPS ── */}
        <div style={{ padding: '20px 16px 0' }}>
          <ActionableTips bio={effectiveBio} />
        </div>

        {/* ── 6. METADATA ── */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ fontFamily: FONTS.heading, fontSize: 15, color: COLORS.charcoal, marginBottom: 10 }}>
            Session Info
          </div>

          <div style={{
            background: COLORS.cardBg, borderRadius: 16, padding: '14px 16px',
            boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
          }}>
            {/* Metadata grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 14 }}>
              {[
                { label: 'Date', value: dateStr },
                { label: 'Duration', value: `${ride.duration} min` },
                { label: 'Discipline', value: discipline },
                { label: 'Horse', value: ride.horse },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: '9px', color: COLORS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                    {item.label}
                  </div>
                  <div style={{ fontFamily: FONTS.body, fontSize: '12.5px', color: COLORS.charcoal, fontWeight: 500 }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <GaitBreakdown duration={ride.duration} />
          </div>

          {/* Reflection (if available) */}
          {ride.reflection && (
            <div style={{
              marginTop: 10, background: COLORS.cardBg, borderRadius: 14,
              padding: '14px 16px', border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ fontFamily: FONTS.heading, fontSize: '13px', color: COLORS.charcoal, marginBottom: 6 }}>
                Ride Notes
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: '12px', color: '#6B5E50', lineHeight: 1.55 }}>
                {ride.reflection}
              </div>
            </div>
          )}
        </div>

        {/* ── Riding Quality (Scales of Training) ── */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: FONTS.heading, fontSize: 17, color: COLORS.charcoal }}>Riding Quality</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>Training Scales</span>
          </div>
          <div style={{
            background: COLORS.cardBg, borderRadius: 16, padding: '14px 16px',
            boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
          }}>
            {qualities.map((q, i) => {
              const qualityColors = ['#C9A96E', '#7D9B76', '#8C5A3C', '#C4714A', '#6B7FA3', '#B5A898'];
              const c = qualityColors[i];
              const pct = Math.round(q.score * 100);
              return (
                <div key={q.name} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderBottom: i < qualities.length - 1 ? `1px solid ${COLORS.softBg}` : 'none',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONTS.body, fontSize: '12.5px', fontWeight: 500, color: COLORS.charcoal }}>
                      {q.name}
                    </div>
                    <div style={{ fontFamily: FONTS.body, fontSize: '10px', color: COLORS.muted }}>
                      {q.qualityNote}
                    </div>
                  </div>
                  <div style={{
                    height: 4, width: 60, background: COLORS.softBg, borderRadius: 2, overflow: 'hidden', marginRight: 8,
                  }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: '13px', fontWeight: 700, color: c, minWidth: 24, textAlign: 'right' }}>
                    {pct}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────

export default function RidesPage() {
  const navigate = useNavigate();

  // Profile setup
  const [showProfileSetup, setShowProfileSetup] = useState(() => !isProfileComplete());

  // Log form state
  const [showLogForm, setShowLogForm] = useState(false);
  const [logNote, setLogNote] = useState('');
  const [logFocus, setLogFocus] = useState(mockGoal.milestones[0].id);
  const [logDuration, setLogDuration] = useState('45');
  const [logType, setLogType] = useState<'training' | 'lesson' | 'hack'>('training');
  const [logSubmitted, setLogSubmitted] = useState(false);

  // Video analysis
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const { status, progress, result, error, analyzeVideo, reset } = useVideoAnalysis();

  // Saved ride state
  const [sessionSaved, setSessionSaved] = useState(false);

  // Card #59 — validation & UX state
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileSizeWarning, setFileSizeWarning] = useState<string | null>(null);
  const [processingMsgIdx, setProcessingMsgIdx] = useState(0);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);

  // Detail view for ride history
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [selectedStoredRide, setSelectedStoredRide] = useState<StoredRide | undefined>(undefined);
  const [storedRides, setStoredRides] = useState<StoredRide[]>(getRides);

  // Refresh stored rides on mount
  useEffect(() => {
    setStoredRides(getRides());
  }, []);

  const isDone = status === 'done' && result !== null;
  const isAnalyzing = status === 'loading-model' || status === 'extracting' || status === 'processing';

  // Card #59 — cycle processing messages every 2s
  useEffect(() => {
    if (!isAnalyzing) return;
    const interval = setInterval(() => {
      setProcessingMsgIdx(i => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  // Card #59 — show success animation on completion
  useEffect(() => {
    if (isDone) {
      setShowSuccessAnim(true);
      const t = setTimeout(() => setShowSuccessAnim(false), 1800);
      return () => clearTimeout(t);
    }
  }, [isDone]);

  const handleLogSubmit = () => {
    setLogSubmitted(true);
    setTimeout(() => {
      setLogSubmitted(false);
      setShowLogForm(false);
      setLogNote('');
    }, 2000);
  };

  // Card #59 — validate file before analyzing
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFileSizeWarning(null);

    // Format validation
    const isAllowed = ALLOWED_FORMATS.includes(file.type) ||
      /\.(mp4|mov|avi)$/i.test(file.name);
    if (!isAllowed) {
      setFileError('Please use MP4 or MOV format');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Size warning > 500MB
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > SIZE_WARN_MB) {
      setFileSizeWarning('Large video — analysis may take a few minutes');
    }

    setVideoFile(file);
    setSessionSaved(false);
    setProcessingMsgIdx(0);
    analyzeVideo(file);
  };

  // Card #59 — cancel mid-processing
  const handleCancelProcessing = () => {
    handleReset();
  };

  const handleSaveSession = () => {
    if (!result || !videoFile) return;
    const bio = result.biometrics;
    const qualities = computeRidingQualities(bio);
    const overall = Object.values(bio).reduce((a, b) => a + b, 0) / Object.values(bio).length;

    const ride: StoredRide = {
      id: `stored-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      horse: getUserProfile().horseName || 'Your Horse',
      type: logType,
      duration: parseInt(logDuration, 10) || 45,
      videoFileName: videoFile.name,
      biometrics: { ...bio },
      ridingQuality: {
        rhythm:       qualities[0].score,
        relaxation:   qualities[1].score,
        contact:      qualities[2].score,
        impulsion:    qualities[3].score,
        straightness: qualities[4].score,
        balance:      qualities[5].score,
      },
      overallScore: Math.round(overall * 100) / 100,
      insights: result.insights.map(i => i.text),
    };

    saveRide(ride);
    setStoredRides(getRides());
    setSessionSaved(true);
  };

  const handleReset = () => {
    reset();
    setVideoFile(null);
    setSessionSaved(false);
    setFileError(null);
    setFileSizeWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Combine stored rides with mock rides for the history
  const allRides = useMemo(() => {
    // Convert stored rides to Ride-like objects for display
    const fromStorage: Ride[] = storedRides.map(sr => ({
      id: sr.id,
      date: sr.date,
      horse: sr.horse,
      type: sr.type,
      duration: sr.duration,
      focusMilestone: 'Video Analysis',
      reflection: sr.insights[0] ?? '',
      signal: sr.overallScore >= 0.75 ? 'improving' as const : sr.overallScore >= 0.60 ? 'consistent' as const : 'needs-work' as const,
      biometrics: sr.biometrics,
      videoUploaded: true,
      milestoneId: '',
    }));
    return [...fromStorage, ...mockRides];
  }, [storedRides]);

  const grouped = allRides.reduce((acc, ride) => {
    const d = new Date(ride.date);
    const key = d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
    if (!acc[key]) acc[key] = [];
    acc[key].push(ride);
    return acc;
  }, {} as Record<string, Ride[]>);

  // Status message for analysis progress — now cycling via PROCESSING_MESSAGES (#59)
  const statusMessage = PROCESSING_MESSAGES[processingMsgIdx];

  return (
    <div style={{ background: COLORS.parchment, minHeight: '100%' }}>

      {/* ── Profile Setup Modal (first visit) ──────────────── */}
      {showProfileSetup && (
        <ProfileSetupModal onComplete={() => setShowProfileSetup(false)} />
      )}

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {(() => {
              const profile = getUserProfile();
              const hour = new Date().getHours();
              const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
              const name = profile.firstName || '';
              return name ? (
                <>
                  <div style={{ fontFamily: FONTS.body, fontSize: '13px', color: COLORS.muted, marginBottom: '2px' }}>
                    {greeting}, {name}
                  </div>
                  <div style={{ fontFamily: FONTS.heading, fontSize: '26px', fontWeight: 400, color: COLORS.charcoal }}>
                    Ride Analysis
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: FONTS.heading, fontSize: '26px', fontWeight: 400, color: COLORS.charcoal }}>
                    Ride Analysis
                  </div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: '11px', color: COLORS.muted }}>
                    AI-powered biomechanics
                  </div>
                </>
              );
            })()}
          </div>
          {videoFile && (
            <button
              onClick={handleReset}
              style={{
                background: 'none',
                border: `1.5px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 500,
                color: '#7A6B5D',
                cursor: 'pointer',
                fontFamily: FONTS.body,
              }}
            >
              New Ride
            </button>
          )}
        </div>
      </div>

      {/* ── LOG FORM ────────────────────────────────────────── */}
      {showLogForm && (
        <div style={{
          background: COLORS.cardBg, margin: '12px 20px',
          borderRadius: '20px', padding: '20px',
          boxShadow: '0 4px 20px rgba(26,20,14,0.1)',
          border: `1px solid ${COLORS.softBg}`,
        }}>
          {logSubmitted ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>✓</div>
              <div style={{ fontFamily: FONTS.heading, fontSize: '18px', color: COLORS.cognac }}>
                Ride logged.
              </div>
              <div style={{ fontSize: '12px', color: COLORS.muted, fontFamily: FONTS.body, marginTop: '4px' }}>
                Cadence is analysing...
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div style={{ fontFamily: FONTS.heading, fontSize: '18px', color: COLORS.charcoal }}>Log a Ride</div>
                <button onClick={() => setShowLogForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: '20px' }}>×</button>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: COLORS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: FONTS.body, display: 'block', marginBottom: '8px' }}>Ride type</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['training', 'lesson', 'hack'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setLogType(type)}
                      style={{
                        flex: 1, padding: '8px 4px',
                        borderRadius: '10px', border: 'none', cursor: 'pointer',
                        background: logType === type ? COLORS.cognac : COLORS.softBg,
                        color: logType === type ? COLORS.parchment : '#7A6B5D',
                        fontSize: '12px', fontWeight: 500,
                        fontFamily: FONTS.body,
                      }}
                    >
                      {rideTypeLabel[type]}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: COLORS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: FONTS.body, display: 'block', marginBottom: '8px' }}>Duration (minutes)</label>
                <input
                  type="number"
                  value={logDuration}
                  onChange={e => setLogDuration(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px',
                    borderRadius: '10px', border: `1.5px solid ${COLORS.border}`,
                    fontSize: '14px', color: COLORS.charcoal,
                    fontFamily: FONTS.mono,
                    outline: 'none', background: COLORS.parchment,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: COLORS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: FONTS.body, display: 'block', marginBottom: '8px' }}>Focus milestone</label>
                <select
                  value={logFocus}
                  onChange={e => setLogFocus(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px',
                    borderRadius: '10px', border: `1.5px solid ${COLORS.border}`,
                    fontSize: '13px', color: COLORS.charcoal,
                    fontFamily: FONTS.body,
                    background: COLORS.parchment, outline: 'none',
                  }}
                >
                  {mockGoal.milestones.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: COLORS.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: FONTS.body, display: 'block', marginBottom: '8px' }}>Reflection (optional)</label>
                <textarea
                  value={logNote}
                  onChange={e => setLogNote(e.target.value)}
                  placeholder="How did the ride feel? What worked, what didn't?"
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px',
                    borderRadius: '10px', border: `1.5px solid ${COLORS.border}`,
                    fontSize: '13px', color: COLORS.charcoal,
                    fontFamily: FONTS.body,
                    background: COLORS.parchment, outline: 'none',
                    resize: 'none', lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Camera tips (#59) */}
              <CameraTips />
              {/* ── Video Upload Area ──────────────────────────── */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `1.5px dashed ${COLORS.border}`, borderRadius: '10px',
                  padding: '14px', textAlign: 'center', marginBottom: '18px',
                  cursor: 'pointer',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,.mp4,.mov,.avi"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 4 }}><rect x="3" y="4" width="18" height="16" rx="3" stroke={COLORS.champagne} strokeWidth="1.5" /><path d="M10 8.5V15.5L16 12L10 8.5Z" fill={COLORS.champagne} /></svg>
                <div style={{ fontSize: '12px', color: COLORS.muted, fontFamily: FONTS.body }}>
                  {videoFile ? videoFile.name : 'Upload video (optional)'}
                </div>
                <div style={{ fontSize: '11px', color: COLORS.champagne, fontFamily: FONTS.body, marginTop: '2px' }}>
                  Upload a riding video and Cadence will analyze your position
                </div>
              </div>

              <button
                onClick={handleLogSubmit}
                style={{
                  width: '100%', background: COLORS.cognac, color: COLORS.parchment,
                  border: 'none', borderRadius: '12px', padding: '13px',
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  fontFamily: FONTS.body,
                }}
              >
                Save Ride
              </button>
            </>
          )}
        </div>
      )}

      {/* ── FILE VALIDATION ERROR (#59) */}
      {fileError && (
        <div style={{
          margin: '0 20px 12px',
          background: 'rgba(196,113,74,0.1)',
          border: '1px solid rgba(196,113,74,0.25)',
          borderRadius: '12px', padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <span style={{ fontFamily: FONTS.body, fontSize: '13px', color: COLORS.attention, flex: 1 }}>
            {fileError}
          </span>
          <button onClick={() => setFileError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: '20px', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}

      {/* ── FILE SIZE WARNING (#59) */}
      {fileSizeWarning && (
        <div style={{
          margin: '0 20px 12px',
          background: 'rgba(201,169,110,0.12)',
          border: '1px solid rgba(201,169,110,0.3)',
          borderRadius: '12px', padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '16px' }}>⏱</span>
          <span style={{ fontFamily: FONTS.body, fontSize: '13px', color: '#7A6B5D', flex: 1 }}>
            {fileSizeWarning}
          </span>
          <button onClick={() => setFileSizeWarning(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: '20px', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}

            {/* ── VIDEO ANALYSIS SECTION ─────────────────────────── */}
      {(isAnalyzing || isDone || status === 'error') && (
        <div style={{ padding: '0 20px', marginBottom: '16px' }}>
          <div style={{
            background: COLORS.cardBg,
            borderRadius: '20px',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(26,20,14,0.1)',
            border: `1px solid ${COLORS.softBg}`,
          }}>

            {/* ── Video Area with Progress Overlay ──────────── */}
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#1A140E' }}>

              {/* Video element (visible during analysis and after done) */}
              {result?.videoPlaybackUrl && (
                <video
                  src={result.videoPlaybackUrl}
                  controls={isDone}
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}

              {/* Silhouette overlay — visible when analysis is complete */}
              {isDone && result && (
                <VideoSilhouetteOverlay biometrics={result.biometrics} />
              )}

              {/* ── Premium Progress Overlay ─────────────────── */}
              {isAnalyzing && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(26, 20, 14, 0.85)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: '16px',
                  animation: 'fadeIn 0.3s ease',
                }}>
                  {/* Circular progress ring */}
                  <div style={{ position: 'relative', width: 88, height: 88 }}>
                    <svg width="88" height="88" viewBox="0 0 88 88" style={{ transform: 'rotate(-90deg)' }}>
                      {/* Background ring */}
                      <circle
                        cx="44" cy="44" r="38"
                        fill="none"
                        stroke="rgba(201,169,110,0.2)"
                        strokeWidth="4"
                      />
                      {/* Progress ring */}
                      <circle
                        cx="44" cy="44" r="38"
                        fill="none"
                        stroke={COLORS.champagne}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 38}`}
                        strokeDashoffset={`${2 * Math.PI * 38 * (1 - progress / 100)}`}
                        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                      />
                    </svg>
                    {/* Percentage text */}
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: FONTS.mono, fontSize: '16px', color: COLORS.champagne,
                      fontWeight: 500,
                    }}>
                      {progress}%
                    </div>
                  </div>

                  {/* Status text */}
                  <div style={{
                    fontFamily: FONTS.body, fontSize: '13px', color: 'rgba(250,247,243,0.8)',
                    letterSpacing: '0.02em',
                  }}>
                    {statusMessage}
                  </div>

                  {/* Subtle pulsing dot */}
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: COLORS.champagne,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }} />
                </div>
              )}
            </div>

            {/* ── Error State ────────────────────────────────── */}
            {status === 'error' && (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: '#7A6B5D', fontFamily: FONTS.body, marginBottom: '6px' }}>
                  {error?.toLowerCase().includes('large') || error?.toLowerCase().includes('size')
                    ? 'Video too large — try trimming to under 10 minutes'
                    : 'Something went wrong — please try a different video'}
                </div>
                <button
                  onClick={handleReset}
                  style={{
                    background: COLORS.softBg, color: COLORS.cognac,
                    border: 'none', borderRadius: '10px', padding: '10px 20px',
                    fontSize: '13px', fontFamily: FONTS.body, fontWeight: 600,
                    cursor: 'pointer', minHeight: '44px',
                  }}
                >
                  Try Again
                </button>
              </div>
            )}

            {/* ── Results Panel ─────────────────────────────── */}
            {isDone && (
              <div style={{
                padding: '20px',
                animation: 'slideUp 0.5s ease',
              }}>
                <div style={{
                  fontFamily: FONTS.mono, fontSize: '10px', color: COLORS.muted,
                  marginBottom: '16px',
                }}>
                  {result.frameCount} frames analyzed
                </div>

                {/* ── Layer 1: Your Position ─────────────────── */}
                <LayerHeader icon="🧍" title="Your Position" subtitle="Movement & Biomechanics" />

                {/* 6 Radial Gauges — 2×3 grid */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '12px', marginBottom: '20px',
                }}>
                  {([
                    ['lowerLegStability',  'Lower Leg'],
                    ['reinSteadiness',     'Rein Steady'],
                    ['reinSymmetry',       'Symmetry'],
                    ['coreStability',      'Core'],
                    ['upperBodyAlignment', 'Upper Body'],
                    ['pelvisStability',    'Pelvis'],
                  ] as [keyof BiometricsSnapshot, string][]).map(([key, label]) => {
                    const val = result.biometrics[key];
                    return (
                      <RadialGauge key={key} value={val} label={label} />
                    );
                  })}
                </div>

                {/* ── Layer 2: Riding Quality ────────────────── */}
                <div style={{ marginTop: '8px', marginBottom: '20px' }}>
                  <LayerHeader icon="🎯" title="Riding Quality" subtitle="The Training Scales" />

                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '12px',
                  }}>
                    {(() => {
                      const qualities = computeRidingQualities(result.biometrics);
                      const qualityColors = ['#C9A96E', '#7D9B76', '#8C5A3C', '#C4714A', '#6B7FA3', '#B5A898'];
                      return qualities.map((q, i) => (
                        <RadialGauge key={q.name} value={q.score} label={q.name} color={qualityColors[i]} />
                      ));
                    })()}
                  </div>
                </div>

                {/* ── Insights Summary Card ──────────────────── */}
                <InsightsCard insights={result.insights} />

                {/* ── Save Session / Reset buttons ───────────── */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  {!sessionSaved ? (
                    <button
                      onClick={handleSaveSession}
                      style={{
                        flex: 1, background: COLORS.cognac, color: COLORS.parchment,
                        border: 'none', borderRadius: '12px', padding: '13px',
                        fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                        fontFamily: FONTS.body,
                      }}
                    >
                      Save Ride
                    </button>
                  ) : (
                    <div style={{
                      flex: 1, textAlign: 'center', padding: '13px',
                      background: `${COLORS.green}15`, borderRadius: '12px',
                      color: COLORS.green, fontFamily: FONTS.body,
                      fontSize: '14px', fontWeight: 600,
                    }}>
                      ✓ Ride Saved
                    </div>
                  )}
                  <button
                    onClick={handleReset}
                    style={{
                      background: COLORS.softBg, color: COLORS.muted,
                      border: 'none', borderRadius: '12px', padding: '13px 18px',
                      fontSize: '13px', fontFamily: FONTS.body, fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    New
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Quick Upload (when no analysis active) ──────── */}
      {status === 'idle' && !showLogForm && (
        <div style={{ padding: '0 20px', marginBottom: '12px' }}>
          {/* Camera tips (#59) */}
          <CameraTips />
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              position: 'relative',
              borderRadius: '20px',
              height: 220,
              overflow: 'hidden',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(26,20,14,0.12)',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov,.avi"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {/* Background image */}
            <img
              src={`${import.meta.env.BASE_URL}hero.jpg`}
              alt=""
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 40%',
              }}
            />
            {/* Dark gradient overlay */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, rgba(20,14,8,0.15) 0%, rgba(20,14,8,0.75) 100%)',
              pointerEvents: 'none',
            }} />
            {/* Content */}
            <div style={{
              position: 'absolute', bottom: 20, left: 20, right: 20,
            }}>
              <div style={{
                fontFamily: FONTS.heading, fontSize: '22px', color: COLORS.parchment,
                marginBottom: '6px',
                textShadow: '0 1px 6px rgba(0,0,0,0.3)',
              }}>
                Analyze Your Ride
              </div>
              <div style={{
                fontFamily: FONTS.body, fontSize: '12px', color: 'rgba(250,247,243,0.75)',
                lineHeight: 1.5, marginBottom: '14px', maxWidth: 260,
              }}>
                Upload a riding video and Cadence will analyze your position, balance, and biomechanics.
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: COLORS.cognac, color: COLORS.parchment,
                borderRadius: '14px', padding: '10px 22px',
                fontSize: '13px', fontWeight: 600, fontFamily: FONTS.body,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 4v12M6 10l6-6 6 6" stroke={COLORS.parchment} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 18h16" stroke={COLORS.parchment} strokeWidth="2" strokeLinecap="round" />
                </svg>
                Upload Ride
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SESSION HISTORY ─────────────────────────────────── */}
      <div style={{ padding: '16px 20px 28px' }}>
        <div style={{
          fontFamily: FONTS.heading, fontSize: '18px', color: COLORS.charcoal,
          marginBottom: '12px',
        }}>
          Ride History
        </div>

        {/* ── Empty state (#60) */}
        {Object.keys(grouped).length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: '#FFFFFF', borderRadius: '16px',
            border: '1px solid #EDE7DF',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🐎</div>
            <div style={{
              fontFamily: FONTS.heading, fontSize: '17px', color: COLORS.charcoal,
              marginBottom: '8px',
            }}>
              Your first ride awaits.
            </div>
            <div style={{
              fontFamily: FONTS.body, fontSize: '13px', color: '#7A6B5D',
              lineHeight: 1.55,
            }}>
              Upload a video to begin your journey.
            </div>
          </div>
        )}

                {Object.entries(grouped).map(([month, rides]) => (
          <div key={month}>
            <div style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: COLORS.muted,
              fontFamily: FONTS.body, marginBottom: '10px', marginTop: '8px',
            }}>
              {month}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {rides.map(ride => {
                const isStored = ride.id.startsWith('stored-');
                const stored = isStored ? storedRides.find(s => s.id === ride.id) : null;
                return (
                  <RideRow
                    key={ride.id}
                    ride={ride}
                    storedRide={stored ?? undefined}
                    onClick={() => {
                      setSelectedRide(ride);
                      setSelectedStoredRide(stored ?? undefined);
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── CSS Keyframes ────────────────────────────────────── */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes champagnePulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes successPop {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>

      {/* ── RIDE DETAIL VIEW (Card #56) ──────────────────────── */}
      {selectedRide && (
        <RideDetailView
          ride={selectedRide}
          storedRide={selectedStoredRide}
          onClose={() => { setSelectedRide(null); setSelectedStoredRide(undefined); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// LAYER HEADER COMPONENT
// ─────────────────────────────────────────────────────────

function LayerHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <div>
        <div style={{ fontFamily: FONTS.heading, fontSize: 17, color: COLORS.charcoal }}>{title}</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>{subtitle}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RADIAL GAUGE COMPONENT
// ─────────────────────────────────────────────────────────

function RadialGauge({ value, label, color: fixedColor }: { value: number; label: string; color?: string }) {
  const pct = Math.round(value * 100);
  const color = fixedColor || scoreColor(value);
  const r = 28;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - value);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="32" cy="32" r={r} fill="none" stroke={COLORS.softBg} strokeWidth="5" />
          <circle
            cx="32" cy="32" r={r}
            fill="none" stroke={color} strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONTS.mono, fontSize: '13px', fontWeight: 600, color,
        }}>
          {pct}
        </div>
      </div>
      <div style={{
        fontFamily: FONTS.body, fontSize: '10px', color: COLORS.muted,
        textAlign: 'center', lineHeight: 1.2,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: FONTS.mono, fontSize: '9px', color,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {scoreLabel(value)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// INSIGHTS CARD COMPONENT
// ─────────────────────────────────────────────────────────

function InsightsCard({ insights }: { insights: MovementInsight[] }) {
  return (
    <div style={{
      background: COLORS.parchment, borderRadius: '14px',
      padding: '16px', border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{
        fontFamily: FONTS.heading, fontSize: '14px', color: COLORS.charcoal,
        marginBottom: '12px',
      }}>
        Key Insights
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {insights.map((insight, i) => (
          <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: `${insight.iconColor}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', color: insight.iconColor,
              flexShrink: 0, marginTop: 1,
            }}>
              {insight.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{
                  fontFamily: FONTS.body, fontSize: '11px', fontWeight: 600,
                  color: COLORS.charcoal,
                }}>
                  {insight.metric}
                </span>
                <span style={{
                  fontFamily: FONTS.mono, fontSize: '9px',
                  color: insight.trendColor, textTransform: 'uppercase',
                }}>
                  {insight.trend}
                </span>
              </div>
              <div style={{
                fontFamily: FONTS.body, fontSize: '11.5px',
                color: '#6B5E50', lineHeight: 1.45,
              }}>
                {insight.text}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// RIDE ROW COMPONENT
// ─────────────────────────────────────────────────────────

function RideRow({ ride, storedRide, onClick }: { ride: Ride; storedRide?: StoredRide; onClick: () => void }) {
  const signal = signalConfig[ride.signal];
  const d = new Date(ride.date);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div
      onClick={onClick}
      style={{
        background: COLORS.cardBg, borderRadius: '14px', padding: '13px 15px',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 2px 8px rgba(26,20,14,0.05)', cursor: 'pointer',
        transition: 'transform 0.1s ease',
        border: storedRide ? `1px solid ${COLORS.champagne}30` : 'none',
      }}
    >
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: signal.color, flexShrink: 0, marginTop: 1 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: '13.5px', fontWeight: 500, color: COLORS.charcoal, fontFamily: FONTS.body }}>
            {rideTypeLabel[ride.type] ?? ride.type} · {ride.horse}
          </span>
          {ride.videoUploaded && (
            <span style={{ fontSize: '10px', background: '#F0F4F8', color: '#6B7FA3', padding: '2px 6px', borderRadius: '6px', fontFamily: FONTS.body }}>
              📹
            </span>
          )}
          {storedRide && (
            <span style={{
              fontSize: '9px', background: `${COLORS.champagne}20`, color: COLORS.champagne,
              padding: '2px 6px', borderRadius: '6px', fontFamily: FONTS.mono,
              fontWeight: 600, letterSpacing: '0.03em',
            }}>
              AI
            </span>
          )}
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: '10.5px', color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dateStr} · {ride.duration}min{storedRide ? ` · Score ${Math.round(storedRide.overallScore * 100)}%` : ` · ${ride.focusMilestone}`}
        </div>

        {/* Mini score bar for stored rides */}
        {storedRide && (
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
            {([
              ['LL', storedRide.biometrics.lowerLegStability],
              ['RS', storedRide.biometrics.reinSteadiness],
              ['SY', storedRide.biometrics.reinSymmetry],
              ['CO', storedRide.biometrics.coreStability],
              ['UB', storedRide.biometrics.upperBodyAlignment],
              ['PV', storedRide.biometrics.pelvisStability],
            ] as [string, number][]).map(([abbr, val]) => (
              <div key={abbr} style={{
                fontFamily: FONTS.mono, fontSize: '8px',
                color: scoreColor(val), background: `${scoreColor(val)}12`,
                padding: '2px 4px', borderRadius: '4px',
              }}>
                {abbr} {Math.round(val * 100)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: '18px', color: signal.color, lineHeight: 1 }}>{signal.symbol}</div>
        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.muted, fontFamily: FONTS.body }}>
          {signal.label}
        </div>
      </div>

      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path d="M9 6l6 6-6 6" stroke="#D4C9BC" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </div>
  );
}
