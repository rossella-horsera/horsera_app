import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockRides, mockGoal } from '../data/mock';
import type { Ride, BiometricsSnapshot } from '../data/mock';
import { usePoseAPI } from '../hooks/usePoseAPI';
import { computeRidingQualities, generateInsights } from '../lib/poseAnalysis';
import type { MovementInsight } from '../lib/poseAnalysis';
import { saveRide, getRides, deleteRide } from '../lib/storage';
import type { StoredRide } from '../lib/storage';
import { getUserProfile } from '../lib/userProfile';
import { supabase } from '../integrations/supabase/client';
import VideoSilhouetteOverlay from '../components/VideoSilhouetteOverlay';

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

// Card #59 — allowed formats + size threshold
const ALLOWED_FORMATS = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-msvideo'];
const SIZE_WARN_MB = 500;

// Card #59 — cycling processing messages
const PROCESSING_MESSAGES = [
  'Reading your ride…',
  'Analyzing movement…',
  'Calculating scores…',
];

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
  const { status, progress, result, error, sessionId, analyzeVideo, reset } = usePoseAPI();

  // Saved ride state
  const [sessionSaved, setSessionSaved] = useState(false);

  // Card #59 — validation & UX state
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileSizeWarning, setFileSizeWarning] = useState<string | null>(null);
  const [processingMsgIdx, setProcessingMsgIdx] = useState(0);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [horseFacts, setHorseFacts] = useState<string[]>([]);
  const [horseFactIdx, setHorseFactIdx] = useState(0);

  // Detail view for ride history
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [selectedStoredRide, setSelectedStoredRide] = useState<StoredRide | undefined>(undefined);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'score'>('newest');
  const [storedRides, setStoredRides] = useState<StoredRide[]>(getRides);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const toggleMonth = (key: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Refresh stored rides on mount
  useEffect(() => {
    setStoredRides(getRides());
  }, []);

  const isDone = status === 'done' && result !== null;
  const isAnalyzing = status === 'loading-model' || status === 'compressing' || status === 'extracting' || status === 'processing';

  // Card #59 — cycle processing messages every 2s
  useEffect(() => {
    if (!isAnalyzing) return;
    const interval = setInterval(() => {
      setProcessingMsgIdx(i => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  // Horse fun facts — shuffle on analysis start, cycle every 4s
  useEffect(() => {
    if (!isAnalyzing) return;
    const shuffled = [...HORSE_FACTS].sort(() => Math.random() - 0.5).slice(0, 3);
    setHorseFacts(shuffled);
    setHorseFactIdx(0);
    const interval = setInterval(() => {
      setHorseFactIdx(i => (i + 1) % 3);
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

  const handleSaveSession = async () => {
    if (!result || !videoFile) return;
    const bio = result.biometrics;
    const qualities = computeRidingQualities(bio);
    const overall = Object.values(bio).reduce((a, b) => a + b, 0) / Object.values(bio).length;
    const horse = getUserProfile().horseName || 'Your Horse';
    const duration = parseInt(logDuration, 10) || 45;

    // If a ride already exists for this date + horse + type, reuse its id so saveRide() overwrites it.
    const existing = getRides().find(r => r.date === logDate && r.horse === horse && r.type === logType);
    const rideId = existing?.id ?? sessionId ?? `stored-${Date.now()}`;

    const ride: StoredRide = {
      id: rideId,
      date: logDate,
      horse,
      type: logType,
      duration,
      videoFileName: videoFile.name,
      videoUrl: result.videoPlaybackUrl,
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
    };

    // ── Upload video to Supabase Storage now (deferred from analysis time) ──────
    let permanentVideoUrl = ride.videoUrl ?? ''; // starts as blob URL
    try {
      const safeName = `${Date.now()}_${videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { data: up, error: upErr } = await supabase.storage
        .from('ride-videos')
        .upload(safeName, videoFile, { cacheControl: '3600', upsert: false });
      if (!upErr && up) {
        const { data: { publicUrl } } = supabase.storage.from('ride-videos').getPublicUrl(up.path);
        permanentVideoUrl = publicUrl;
        ride.videoUrl = publicUrl;
      }
    } catch (storageErr) {
      console.warn('[Horsera] Storage upload skipped on save:', storageErr);
    }

    // Persist to localStorage (always)
    saveRide(ride);
    setStoredRides(getRides());
    navigate(`/rides/${ride.id}`);

    // Update Supabase ride_sessions with video_url + user metadata (non-fatal)
    if (sessionId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('ride_sessions')
          .update({
            video_url:        permanentVideoUrl,
            horse,
            ride_type:        logType,
            duration_minutes: duration,
          })
          .eq('id', sessionId);
      } catch (dbErr) {
        console.warn('[Horsera] ride_sessions save update skipped:', dbErr);
      }
    }

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

  // On first render with data, collapse all months except the newest
  const monthsInitialized = useRef(false);
  useEffect(() => {
    if (monthsInitialized.current) return;
    const months = Object.keys(grouped);
    if (months.length === 0) return;
    setCollapsedMonths(new Set(months.slice(1)));
    monthsInitialized.current = true;
  }, [grouped]);

  const monthCount = Object.keys(grouped).length;

  // Status message for analysis progress — compression phase shows a fixed label,
  // all other phases cycle through PROCESSING_MESSAGES (#59)
  const statusMessage = status === 'compressing'
    ? 'Compressing video...'
    : PROCESSING_MESSAGES[processingMsgIdx];

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

              {/* ── Premium Progress Overlay (inline placeholder — real overlay is fixed below) ── */}
              {isAnalyzing && (
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
                  <LayerHeader icon="◎" title="Riding Quality" subtitle="The Training Scales" />

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

                {/* ── Ride date (editable before save) ─────────── */}
                {!sessionSaved && (() => {
                  const horse = getUserProfile().horseName || 'Your Horse';
                  const existing = storedRides.find(r => r.date === logDate && r.horse === horse && r.type === logType);
                  return (
                    <div style={{ marginTop: '16px' }}>
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
                      {existing && (
                        <div style={{
                          marginTop: '8px', fontSize: '12px', color: COLORS.cognac,
                          fontFamily: FONTS.body, fontStyle: 'italic',
                        }}>
                          ↻ Will replace your existing {logType} ride from this date.
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
              {/* Cadence AI badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(201,169,110,0.18)',
                border: '1px solid rgba(201,169,110,0.35)',
                borderRadius: '20px', padding: '4px 11px',
                marginBottom: '10px',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'radial-gradient(circle at 38% 38%, #F0D888, #C9A96E)', boxShadow: '0 0 5px rgba(201,169,110,0.6)' }} />
                <span style={{ fontSize: '10px', color: 'rgba(240,216,136,0.92)', fontFamily: FONTS.mono, letterSpacing: '0.07em' }}>
                  cadence
                </span>
              </div>
              <div style={{
                fontFamily: FONTS.heading, fontSize: '24px', color: COLORS.parchment,
                marginBottom: '6px', lineHeight: 1.15,
                textShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                Every ride, a step forward.
              </div>
              <div style={{
                fontFamily: FONTS.body, fontSize: '12px', color: 'rgba(250,247,243,0.72)',
                lineHeight: 1.5, marginBottom: '16px', maxWidth: 240,
              }}>
                Cadence reads your position, balance & biomechanics — every ride.
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

        {/* ── Full-screen fixed loading overlay ── */}
        {isAnalyzing && (
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
              fontFamily: FONTS.body, fontSize: '14px',
              color: 'rgba(255,255,255,0.6)',
              marginTop: 20, textAlign: 'center',
            }}>
              {progress <= 18 ? 'Uploading your ride…'
                : progress <= 25 ? 'Sending to Cadence…'
                : progress <= 94 ? 'Analyzing movement…'
                : progress <= 99 ? 'Almost there…'
                : 'Done'}
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
          // Compute avg score from storedRides that belong to this group
          const scores = rides
            .map(r => storedRides.find(s => s.id === r.id)?.overallScore)
            .filter((s): s is number => typeof s === 'number');
          const avgScore = scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)
            : null;
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
              {avgScore !== null && (() => {
                // Oura-style: circular ring + number inside. Color varies by score band.
                const bandColor =
                  avgScore >= 75 ? COLORS.green :
                  avgScore >= 60 ? '#C9A96E' :  // champagne
                  '#C4714A';                     // attention
                const r = 15;
                const c = 2 * Math.PI * r;
                const dash = (avgScore / 100) * c;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'rgba(28,28,30,0.4)',
                      fontFamily: FONTS.body,
                    }}>AVG</span>
                    <div style={{ position: 'relative', width: 36, height: 36 }}>
                      <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(28,28,30,0.08)" strokeWidth="2.5"/>
                        <circle cx="18" cy="18" r={r} fill="none" stroke={bandColor} strokeWidth="2.5"
                          strokeDasharray={`${dash} ${c}`} strokeLinecap="round"/>
                      </svg>
                      <div style={{
                        position: 'absolute', inset: 0, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: bandColor,
                        fontFamily: FONTS.body,
                      }}>
                        {avgScore}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </button>
            {!isCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {rides.map((ride, i) => {
                const isStored = ride.id.startsWith('stored-');
                const stored = isStored ? storedRides.find(s => s.id === ride.id) : null;
                const prevRide = i > 0 ? rides[i - 1] : null;
                const prevStored = prevRide?.id.startsWith('stored-') ? storedRides.find(s => s.id === prevRide.id) : null;
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
                      deleteRide(ride.id);
                      setStoredRides(getRides());
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
      `}</style>

      {/* ── RIDE DETAIL VIEW (Card #56) ──────────────────────── */}
      {selectedRide && (
        <RideDetailView
          ride={selectedRide}
          storedRide={selectedStoredRide}
          onClose={() => { setSelectedRide(null); setSelectedStoredRide(undefined); }}
        />
      )}

      {/* ── LOG A RIDE FAB ──────────────────────────────────── */}
      {!showLogForm && (
        <div style={{
          position: 'fixed',
          bottom: '94px',
          left: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          zIndex: 60,
        }}>
          {/* Label pill */}
          <div style={{
            background: 'rgba(28,21,16,0.72)',
            borderRadius: '8px',
            padding: '3px 9px',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(201,169,110,0.22)',
            pointerEvents: 'none',
          }}>
            <span style={{
              fontSize: '9px',
              color: 'rgba(201,169,110,0.85)',
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}>
              Add a ride
            </span>
          </div>

          {/* FAB button */}
          <button
            onClick={() => setShowLogForm(true)}
            aria-label="Add a ride"
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: '#8C5A3C',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(140,90,60,0.4)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <line x1="9" y1="1" x2="9" y2="17" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
              <line x1="1" y1="9" x2="17" y2="9" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
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

const BIO_LABELS: Record<string, string> = {
  upperBodyAlignment: 'Upper Body', lowerLegStability: 'Lower Leg',
  coreStability: 'Core', pelvisStability: 'Pelvis',
  reinSteadiness: 'Rein Steady', reinSymmetry: 'Symmetry',
};

const RC = { pa: '#F5EFE6', nk: '#1C1C1E', cg: '#C17F4A', ch: '#D4AF76', ideal: '#5B9E56', good: '#E8A857', focus: '#C14A2A' };

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
        }}
      >
        {/* Row 1: Horse · Type + badges */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: RC.nk, fontFamily: "'DM Sans', sans-serif" }}>
            {(ride.type.charAt(0).toUpperCase() + ride.type.slice(1))} · {ride.horse}
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {storedRide?.videoUrl ? (
              <div style={{
                position: 'relative', width: 56, height: 32, borderRadius: 6,
                overflow: 'hidden', background: '#EDE7DF', flexShrink: 0,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
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
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.25), rgba(0,0,0,0.05))',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
                    <path d="M8 5v14l11-7L8 5z"/>
                  </svg>
                </div>
              </div>
            ) : (storedRide?.videoUrl || ride.videoUploaded) ? (
              <span aria-label="Video" title="Video" style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 9, background: `${RC.cg}15`, color: RC.cg,
                padding: '3px 7px', borderRadius: 6,
                fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                letterSpacing: '0.04em',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2"/>
                  <path d="M10 8.5V15.5L16 12L10 8.5Z" fill="currentColor"/>
                </svg>
                VIDEO
              </span>
            ) : null}
          </div>
        </div>

        {/* Row 2: Date · Duration */}
        <div style={{ fontSize: 11, color: COLORS.muted, fontFamily: "'DM Sans', sans-serif", marginBottom: bioEntries.length > 0 ? 8 : 0 }}>
          {dateStr} · {ride.duration}min
        </div>

        {/* Row 3: Best + Worst chips */}
        {best && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
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

        {/* Row 4: Trend + Score */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {trendLabel && (
              <span style={{
                fontSize: 10, fontWeight: 500, textTransform: 'uppercase',
                padding: '2px 8px', borderRadius: 12,
                background: `${trendLabel.color}15`, color: trendLabel.color,
                fontFamily: "'DM Sans', sans-serif",
              }}>{trendLabel.arrow} {trendLabel.text}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {score !== null && (
              <>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 600, color: RC.cg }}>{score}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'rgba(28,28,30,0.35)' }}>/100</span>
              </>
            )}
            <span style={{ color: 'rgba(28,28,30,0.25)', marginLeft: 8, fontSize: 14 }}>›</span>
          </div>
        </div>
      </div>
    </div>
  );
}
