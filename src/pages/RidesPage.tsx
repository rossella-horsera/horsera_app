import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockRides, mockGoal } from '../data/mock';
import type { Ride, BiometricsSnapshot } from '../data/mock';
import { usePoseAPI } from '../hooks/usePoseAPI';
import { computeRidingQualities, generateInsights } from '../lib/poseAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';
import { saveRide, getRides, deleteRide, useStoredRides } from '../lib/storage';
import type { StoredRide } from '../lib/storage';
import { getUserProfile } from '../lib/userProfile';
import { createVideoReadUrl, pinVideoObject } from '../lib/poseApi';
import {
  markPendingAnalysisComplete,
  updatePendingAnalysisSession,
  upsertPendingAnalysisSession,
  usePendingAnalysisSessions,
  type PendingAnalysisSession,
} from '../lib/pendingAnalysis';

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
  training:    'Training',
  lesson:      'Lesson',
  'mock-test': 'Mock Test',
  hack:        'Hack',
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

function formatElapsedTime(totalSeconds: number | null | undefined): string | null {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds)) return null;
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function isPersistentVideoUrl(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return !!trimmed && !trimmed.startsWith('blob:') && !trimmed.startsWith('data:');
}

// Card #59 — allowed formats + size threshold
const ALLOWED_FORMATS = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
const SIZE_WARN_MB = 500;

const HORSE_FACTS = [
  "The walk is the hardest gait to improve — and the most revealing of how well a horse is trained.",
  "A horse's heart weighs about 9 lbs — nearly 3× a human's. No wonder they run on heart.",
  "Horses have the largest eyes of any land mammal, giving them nearly 360° of vision.",
  "Horses remember faces for years — and whether you were kind to them. They keep score.",
  "'Dressage' comes from the French word dresser — to train. Every ride is literally called training.",
  "Impulsion isn't speed. It's energy flowing from the hindquarters through a supple, swinging back.",
  "A horse can sense your heart rate from up to 4 feet away. They know when you're nervous before you do.",
  "Grand Prix movements like piaffe and passage occur naturally in the wild. We simply learned to ask politely.",
  "A score of 10 in a dressage test means 'excellent.' So rare, some judges have never awarded one.",
  "'On the bit' isn't about the head position — it describes a whole topline that is engaged and round.",
  "The frog of the hoof acts as a natural pump, pushing blood back up the leg with every single step.",
  "'Submission' in dressage means willingness and confidence — not obedience. A meaningful distinction.",
  "Horses have 205 bones — just one more than humans. More in common than you might think.",
  "The fastest horse ever recorded hit 55 mph over a quarter mile. Highway speed, on four legs.",
  "Horses use both sides of their brain independently. Something that spooks on the left may be fine on the right.",
  "A horse's teeth take up more space in its skull than its brain. Make of that what you will.",
  "Cadence in riding describes the rhythm and energy of the gait — your horse's natural musical tempo.",
  "The shoulder angle affects range of motion more than almost any other conformation point.",
  "The Lusitano and Andalusian have been trained for classical dressage for over 500 years.",
  "Horses can't vomit — their digestive system only flows one direction, which makes colic a serious condition.",
  "A horse's hoof grows about 1 cm per month and takes a full year to completely regenerate.",
  "Horses communicate through tiny ear movements, nostril flares, and tail position — a rich silent language.",
  "Most foals can stand within an hour and run within hours of birth. They arrive ready.",
  "A horse can drink up to 10 gallons of water a day. Hydration is serious business at every level.",
  "The Scales of Training — rhythm, relaxation, contact, impulsion, straightness, collection — are the same ones judges use.",
];


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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke={COLORS.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke={COLORS.attention} strokeWidth="1.6" />
              <circle cx="12" cy="12" r="5" stroke={COLORS.attention} strokeWidth="1.4" />
              <circle cx="12" cy="12" r="1.5" fill={COLORS.attention} />
            </svg>
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
  const [y, mo, day] = ride.date.split('-').map(Number);
  const d = new Date(y, mo - 1, day);
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

  // Log form state
  const [showLogForm, setShowLogForm] = useState(false);
  const [logNote, setLogNote] = useState('');
  const [logFocus, setLogFocus] = useState(mockGoal.milestones[0].id);
  const [logDuration, setLogDuration] = useState('45');
  const [logType, setLogType] = useState<'training' | 'lesson' | 'hack'>('training');
  const [logDate, setLogDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [logSubmitted, setLogSubmitted] = useState(false);

  // Video analysis
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const {
    status,
    progress,
    result,
    previewResult,
    previewMeta,
    finalResultPending,
    error,
    analysisJobId,
    uploadedObjectPath,
    analysisMeta,
    analyzeVideo,
    reset,
  } = usePoseAPI();

  // Saved ride state
  const [sessionSaved, setSessionSaved] = useState(false);

  // Optional ride name/notes (collapsed by default — Apple/Oura-style reveal)
  const [rideName, setRideName] = useState('');
  const [rideNotes, setRideNotes] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);

  // Save mode when a ride already exists on this date — 'replace' or 'new'
  const [conflictMode, setConflictMode] = useState<'replace' | 'new'>('replace');
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  // Card #59 — validation & UX state
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileSizeWarning, setFileSizeWarning] = useState<string | null>(null);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [horseFacts, setHorseFacts] = useState<string[]>([]);
  const [horseFactIdx, setHorseFactIdx] = useState(0);

  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'score'>('newest');
  const storedRides = useStoredRides();
  const pendingAnalysisSessions = usePendingAnalysisSessions();
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const toggleMonth = (key: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const isDone = status === 'done' && result !== null;
  const isAnalyzing = status === 'loading-model' || status === 'compressing' || status === 'extracting' || status === 'processing';
  const displayResult = result ?? previewResult;
  const isPreviewReady = !result && !!previewResult;
  const activeAnalysisVisible = isAnalyzing || isDone || isPreviewReady || status === 'error';

  // Horse fun facts — build a long shuffled queue and advance through it.
  // Avoids repeats within an analysis AND across analyses in the same session.
  useEffect(() => {
    if (!isAnalyzing) return;
    const RECENT_KEY = 'horsera_recent_facts';
    let recent: string[] = [];
    try {
      recent = JSON.parse(sessionStorage.getItem(RECENT_KEY) || '[]');
    } catch {
      // Ignore invalid recent-facts cache entries.
    }
    // Put NOT-recently-shown facts first, then recent ones at the tail, so the
    // longest possible analysis still stays unique-heavy at the start.
    const fresh = HORSE_FACTS.filter(f => !recent.includes(f));
    const stale = HORSE_FACTS.filter(f => recent.includes(f));
    // Fisher-Yates each pile
    const shuffle = (arr: string[]) => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    const queue = [...shuffle(fresh), ...shuffle(stale)];
    setHorseFacts(queue);
    setHorseFactIdx(0);
    // Remember the first 10 from this queue as "recently shown" for next time
    try {
      const next = [...queue.slice(0, 10), ...recent].slice(0, 20);
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Ignore sessionStorage write failures.
    }
    const interval = setInterval(() => {
      setHorseFactIdx(i => (i + 1) % queue.length);
    }, 9000);
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

  // Auto-save and navigate to detail page when analysis completes
  useEffect(() => {
    if (isDone && !sessionSaved) {
      handleSaveSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);

  useEffect(() => {
    if (!analysisJobId || !uploadedObjectPath || !videoFile) return;
    upsertPendingAnalysisSession({
      id: analysisJobId,
      status: previewResult ? 'preview-ready' : 'processing',
      videoFileName: videoFile.name,
      videoObjectPath: uploadedObjectPath,
      poseJobId: analysisJobId,
      createdAt: Date.now(),
      previewUpdatedAt: previewResult ? Date.now() : undefined,
    });
  }, [analysisJobId, uploadedObjectPath, videoFile, previewResult]);

  useEffect(() => {
    if (!analysisJobId || !previewResult) return;
    updatePendingAnalysisSession(analysisJobId, {
      status: 'preview-ready',
      previewUpdatedAt: Date.now(),
    });
  }, [analysisJobId, previewResult]);

  useEffect(() => {
    if (!analysisJobId || status !== 'error') return;
    updatePendingAnalysisSession(analysisJobId, { status: 'failed' });
  }, [analysisJobId, status]);

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
    analyzeVideo(file);
  };

  // Card #59 — cancel mid-processing
  const handleCancelProcessing = () => {
    handleReset();
  };

  const handleSaveSession = async () => {
    if (!result || !videoFile) return;
    const bio = result.biometrics;
    const qualities = computeRidingQualities(bio);
    const overall = Object.values(bio).reduce((a, b) => a + b, 0) / Object.values(bio).length;
    const horse = getUserProfile().horseName || 'Your Horse';
    // Use the actual video duration (in minutes) when available — falls back to the form value.
    const duration = videoDuration !== null
      ? Math.max(1, Math.round(videoDuration / 60))
      : (parseInt(logDuration, 10) || 45);

    // If a ride already exists for this date + horse + type, handle the conflict
    // per the user's choice: 'replace' reuses the id (overwrites), 'new' generates a fresh id.
    const existing = getRides().find(r => r.date === logDate && r.horse === horse && r.type === logType);
    const rideId = (existing && conflictMode === 'replace')
      ? existing.id
      : (analysisJobId ?? `stored-${Date.now()}`);

    const ride: StoredRide = {
      id: rideId,
      date: logDate,
      horse,
      name: rideName.trim() || undefined,
      notes: rideNotes.trim() || undefined,
      type: logType,
      duration,
      videoFileName: videoFile.name,
      videoUrl: undefined,
      videoObjectPath: existing?.videoObjectPath,
      poseJobId: analysisJobId ?? undefined,
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
      keyframes: result.allFrames ?? [],
      schemaVersion: 2,
    };

    if (uploadedObjectPath) {
      try {
        const pinnedObjectPath = await pinVideoObject(uploadedObjectPath, videoFile.name, ride.id);
        ride.videoObjectPath = pinnedObjectPath;
        const { readUrl, expiresAt } = await createVideoReadUrl(pinnedObjectPath);
        ride.videoUrl = readUrl;
        ride.videoUrlExpiresAt = expiresAt;
      } catch (storageErr) {
        console.warn('[Horsera] Video pinning skipped on save:', storageErr);
      }
    }

    await saveRide(ride);
    if (analysisJobId) {
      markPendingAnalysisComplete(analysisJobId, ride.id);
    }
    navigate(`/rides/${ride.id}`);

    setSessionSaved(true);
  };

  const handleReset = () => {
    reset();
    setVideoFile(null);
    setSessionSaved(false);
    setFileError(null);
    setFileSizeWarning(null);
    setRideName('');
    setRideNotes('');
    setShowNotesField(false);
    setConflictMode('replace');
    setVideoDuration(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Detect video duration when a file is selected
  useEffect(() => {
    if (!videoFile) { setVideoDuration(null); return; }
    const url = URL.createObjectURL(videoFile);
    const v = document.createElement('video');
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        // ignore cleanup errors
      }
      URL.revokeObjectURL(url);
    };
    v.preload = 'metadata';
    v.src = url;
    v.onloadedmetadata = () => {
      setVideoDuration(v.duration);
      release();
    };
    v.onerror = release;
    return release;
  }, [videoFile]);

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
    // Only show real uploaded rides. Mock rides (mockRides) are kept for
    // Home/Insights/Journey defaults but are no longer mixed into the Rides list.
    return fromStorage;
  }, [storedRides]);

  const sortedRides = useMemo(() => {
    const sorted = [...allRides];
    if (sortBy === 'score') sorted.sort((a, b) => (b.biometrics?.upperBodyAlignment ?? 0) - (a.biometrics?.upperBodyAlignment ?? 0));
    else if (sortBy === 'oldest') sorted.sort((a, b) => a.date.localeCompare(b.date));
    else sorted.sort((a, b) => b.date.localeCompare(a.date));
    return sorted;
  }, [allRides, sortBy]);

  const grouped = sortedRides.reduce((acc, ride) => {
    const parseLocalDate = (d: string) => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day);
    };
    const date = parseLocalDate(ride.date);
    const key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!acc[key]) acc[key] = [];
    acc[key].push(ride);
    return acc;
  }, {} as Record<string, Ride[]>);

  // On first render with data, collapse ALL months so riders see progress at a glance
  const monthsInitialized = useRef(false);
  useEffect(() => {
    if (monthsInitialized.current) return;
    const months = Object.keys(grouped);
    if (months.length === 0) return;
    setCollapsedMonths(new Set(months));
    monthsInitialized.current = true;
  }, [grouped]);

  const monthCount = Object.keys(grouped).length;

  const analysisHeadline = analysisMeta?.headline ?? (
    progress <= 18 ? 'Uploading your ride…'
      : progress <= 25 ? 'Sending to Cadence…'
      : progress <= 94 ? 'Analyzing movement…'
      : progress <= 99 ? 'Almost there…'
      : 'Done'
  );
  const analysisDetail = analysisMeta?.detail ?? (
    progress >= 20
      ? 'Cadence is working through your ride in the cloud.'
      : 'Sending your video to Cadence.'
  );
  const analysisElapsed = formatElapsedTime(analysisMeta?.elapsedSec);
  const analysisSupportNote = isPreviewReady
    ? 'Preview ready. You can leave this screen and reopen the final report from the ride list.'
    : progress >= 20 && analysisMeta?.stage !== 'complete'
    ? 'Uploaded safely. Keep this screen open for automatic save when the report is ready.'
    : 'Longer rides can take a few minutes.';
  const visiblePendingSessions = pendingAnalysisSessions.filter((session) => session.status !== 'complete');

  return (
    <div style={{ background: COLORS.parchment, minHeight: '100%' }}>

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            {(() => {
              const profile = getUserProfile();
              const name = profile.firstName || '';
              return (
                <div style={{
                  fontFamily: FONTS.heading,
                  fontSize: '26px',
                  fontWeight: 400,
                  color: COLORS.charcoal,
                  lineHeight: 1.2,
                }}>
                  {name ? (
                    <>
                      Welcome,{' '}
                      <span style={{ fontStyle: 'italic' }}>{name}</span>
                    </>
                  ) : (
                    'Ride Analysis'
                  )}
                </div>
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
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                  <circle cx="18" cy="18" r="16" stroke={COLORS.cognac} strokeWidth="1.8" />
                  <path d="M11 18l5 5 9-9" stroke={COLORS.cognac} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
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
                <div style={{ fontFamily: FONTS.heading, fontSize: '18px', color: COLORS.charcoal }}>Add a Ride</div>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="13" r="8" stroke="#C9A96E" strokeWidth="1.6" />
            <path d="M12 9v4l2.5 2.5" stroke="#C9A96E" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M10 2h4" stroke="#C9A96E" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span style={{ fontFamily: FONTS.body, fontSize: '13px', color: '#7A6B5D', flex: 1 }}>
            {fileSizeWarning}
          </span>
          <button onClick={() => setFileSizeWarning(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: '20px', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}

            {/* ── VIDEO ANALYSIS SECTION ─────────────────────────── */}
      {activeAnalysisVisible && (
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
              {displayResult?.videoPlaybackUrl && (
                <video
                  src={displayResult.videoPlaybackUrl}
                  controls={isDone || isPreviewReady}
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}

              {/* ── Premium Progress Overlay (inline placeholder — real overlay is fixed below) ── */}
              {isAnalyzing && !isPreviewReady && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,20,14,0.85)' }} />
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
            {(isDone || isPreviewReady) && displayResult && (
              <div style={{
                padding: '20px',
                animation: 'slideUp 0.5s ease',
              }}>
                {isPreviewReady && (
                  <div style={{
                    marginBottom: '16px',
                    borderRadius: '14px',
                    border: '1px solid rgba(107,127,163,0.24)',
                    background: 'rgba(107,127,163,0.10)',
                    padding: '12px 14px',
                    fontFamily: FONTS.body,
                    color: '#40506E',
                    fontSize: '12.5px',
                    lineHeight: 1.45,
                  }}>
                    <strong>Preview ready.</strong> These provisional scores use the first {Math.round(previewMeta?.durationSeconds ?? 60)} seconds of your ride. Cadence is still finishing the full report.
                  </div>
                )}
                <div style={{
                  fontFamily: FONTS.mono, fontSize: '10px', color: COLORS.muted,
                  marginBottom: '16px',
                }}>
                  {displayResult.frameCount} frames analyzed{isPreviewReady && finalResultPending ? ' · final report still running' : ''}
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
                    const val = displayResult.biometrics[key];
                    return (
                      <RadialGauge key={key} value={val} label={label} />
                    );
                  })}
                </div>

                {/* ── Layer 2: Riding Quality ────────────────── */}
                <div style={{ marginTop: '8px', marginBottom: '20px' }}>
                  <LayerHeader icon="◎" title="Riding Quality" subtitle="The Training Scales" />

                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '12px',
                  }}>
                    {(() => {
                      const qualities = computeRidingQualities(displayResult.biometrics);
                      const qualityColors = ['#C9A96E', '#7D9B76', '#8C5A3C', '#C4714A', '#6B7FA3', '#B5A898'];
                      return qualities.map((q, i) => (
                        <RadialGauge key={q.name} value={q.score} label={q.name} color={qualityColors[i]} />
                      ));
                    })()}
                  </div>
                </div>

                {/* ── Insights Summary Card ──────────────────── */}
                <InsightsCard insights={displayResult.insights} />

                {/* ── Ride date + optional name/notes + conflict handling ───────── */}
                {isDone && !sessionSaved && (() => {
                  const horse = getUserProfile().horseName || 'Your Horse';
                  const existing = storedRides.find(r => r.date === logDate && r.horse === horse && r.type === logType);
                  return (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {/* Date */}
                      <div>
                        <label style={{
                          fontSize: '11px', fontWeight: 600, color: COLORS.muted,
                          letterSpacing: '0.1em', textTransform: 'uppercase',
                          fontFamily: FONTS.body, display: 'block', marginBottom: '8px',
                        }}>
                          Ride date
                        </label>
                        <input
                          type="date"
                          value={logDate}
                          max={new Date().toISOString().split('T')[0]}
                          onChange={e => setLogDate(e.target.value)}
                          style={{
                            width: '100%', padding: '10px 12px',
                            borderRadius: '10px', border: `1.5px solid ${COLORS.border}`,
                            fontSize: '14px', color: COLORS.charcoal,
                            fontFamily: FONTS.mono,
                            outline: 'none', background: COLORS.parchment,
                            boxSizing: 'border-box',
                          }}
                        />
                        {videoDuration !== null && (
                          <div style={{
                            marginTop: '6px', fontSize: '11px', color: COLORS.muted,
                            fontFamily: FONTS.body,
                          }}>
                            This video: {Math.floor(videoDuration / 60)}:{String(Math.floor(videoDuration % 60)).padStart(2, '0')}
                          </div>
                        )}
                      </div>

                      {/* Conflict preview + replace/new choice */}
                      {existing && (
                        <div style={{
                          background: COLORS.parchment, borderRadius: '12px', padding: '12px',
                          border: `1px solid ${COLORS.border}`,
                        }}>
                          <div style={{
                            fontSize: '11px', fontWeight: 600, color: COLORS.cognac,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            fontFamily: FONTS.body, marginBottom: '10px',
                          }}>
                            ↻ You already have a ride here
                          </div>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
                            {isPersistentVideoUrl(existing.videoUrl) ? (
                              <video
                                src={`${existing.videoUrl}#t=2`}
                                preload="metadata" muted playsInline
                                style={{
                                  width: 64, height: 64, objectFit: 'cover',
                                  borderRadius: 8, background: '#EDE7DF', flexShrink: 0,
                                }}
                              />
                            ) : (
                              <div style={{
                                width: 64, height: 64, borderRadius: 8,
                                background: '#EDE7DF', flexShrink: 0,
                              }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.charcoal, fontFamily: FONTS.body }}>
                                {existing.name || `${existing.type} · ${existing.horse}`}
                              </div>
                              <div style={{ fontSize: 11, color: COLORS.muted, fontFamily: FONTS.body, marginTop: 2 }}>
                                {existing.duration}min · {Math.round(existing.overallScore * 100)}/100
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => setConflictMode('replace')}
                              style={{
                                flex: 1, padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                                border: `1.5px solid ${conflictMode === 'replace' ? COLORS.cognac : COLORS.border}`,
                                background: conflictMode === 'replace' ? COLORS.cognac : '#fff',
                                color: conflictMode === 'replace' ? COLORS.parchment : COLORS.charcoal,
                                fontSize: '12px', fontWeight: 600, fontFamily: FONTS.body,
                              }}
                            >Replace existing</button>
                            <button
                              onClick={() => setConflictMode('new')}
                              style={{
                                flex: 1, padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                                border: `1.5px solid ${conflictMode === 'new' ? COLORS.cognac : COLORS.border}`,
                                background: conflictMode === 'new' ? COLORS.cognac : '#fff',
                                color: conflictMode === 'new' ? COLORS.parchment : COLORS.charcoal,
                                fontSize: '12px', fontWeight: 600, fontFamily: FONTS.body,
                              }}
                            >Save as new</button>
                          </div>
                        </div>
                      )}

                      {/* Optional name + notes — collapsed reveal */}
                      {!showNotesField ? (
                        <button
                          onClick={() => setShowNotesField(true)}
                          style={{
                            background: 'transparent', border: 'none', padding: 0,
                            color: COLORS.cognac, fontSize: '12px', fontFamily: FONTS.body,
                            cursor: 'pointer', textAlign: 'left',
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            alignSelf: 'flex-start',
                          }}
                        >
                          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add a name or note <span style={{ opacity: 0.5 }}>(optional)</span>
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', animation: 'slideUp 0.25s ease' }}>
                          <input
                            type="text"
                            value={rideName}
                            onChange={e => setRideName(e.target.value)}
                            placeholder="Name this ride (e.g. Clinic day, Test run)"
                            maxLength={60}
                            style={{
                              width: '100%', padding: '10px 12px',
                              borderRadius: '10px', border: `1.5px solid ${COLORS.border}`,
                              fontSize: '14px', color: COLORS.charcoal, fontFamily: FONTS.body,
                              outline: 'none', background: COLORS.parchment, boxSizing: 'border-box',
                            }}
                          />
                          <textarea
                            value={rideNotes}
                            onChange={e => setRideNotes(e.target.value)}
                            placeholder="How did it feel? What did you work on?"
                            rows={3}
                            maxLength={500}
                            style={{
                              width: '100%', padding: '10px 12px',
                              borderRadius: '10px', border: `1.5px solid ${COLORS.border}`,
                              fontSize: '13px', color: COLORS.charcoal, fontFamily: FONTS.body,
                              outline: 'none', background: COLORS.parchment, boxSizing: 'border-box',
                              resize: 'vertical', lineHeight: 1.5,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}

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
                      Ride Saved
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
                fontFamily: FONTS.heading, fontSize: '24px', color: COLORS.parchment,
                marginBottom: '8px', lineHeight: 1.15,
                textShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                Every ride, a step forward.
              </div>
              <div style={{
                fontFamily: FONTS.body, fontSize: '12px', color: 'rgba(250,247,243,0.82)',
                lineHeight: 1.55, marginBottom: '16px', maxWidth: 280,
              }}>
                Upload your ride and Cadence, your AI riding advisor, will read your position, balance and biomechanics.
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: COLORS.cognac,
                color: COLORS.parchment,
                borderRadius: '14px', padding: '11px 24px',
                fontSize: '13px', fontWeight: 600, fontFamily: FONTS.body,
                boxShadow: '0 4px 20px rgba(140,90,60,0.45)',
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M12 4v12M6 10l6-6 6 6" stroke={COLORS.parchment} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 18h16" stroke={COLORS.parchment} strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                Capture your ride
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

        {/* Sort pills — visible when more than 1 ride */}
        {sortedRides.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 12 }}>
            {([['newest', 'Newest'], ['oldest', 'Oldest'], ['score', 'Top score']] as const).map(([key, label]) => {
              const active = sortBy === key;
              return (
                <button key={key} onClick={() => setSortBy(key)} style={{
                  background: active ? COLORS.charcoal : 'transparent',
                  color: active ? '#fff' : 'rgba(28,28,30,0.3)',
                  border: 'none', borderRadius: 12, padding: '3px 10px',
                  fontSize: 10, fontFamily: FONTS.body, fontWeight: 500, cursor: 'pointer',
                }}>
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {visiblePendingSessions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
            {visiblePendingSessions.map((session) => (
              <PendingAnalysisRow
                key={session.id}
                session={session}
                onNavigate={() => navigate(`/jobs/${session.poseJobId}/view`)}
              />
            ))}
          </div>
        )}

        {/* ── Full-screen fixed loading overlay ── */}
        {isAnalyzing && !isPreviewReady && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999,
            background: 'rgba(20, 16, 12, 0.96)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '40px 32px',
            overscrollBehavior: 'none',
            WebkitOverflowScrolling: 'touch',
            maxHeight: '100%',
            overflowY: 'auto',
          }}>
            {/* Progress ring */}
            <div style={{ position: 'relative', width: 96, height: 96 }}>
              <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                <circle cx="48" cy="48" r="38" fill="none" stroke="#C17F4A" strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(progress / 100) * 2 * Math.PI * 38} ${2 * Math.PI * 38}`}
                  style={{ transition: 'stroke-dasharray 0.4s ease' }} />
              </svg>
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONTS.mono, fontSize: '18px', color: 'rgba(255,255,255,0.9)',
                fontWeight: 500,
              }}>
                {progress}%
              </div>
            </div>

            {/* Status text */}
            <div style={{
              fontFamily: FONTS.body, fontSize: '16px',
              color: 'rgba(255,255,255,0.88)',
              marginTop: 20, textAlign: 'center',
              fontWeight: 500,
            }}>
              {analysisHeadline}
            </div>

            <div style={{
              fontFamily: FONTS.body, fontSize: '13px',
              color: 'rgba(255,255,255,0.60)',
              marginTop: 8, textAlign: 'center', lineHeight: 1.55,
              maxWidth: 320,
            }}>
              {analysisDetail}
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              marginTop: 14, flexWrap: 'wrap',
            }}>
              {analysisElapsed && (
                <div style={{
                  border: '1px solid rgba(255,255,255,0.16)',
                  borderRadius: 999,
                  padding: '5px 10px',
                  fontFamily: FONTS.mono,
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.72)',
                  background: 'rgba(255,255,255,0.04)',
                }}>
                  {analysisElapsed} elapsed
                </div>
              )}
              <div style={{
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 999,
                padding: '5px 10px',
                fontFamily: FONTS.body,
                fontSize: '11px',
                color: 'rgba(255,255,255,0.58)',
                background: 'rgba(255,255,255,0.03)',
              }}>
                {analysisSupportNote}
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', alignSelf: 'stretch', margin: '28px 0' }} />

            {/* Fun facts — meant to be a playful, readable moment during processing */}
            {horseFacts.length > 0 && (
              <div style={{ textAlign: 'center', maxWidth: 320, margin: '0 auto' }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  marginBottom: 14,
                }}>
                  <span style={{ fontSize: 14, color: '#C9A96E' }}>✦</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, letterSpacing: '0.22em',
                    textTransform: 'uppercase', color: '#C17F4A',
                    fontFamily: FONTS.body,
                  }}>Did you know?</span>
                  <span style={{ fontSize: 14, color: '#C9A96E' }}>✦</span>
                </div>
                <div key={horseFactIdx} style={{
                  fontFamily: FONTS.body,
                  fontSize: '15px', fontWeight: 400,
                  color: 'rgba(255,255,255,0.90)', lineHeight: 1.65,
                  animation: 'fadeIn 0.8s ease',
                }}>
                  {horseFacts[horseFactIdx]}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Empty state (#60) */}
        {Object.keys(grouped).length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: '#FFFFFF', borderRadius: '16px',
            border: '1px solid #EDE7DF',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {/* Minimal horse head silhouette */}
                <path d="M6 18c0-4 2-7 5-8.5C13 8 15 6 15 4c0 2-1 3-2 4 2 0 4 1 5 3-1-1-3-1.5-4-1 1 1 2 3 2 5 0 3-2 4-4 4H8c-1.3 0-2-.8-2-2z" stroke={COLORS.muted} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M8 18v2M12 18v2" stroke={COLORS.muted} strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
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
              Your ride log is waiting. Capture your first session to see your progress here.
            </div>
          </div>
        )}

                {Object.entries(grouped).map(([month, rides], groupIdx) => {
          const isCollapsed = collapsedMonths.has(month);
          // Collect (date, score) pairs for trajectory viz, chronologically
          const ridePoints = [...rides]
            .map(r => {
              const stored = storedRides.find(s => s.id === r.id);
              return stored ? { date: r.date, score: Math.round(stored.overallScore * 100) } : null;
            })
            .filter((p): p is { date: string; score: number } => p !== null)
            .sort((a, b) => a.date.localeCompare(b.date));
          const monthScores = ridePoints.map(p => p.score);
          const hasTrajectory = monthScores.length >= 1;
          const minScore = hasTrajectory ? Math.min(...monthScores) : 0;
          const maxScore = hasTrajectory ? Math.max(...monthScores) : 0;
          const firstScore = hasTrajectory ? monthScores[0] : 0;
          const lastScore = hasTrajectory ? monthScores[monthScores.length - 1] : 0;
          const delta = lastScore - firstScore;
          return (
          <div key={month}>
            <button
              onClick={() => toggleMonth(month)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${month}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '10px 12px', marginBottom: isCollapsed ? '8px' : '8px',
                marginTop: groupIdx === 0 ? '8px' : '16px',
                background: isCollapsed ? 'rgba(255,255,255,0.6)' : 'transparent',
                border: 'none', borderRadius: '10px', cursor: 'pointer',
                textAlign: 'left', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg
                  width="10" height="10" viewBox="0 0 12 12" fill="none"
                  style={{
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.18s ease',
                    color: 'rgba(28,28,30,0.55)',
                  }}
                >
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{
                  fontSize: '11px', fontWeight: 600, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'rgba(28,28,30,0.55)',
                  fontFamily: FONTS.body,
                }}>
                  {month}
                </span>
                <span style={{
                  fontSize: '11px', color: 'rgba(28,28,30,0.4)',
                  fontFamily: FONTS.body,
                }}>
                  · {rides.length} ride{rides.length !== 1 ? 's' : ''}
                </span>
              </div>
              {hasTrajectory && (() => {
                // Sparkline — score trajectory across the month (oldest → newest).
                // Shows first score, the arc of progress, and last score.
                const W = 72, H = 24;
                const n = monthScores.length;
                const range = Math.max(maxScore - minScore, 1);
                const yFor = (s: number) => H - 2 - ((s - minScore) / range) * (H - 6);
                const points = monthScores.map((s, i) => {
                  const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 4) + 2;
                  return `${x},${yFor(s)}`;
                }).join(' ');
                const deltaColor = delta > 2 ? COLORS.green : delta < -2 ? '#C4714A' : '#C9A96E';
                const lineColor = '#B58E60';
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace",
                      color: 'rgba(28,28,30,0.45)',
                    }}>{firstScore}</span>
                    <svg width={W} height={H} style={{ display: 'block' }}>
                      {n > 1 && (
                        <polyline
                          points={points} fill="none"
                          stroke={lineColor} strokeWidth="1.5"
                          strokeLinecap="round" strokeLinejoin="round"
                        />
                      )}
                      {monthScores.map((s, i) => {
                        const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 4) + 2;
                        const isEndpoint = i === 0 || i === n - 1;
                        return (
                          <circle
                            key={i} cx={x} cy={yFor(s)}
                            r={isEndpoint ? 2.5 : 1.5}
                            fill={isEndpoint ? lineColor : '#D6B989'}
                          />
                        );
                      })}
                    </svg>
                    <span style={{
                      fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace",
                      color: deltaColor,
                    }}>{lastScore}</span>
                    {n > 1 && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: deltaColor,
                        fontFamily: FONTS.body, letterSpacing: '0.02em',
                      }}>{delta > 0 ? `+${delta}` : delta}</span>
                    )}
                  </div>
                );
              })()}
            </button>
            {!isCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {rides.map((ride, i) => {
                const stored = storedRides.find(s => s.id === ride.id) ?? null;
                const prevRide = i > 0 ? rides[i - 1] : null;
                const prevStored = prevRide ? (storedRides.find(s => s.id === prevRide.id) ?? null) : null;
                const trendDelta = stored && prevStored
                  ? Math.round(stored.overallScore * 100) - Math.round(prevStored.overallScore * 100)
                  : null;
                return (
                  <SwipeRideRow
                    key={ride.id}
                    ride={ride}
                    storedRide={stored ?? undefined}
                    trendDelta={trendDelta}
                    onNavigate={() => navigate(`/rides/${ride.id}`)}
                    onDelete={() => {
                      void deleteRide(ride.id);
                    }}
                  />
                );
              })}
            </div>
            )}
          </div>
        );
        })}
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
        /* Ride card delete button — always visible on desktop (hover devices); hidden on touch (mobile uses swipe) */
        @media (hover: hover) {
          .ride-card-delete-btn { opacity: 0.5 !important; }
          .ride-card-delete-btn:hover { opacity: 1 !important; background: rgba(193,75,46,0.1) !important; color: #C14A2A !important; }
        }
      `}</style>

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

const BIO_LABELS: Record<string, string> = {
  upperBodyAlignment: 'Upper Body', lowerLegStability: 'Lower Leg',
  coreStability: 'Core', pelvisStability: 'Pelvis',
  reinSteadiness: 'Rein Steady', reinSymmetry: 'Symmetry',
};

const RC = { pa: '#F5EFE6', nk: '#1C1C1E', cg: '#C17F4A', ch: '#D4AF76', ideal: '#5B9E56', good: '#E8A857', focus: '#C14A2A' };

function PendingAnalysisRow({ session, onNavigate }: {
  session: PendingAnalysisSession;
  onNavigate: () => void;
}) {
  const createdAt = new Date(session.createdAt);
  const dateLabel = Number.isFinite(createdAt.getTime())
    ? createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'Today';
  const statusConfig = session.status === 'preview-ready'
    ? { label: 'Preview ready', color: '#6B7FA3', detail: 'Final report still running' }
    : session.status === 'failed'
      ? { label: 'Needs attention', color: RC.focus, detail: 'Open recovery viewer' }
      : { label: 'Analyzing', color: RC.cg, detail: 'You can come back later' };

  return (
    <button
      type="button"
      onClick={onNavigate}
      style={{
        width: '100%',
        border: `1px solid ${COLORS.border}`,
        background: '#fff',
        borderRadius: 16,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{
        width: 42,
        height: 42,
        borderRadius: '50%',
        background: `${statusConfig.color}1A`,
        color: statusConfig.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONTS.mono,
        fontSize: 16,
        flexShrink: 0,
      }}>
        {session.status === 'preview-ready' ? '◎' : session.status === 'failed' ? '!' : '…'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONTS.body,
          fontSize: 14,
          fontWeight: 600,
          color: RC.nk,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}>
          {session.videoFileName}
        </div>
        <div style={{
          marginTop: 3,
          fontFamily: FONTS.body,
          fontSize: 11.5,
          color: '#7A6B5D',
        }}>
          {statusConfig.detail} · {dateLabel}
        </div>
      </div>
      <div style={{
        borderRadius: 999,
        padding: '5px 9px',
        background: `${statusConfig.color}14`,
        color: statusConfig.color,
        fontFamily: FONTS.body,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {statusConfig.label}
      </div>
    </button>
  );
}

function SwipeRideRow({ ride, storedRide, trendDelta, onNavigate, onDelete }: {
  ride: Ride; storedRide?: StoredRide; trendDelta: number | null;
  onNavigate: () => void; onDelete: () => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startXRef = useRef(0);
  const DELETE_THRESHOLD = 80;

  const [y, mo, day] = ride.date.split('-').map(Number);
  const d = new Date(y, mo - 1, day);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const score = storedRide ? Math.round(storedRide.overallScore * 100) : null;

  const bioEntries = storedRide
    ? Object.entries(storedRide.biometrics)
        .map(([k, v]) => ({ key: k, label: BIO_LABELS[k] ?? k, score: Math.round((v as number) * 100) }))
        .filter(e => e.score > 0)
    : [];
  const best = bioEntries.length ? bioEntries.reduce((a, b) => a.score > b.score ? a : b) : null;
  const worst = bioEntries.length ? bioEntries.reduce((a, b) => a.score < b.score ? a : b) : null;

  const trendLabel = trendDelta === null ? null
    : trendDelta > 3  ? { text: 'Building', color: RC.ideal, arrow: '↑' }
    : trendDelta < -3 ? { text: 'Focus session', color: RC.focus, arrow: '↓' }
    :                    { text: 'Holding', color: RC.good, arrow: '→' };

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 16 }}>
      {/* Delete strip — whole strip is the tap target */}
      <button
        onClick={onDelete}
        aria-label="Delete ride"
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: DELETE_THRESHOLD, background: RC.focus,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          border: 'none', padding: 0, cursor: 'pointer',
          borderRadius: '0 16px 16px 0',
          WebkitTapHighlightColor: 'rgba(255,255,255,0.2)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ color: 'white', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', fontFamily: "'DM Sans', sans-serif" }}>DELETE</span>
      </button>

      {/* Swipeable card */}
      <div
        onTouchStart={e => { startXRef.current = e.touches[0].clientX; setSwiping(true); }}
        onTouchMove={e => { const dx = e.touches[0].clientX - startXRef.current; if (dx < 0) setSwipeX(Math.max(dx, -100)); }}
        onTouchEnd={() => { setSwiping(false); setSwipeX(swipeX < -DELETE_THRESHOLD ? -DELETE_THRESHOLD : 0); }}
        onClick={() => { if (swipeX < -20) { setSwipeX(0); return; } onNavigate(); }}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease',
          position: 'relative', zIndex: 1,
          background: '#fff', borderRadius: 16, padding: '14px 16px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)', cursor: 'pointer',
          display: 'flex', gap: 12, alignItems: 'stretch',
        }}
      >
        {/* Inline delete button (desktop/web — tap target on mobile is the swipe) */}
        <button
          onClick={e => {
            e.stopPropagation();
            if (window.confirm(`Delete this ${ride.type} ride from ${dateStr}? This cannot be undone.`)) {
              onDelete();
            }
          }}
          aria-label="Delete ride"
          title="Delete ride"
          className="ride-card-delete-btn"
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 2,
            width: 26, height: 26, borderRadius: '50%',
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(28,28,30,0.3)',
            transition: 'background 0.15s ease, color 0.15s ease, opacity 0.15s ease',
            opacity: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Left: Content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: RC.nk, fontFamily: "'DM Sans', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(ride.type.charAt(0).toUpperCase() + ride.type.slice(1))} · {ride.horse}
            </span>
          </div>
          {storedRide?.name && (
            <div style={{ fontSize: 12, color: RC.cg, fontStyle: 'italic', fontFamily: "'Playfair Display', serif", marginTop: -2 }}>
              {storedRide.name}
            </div>
          )}
          <div style={{ fontSize: 11, color: COLORS.muted, fontFamily: "'DM Sans', sans-serif" }}>
            {dateStr} · {ride.duration}min
          </div>

          {best && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <span style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20,
                background: 'rgba(91,158,86,0.08)', border: '1px solid rgba(91,158,86,0.2)',
                color: RC.ideal, fontFamily: "'DM Sans', sans-serif",
              }}>↑ {best.label} {best.score}/100</span>
              {worst && worst.key !== best.key && (
                <span style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 20,
                  background: 'rgba(193,127,74,0.06)', border: '1px solid rgba(193,127,74,0.2)',
                  color: RC.cg, fontFamily: "'DM Sans', sans-serif",
                }}>↓ {worst.label}</span>
              )}
            </div>
          )}

          {trendLabel && (
            <div style={{ marginTop: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 500, textTransform: 'uppercase',
                padding: '2px 8px', borderRadius: 12,
                background: `${trendLabel.color}15`, color: trendLabel.color,
                fontFamily: "'DM Sans', sans-serif",
              }}>{trendLabel.arrow} {trendLabel.text}</span>
            </div>
          )}
        </div>

        {/* Right: Thumbnail with score ring overlay */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {isPersistentVideoUrl(storedRide?.videoUrl) ? (
            <div style={{
              position: 'relative', width: 92, height: 92, borderRadius: 10,
              overflow: 'hidden', background: '#EDE7DF',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}>
              <video
                src={`${storedRide.videoUrl}#t=2`}
                preload="metadata"
                muted
                playsInline
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%', objectFit: 'cover',
                  pointerEvents: 'none',
                }}
              />
              {/* Score ring overlay — bottom-right corner */}
              {score !== null && (() => {
                const bandColor =
                score >= 90 ? '#5B9E56' :
                score >= 75 ? '#7D9B76' :
                score >= 60 ? '#C9A96E' :
                score >= 40 ? '#C17F4A' :
                '#C4714A';
                const r = 14;
                const c = 2 * Math.PI * r;
                const dash = (score / 100) * c;
                return (
                  <div style={{
                    position: 'absolute', bottom: 4, right: 4,
                    width: 34, height: 34, borderRadius: '50%',
                    background: 'rgba(28,20,14,0.72)',
                    backdropFilter: 'blur(6px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="34" height="34" viewBox="0 0 34 34" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
                      <circle cx="17" cy="17" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.2"/>
                      <circle cx="17" cy="17" r={r} fill="none" stroke={bandColor} strokeWidth="2.2"
                        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"/>
                    </svg>
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: bandColor,
                      fontFamily: "'DM Mono', monospace", position: 'relative',
                    }}>{score}</span>
                  </div>
                );
              })()}
            </div>
          ) : score !== null ? (
            // No video — show score ring alone
            (() => {
              const bandColor =
                score >= 90 ? '#5B9E56' :
                score >= 75 ? '#7D9B76' :
                score >= 60 ? '#C9A96E' :
                score >= 40 ? '#C17F4A' :
                '#C4714A';
              const r = 26;
              const c = 2 * Math.PI * r;
              const dash = (score / 100) * c;
              return (
                <div style={{ position: 'relative', width: 60, height: 60 }}>
                  <svg width="60" height="60" viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(28,28,30,0.08)" strokeWidth="3.5"/>
                    <circle cx="30" cy="30" r={r} fill="none" stroke={bandColor} strokeWidth="3.5"
                      strokeDasharray={`${dash} ${c}`} strokeLinecap="round"/>
                  </svg>
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 700, color: bandColor,
                    fontFamily: "'DM Mono', monospace",
                  }}>
                    {score}
                  </div>
                </div>
              );
            })()
          ) : null}
          <span style={{ color: 'rgba(28,28,30,0.25)', fontSize: 14 }}>›</span>
        </div>
      </div>
    </div>
  );
}
