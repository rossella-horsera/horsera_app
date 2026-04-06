import React, { useState, useEffect } from 'react';
import { getUserProfile } from '../lib/userProfile';
import { getRides } from '../lib/storage';

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  pa: '#F5EFE6', nk: '#1C1C1E', cg: '#C17F4A', ch: '#D4AF76',
  ideal: '#5B9E56', good: '#E8A857', focus: '#C14A2A', na: '#2C3E50',
  muted: 'rgba(28,28,30,0.38)',
};
function scoreColor(s: number) { return s >= 8 ? C.ideal : s >= 6 ? C.good : C.focus; }

// ── Level data ────────────────────────────────────────────────────────────
const LEVEL_DATA: Record<string, {
  levelName: string;
  usef: boolean;
  gaits: string;
  tests: string[];
  purpose: string;
  requirements: string[];
  keyFocus: string;
}> = {
  intro: {
    levelName: 'Introductory Level',
    usef: false,
    gaits: 'Walk · Trot',
    tests: ['A', 'B', 'C'],
    purpose: 'To introduce the rider and/or horse to the sport of dressage. The horse should be ridden freely forward in a steady tempo and clear rhythm, accepting contact with the bit.',
    requirements: ['Free walk', 'Medium walk', 'Working trot rising', '20m circle', 'Halt through walk'],
    keyFocus: 'Rhythm, relaxation, and basic geometry',
  },
  training: {
    levelName: 'Training Level',
    usef: true,
    gaits: 'Walk · Trot · Canter',
    tests: ['1', '2', '3'],
    purpose: "To confirm that the horse's muscles are supple and loose, and that it moves freely forward in a clear and steady rhythm, accepting contact with the bit.",
    requirements: ['Free walk', 'Medium walk', 'Working trot', 'Working canter', '20m circle', 'Halt'],
    keyFocus: 'Acceptance of contact, regularity of gaits, forward energy',
  },
  first: {
    levelName: 'First Level',
    usef: true,
    gaits: 'Walk · Trot · Canter',
    tests: ['1', '2', '3'],
    purpose: 'To confirm that the horse, in addition to the requirements of Training Level, has developed thrust and achieved a degree of balance and throughness.',
    requirements: ['Leg yield', '15m circles', 'Lengthen stride', 'Stretchy trot circle', 'Counter canter'],
    keyFocus: 'Impulsion, balance, and beginning lateral work',
  },
  second: {
    levelName: 'Second Level',
    usef: true,
    gaits: 'Walk · Trot · Canter',
    tests: ['1', '2', '3'],
    purpose: 'To confirm that the horse has developed thrust and achieved a degree of collection, demonstrating straightness, bend, and the ability to perform lateral movements.',
    requirements: ['Shoulder-in', 'Travers', 'Renvers', 'Half-pass', 'Medium gaits', 'Counter canter', 'Rein-back'],
    keyFocus: 'Collection, lateral movements, and medium gaits',
  },
  third: {
    levelName: 'Third Level',
    usef: true,
    gaits: 'Walk · Trot · Canter',
    tests: ['1', '2', '3'],
    purpose: 'To confirm that the horse has developed sufficient impulsion and throughness to perform the more advanced movements with balance, engagement, and straightness.',
    requirements: ['Flying changes', 'Half-pirouette', 'Half-pass trot & canter', 'Extended gaits', 'Collected walk'],
    keyFocus: 'Engagement, flying changes, and extended gaits',
  },
  fourth: {
    levelName: 'Fourth Level',
    usef: true,
    gaits: 'Walk · Trot · Canter',
    tests: ['1', '2', '3'],
    purpose: 'To confirm that the horse has developed sufficient collection and throughness to perform demanding movements with lightness, expression, and self-carriage.',
    requirements: ['Tempi changes', 'Canter pirouette', 'Piaffe preparation', 'Passage preparation', 'Extended trot & canter'],
    keyFocus: 'Collection, advanced movements, and self-carriage',
  },
};

// ── USDF Intro A Movements ────────────────────────────────────────────────
const MOVEMENTS = [
  { num: 1, movement: "Enter working trot rising → Medium walk", directive: "Regularity, quality of trot; straightness, willing transition. Regularity, quality of walk.", metrics: ['coreStability', 'lowerLegStability', 'rhythm'] as string[] },
  { num: 2, movement: "Track right → Working trot rising", directive: "Bend and balance; willing, calm transition.", metrics: ['reinSymmetry', 'balance', 'rhythm'] as string[] },
  { num: 3, movement: "Circle right 20m, working trot rising", directive: "Regularity, shape and size of circle; bend; balance.", metrics: ['reinSymmetry', 'lowerLegStability', 'balance'] as string[] },
  { num: 4, movement: "Change rein K–X–M, working trot rising", directive: "Regularity of trot; straightness; bend and balance in corner.", metrics: ['straightness', 'rhythm', 'reinSymmetry'] as string[] },
  { num: 5, movement: "Circle left 20m, working trot rising", directive: "Regularity, shape and size of circle; bend; balance.", metrics: ['reinSymmetry', 'lowerLegStability', 'balance'] as string[] },
  { num: 6, movement: "Medium walk", directive: "Quality, freedom, and regularity of walk.", metrics: ['rhythm', 'relaxation', 'contact'] as string[] },
  { num: 7, movement: "Working trot rising", directive: "Willing, balanced transition; regularity.", metrics: ['rhythm', 'coreStability', 'lowerLegStability'] as string[] },
  { num: 8, movement: "Medium walk → Down centerline", directive: "Quality of walk; straightness on centerline.", metrics: ['straightness', 'contact', 'rhythm'] as string[] },
  { num: 9, movement: "Halt and salute at X", directive: "Straightness; attentiveness; immobility (min. 3 seconds).", metrics: ['upperBodyAlignment', 'coreStability', 'contact'] as string[] },
];

const COLLECTIVE_MARKS = [
  { label: "Gaits", sub: "Freedom and regularity", metrics: ["rhythm"] },
  { label: "Impulsion", sub: "Forward, supple back, steady tempo", metrics: ["impulsion"] },
  { label: "Submission", sub: "Steady contact, attention, confidence", metrics: ["contact"], coeff: 2 },
  { label: "Rider's position", sub: "Keeping in balance with horse", metrics: ["upperBodyAlignment", "coreStability", "pelvisStability", "lowerLegStability"] },
  { label: "Effectiveness of aids", sub: "Correct bend, preparation of transitions", metrics: ["reinSteadiness", "reinSymmetry", "lowerLegStability"] },
  { label: "Geometry & accuracy", sub: "Size and shape of circles and turns", metrics: [] as string[], note: "Spatial tracking coming soon" },
];

const DRESSAGE_LEVELS = [
  { key: 'intro', label: 'Intro' },
  { key: 'training', label: 'Training' },
  { key: 'first', label: 'First' },
  { key: 'second', label: 'Second' },
  { key: 'third', label: 'Third' },
  { key: 'fourth', label: 'Fourth' },
];

const DISCIPLINE_OPTIONS = [
  { key: 'usdf-dressage', label: 'USDF Dressage' },
  { key: 'hunter-jumper', label: 'Hunter / Jumper' },
  { key: 'pony-club', label: 'Pony Club' },
  { key: 'a-bit-of-everything', label: 'All-Round' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMetricScore(ride: any, key: string): number {
  return ride?.biometrics?.[key] ?? ride?.ridingQuality?.[key] ?? 0.5;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function movementReadiness(ride: any, metrics: string[]): number {
  if (!ride || !metrics.length) return 5;
  const avg = metrics.reduce((sum, k) => sum + getMetricScore(ride, k), 0) / metrics.length;
  return Math.min(10, Math.round(avg * 10 * 10) / 10);
}

const METRIC_LABELS: Record<string, string> = {
  coreStability: 'Core', lowerLegStability: 'Lower Leg', reinSteadiness: 'Reins',
  reinSymmetry: 'Symmetry', upperBodyAlignment: 'Upper Body', pelvisStability: 'Pelvis',
  rhythm: 'Rhythm', relaxation: 'Relaxation', contact: 'Contact',
  impulsion: 'Impulsion', straightness: 'Straightness', balance: 'Balance',
};

const DISCIPLINE_LABELS: Record<string, string> = {
  'usdf-dressage': 'USDF Dressage', 'usdf': 'USDF Dressage',
  'pony-club': 'Pony Club', 'hunter-jumper': 'Hunter / Jumper',
  'a-bit-of-everything': 'All-Round',
};

function SecHdr({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: C.cg, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: 'rgba(193,127,74,0.2)' }} />
    </div>
  );
}

const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: '#fff', borderRadius: 16, padding: 16,
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)', ...extra,
});

// ════════════════════════════════════════════════════════════════════════════
// Infer the rider's "current working level" — the highest level they're
// actively developing toward. Uses the last 3 rides' avg overall score.
// This is the level NOT yet mastered, which is what Journey should focus on.
function inferLevelFromRides(rides: Array<{ overallScore: number }>): {
  level: string;
  confidence: 'low' | 'medium' | 'high';
} {
  if (rides.length === 0) return { level: 'intro', confidence: 'low' };
  const recent = rides.slice(-3);
  const avg = Math.round(
    (recent.reduce((a, r) => a + r.overallScore, 0) / recent.length) * 100
  );
  const confidence = recent.length >= 3 ? 'medium' : 'low';
  // Next-unmastered logic: a level is "mastered" if scores are high enough to
  // move past it. We return the level the rider is currently working AT.
  if (avg >= 90) return { level: 'fourth', confidence };
  if (avg >= 80) return { level: 'third', confidence };
  if (avg >= 70) return { level: 'second', confidence };
  if (avg >= 60) return { level: 'first', confidence };
  if (avg >= 45) return { level: 'training', confidence };
  return { level: 'intro', confidence };
}

export default function JourneyPage() {
  const profile = getUserProfile();
  const [selectedDiscipline, setSelectedDiscipline] = useState(profile.discipline ?? 'usdf-dressage');
  const [showDisciplineSelector, setShowDisciplineSelector] = useState(false);

  // Seed the level from profile if set, else infer from ride data (beta)
  const _seedRides = getRides().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const _profileLevel = (profile.level || '').toLowerCase();
  const _knownLevels = ['intro', 'training', 'first', 'second', 'third', 'fourth'];
  const _inferred = inferLevelFromRides(_seedRides);
  const _initialLevel = _knownLevels.includes(_profileLevel) ? _profileLevel : _inferred.level;
  const [levelWasInferred] = useState(() => !_knownLevels.includes(_profileLevel) && _seedRides.length > 0);

  const [selectedLevel, setSelectedLevel] = useState(_initialLevel);
  const [selectedTest, setSelectedTest] = useState('A');
  const [expandedMvt, setExpandedMvt] = useState(0);
  const [showPurpose, setShowPurpose] = useState(false);

  const disciplineLabel = DISCIPLINE_LABELS[selectedDiscipline] ?? 'Equestrian';
  const isDressage = selectedDiscipline === 'usdf' || selectedDiscipline === 'usdf-dressage';
  const levelInfo = LEVEL_DATA[selectedLevel];
  const hasFullData = selectedLevel === 'intro' && selectedTest === 'A';
  const activeIndex = DRESSAGE_LEVELS.findIndex(l => l.key === selectedLevel);

  // Reset test when level changes
  useEffect(() => {
    const level = LEVEL_DATA[selectedLevel];
    if (level) setSelectedTest(level.tests[0]);
  }, [selectedLevel]);

  const allRides = getRides().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = allRides.length > 0 ? allRides[allRides.length - 1] : null;

  const mvtScores = MOVEMENTS.map(m => movementReadiness(latest, m.metrics));
  const overallReadiness = hasFullData && latest
    ? Math.round((mvtScores.reduce((a, b) => a + b, 0) / mvtScores.length) * 10)
    : null;

  if (!isDressage) {
    return (
      <div style={{ background: C.pa, minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 28px 60px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.ch, marginBottom: 12 }}>Your Journey</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: C.nk, textAlign: 'center', marginBottom: 12 }}>
          Coming soon for {disciplineLabel}
        </div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: '#7A6B5D', textAlign: 'center', lineHeight: 1.65, maxWidth: 290 }}>
          We're building progression paths for every discipline. Dressage is live — yours is next.
        </p>
        <button onClick={() => setSelectedDiscipline('usdf-dressage')} style={{
          marginTop: 16, background: 'none', border: `1px solid ${C.cg}`, borderRadius: 20,
          padding: '8px 20px', color: C.cg, fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, cursor: 'pointer',
        }}>Switch to Dressage →</button>
      </div>
    );
  }

  return (
    <div style={{ background: C.pa, minHeight: '100dvh', paddingBottom: 120 }}>
      <style>{`@keyframes jFade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }`}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 18px', background: '#fff', borderBottom: '0.5px solid rgba(28,28,30,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.ch, fontFamily: "'DM Sans', sans-serif" }}>
              Your Journey
            </div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 600, color: C.nk, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
              {levelInfo?.levelName ?? 'Intro Level'} · Test {selectedTest}
              {levelWasInferred && (
                <span
                  title="Level inferred from your biomechanics scores. Set your level in Profile for better accuracy."
                  style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
                    color: C.cg, background: 'rgba(193,127,74,0.1)',
                    padding: '2px 6px', borderRadius: 4,
                    fontFamily: "'DM Sans', sans-serif",
                    textTransform: 'uppercase', cursor: 'help',
                  }}
                >
                  Inferred · Beta
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{
                fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace",
                letterSpacing: '0.10em', textTransform: 'uppercase',
                background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.18)',
                borderRadius: 20, padding: '2px 10px',
              }}>{disciplineLabel}</span>
              <button onClick={() => setShowDisciplineSelector(d => !d)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 10, color: C.cg, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, padding: 0,
              }}>Change ›</button>
            </div>
            {levelInfo && (
              <div style={{ fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace", marginTop: 4 }}>
                {levelInfo.gaits}
              </div>
            )}
          </div>
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="22" fill="none" stroke="#EDE7DF" strokeWidth="3" />
            {overallReadiness !== null && (
              <circle cx="26" cy="26" r="22" fill="none" stroke={C.cg} strokeWidth="3"
                strokeDasharray={`${(overallReadiness / 100) * 2 * Math.PI * 22} ${2 * Math.PI * 22}`}
                strokeLinecap="round" transform="rotate(-90 26 26)" />
            )}
            <text x="26" y="28" textAnchor="middle" style={{ fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
              <tspan fontSize="13" fill={C.cg}>{overallReadiness ?? '–'}</tspan>
              <tspan fontSize="8" fill="#BBB">%</tspan>
            </text>
          </svg>
        </div>

        {showDisciplineSelector && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {DISCIPLINE_OPTIONS.map(d => (
              <button key={d.key} onClick={() => {
                setSelectedDiscipline(d.key);
                try { const { setUserProfile } = require('../lib/userProfile'); setUserProfile({ ...profile, discipline: d.key }); } catch { /* noop */ }
                setShowDisciplineSelector(false);
              }} style={{
                fontSize: 10, padding: '4px 12px', borderRadius: 14,
                border: `1px solid ${selectedDiscipline === d.key ? C.cg : 'rgba(28,28,30,0.15)'}`,
                background: selectedDiscipline === d.key ? `${C.cg}12` : 'transparent',
                color: selectedDiscipline === d.key ? C.cg : C.muted,
                fontFamily: "'DM Sans', sans-serif", fontWeight: 500, cursor: 'pointer',
              }}>{d.label}</button>
            ))}
          </div>
        )}

        {/* Horizontal stepper */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginTop: 14 }}>
          {DRESSAGE_LEVELS.map((level, i) => {
            const isActive = level.key === selectedLevel;
            const isPast = i < activeIndex;
            const isFuture = i > activeIndex;
            return (
              <React.Fragment key={level.key}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: isActive ? C.cg : 'transparent', fontFamily: "'DM Sans', sans-serif", height: 10 }}>You</span>
                  <div onClick={() => setSelectedLevel(level.key)} style={{
                    width: isActive ? 14 : isPast ? 10 : 8, height: isActive ? 14 : isPast ? 10 : 8,
                    borderRadius: '50%', cursor: 'pointer',
                    background: isActive ? C.cg : isPast ? '#8C5A3C' : 'transparent',
                    border: isFuture ? '1.5px solid rgba(193,127,74,0.3)' : 'none',
                    boxShadow: isActive ? '0 0 0 3px rgba(193,127,74,0.18)' : 'none',
                    transition: 'all 0.2s ease',
                  }} />
                  <span onClick={() => setSelectedLevel(level.key)} style={{
                    fontSize: 9, whiteSpace: 'nowrap', cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? C.cg : isPast ? 'rgba(28,28,30,0.55)' : 'rgba(28,28,30,0.25)',
                    fontFamily: "'DM Sans', sans-serif",
                  }}>{level.label}</span>
                </div>
                {i < DRESSAGE_LEVELS.length - 1 && (
                  <div style={{ flex: 1, height: 1.5, marginBottom: 14, marginLeft: 2, marginRight: 2,
                    background: i < activeIndex ? 'linear-gradient(to right, #8C5A3C, rgba(193,127,74,0.4))' : 'rgba(193,127,74,0.15)' }} />
                )}
              </React.Fragment>
            );
          })}
          <span style={{ fontSize: 8, color: 'rgba(193,127,74,0.4)', fontFamily: "'DM Sans', sans-serif", marginLeft: 6, whiteSpace: 'nowrap', marginBottom: 14 }}>FEI →</span>
        </div>

        {/* Test tabs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {(levelInfo?.tests ?? []).map(test => {
            const isActive = selectedTest === test;
            return (
              <button key={test} onClick={() => setSelectedTest(test)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                fontSize: 11, fontFamily: "'DM Sans', sans-serif",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.cg : C.muted,
                borderBottom: isActive ? `2px solid ${C.cg}` : '2px solid transparent',
                paddingBottom: 4,
              }}>
                Test {test}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '20px 18px' }}>

        {/* ── About this test ──────────────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          <button onClick={() => setShowPurpose(p => !p)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 12, color: C.cg, fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>About this test {showPurpose ? '↑' : '↓'}</button>
          {showPurpose && levelInfo && (
            <div style={{ ...card({ marginTop: 10 }), animation: 'jFade 0.3s ease' }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.na, lineHeight: 1.65, margin: 0, marginBottom: 12 }}>
                {levelInfo.purpose}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {levelInfo.requirements.map(r => (
                  <span key={r} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 12, background: 'rgba(193,127,74,0.08)', color: C.cg, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{r}</span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.cg, fontStyle: 'italic' }}>Focus: {levelInfo.keyFocus}</div>
            </div>
          )}
        </div>

        {/* ── Readiness Bar ────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...card() }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>
              <span>Not ready</span><span>Test ready</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: `linear-gradient(to right, ${C.focus}, ${C.good}, ${C.ideal})`, position: 'relative', marginBottom: 8 }}>
              {overallReadiness !== null && (
                <div style={{ position: 'absolute', left: `${overallReadiness}%`, top: -3, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: `2px solid ${C.cg}`, transform: 'translateX(-50%)', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }} />
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif" }}>
              {overallReadiness !== null
                ? `You: ${overallReadiness}% predicted readiness`
                : hasFullData
                  ? '–– Upload a ride to see your readiness'
                  : 'Movement data for this test coming soon.'}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {hasFullData ? 'Based on your most recent session. Upload more rides to improve accuracy.' : `Full readiness tracking for ${levelInfo?.levelName} Test ${selectedTest} is on its way.`}
            </div>
          </div>
        </div>

        {/* ── Level content ─────────────────────────────────────────── */}
        {hasFullData ? (
          <>
            {/* Movements */}
            <SecHdr>Movements</SecHdr>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {MOVEMENTS.map((m, idx) => {
                const score = mvtScores[idx];
                const expanded = expandedMvt === idx;
                const dotColor = scoreColor(score);
                const lowestMetric = latest ? m.metrics.reduce((low, k) => getMetricScore(latest, k) < getMetricScore(latest, low) ? k : low, m.metrics[0]) : null;
                const lowestScore = lowestMetric ? getMetricScore(latest!, lowestMetric) : 0;
                return (
                  <div key={m.num} style={{ ...card({ padding: 0, overflow: 'hidden' }) }}>
                    <button onClick={() => setExpandedMvt(expanded ? -1 : idx)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${C.cg}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: C.cg, fontFamily: "'DM Mono', monospace" }}>{m.num}</div>
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif" }}>{m.movement}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: C.nk }}>{latest ? score.toFixed(1) : '–'}</span>
                        <span style={{ fontSize: 9, color: C.muted }}>/10</span>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: latest ? dotColor : '#ddd' }} />
                      </div>
                    </button>
                    {expanded && (
                      <div style={{ padding: '0 16px 14px', borderTop: '1px solid #f0ece6', animation: 'jFade 0.2s ease' }}>
                        <p style={{ fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic', fontSize: 12, color: C.na, lineHeight: 1.55, margin: '10px 0' }}>{m.directive}</p>
                        {latest && (
                          <>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                              {m.metrics.map(k => {
                                const val = Math.round(getMetricScore(latest, k) * 10 * 10) / 10;
                                return (<span key={k} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 8, background: `${scoreColor(val)}14`, color: scoreColor(val), fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{METRIC_LABELS[k] ?? k} {val.toFixed(1)}</span>);
                              })}
                            </div>
                            <div style={{ fontSize: 12, color: C.na, fontFamily: "'DM Sans', sans-serif", borderLeft: `2px solid ${C.cg}`, paddingLeft: 10 }}>
                              {lowestScore < 0.6 ? `Focus on ${METRIC_LABELS[lowestMetric!] ?? lowestMetric} to improve this movement.` : 'This movement looks strong — keep building.'}
                            </div>
                          </>
                        )}
                        {!latest && <div style={{ fontSize: 12, color: C.muted }}>Upload a ride to see metric breakdown.</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Collective Marks */}
            <SecHdr>Collective Marks</SecHdr>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {COLLECTIVE_MARKS.map(cm => {
                const hasMetrics = cm.metrics.length > 0 && !cm.note;
                const score = hasMetrics && latest ? Math.min(10, Math.round((cm.metrics.reduce((s, k) => s + getMetricScore(latest, k), 0) / cm.metrics.length) * 10 * 10) / 10) : null;
                return (
                  <div key={cm.label} style={{ ...card({ padding: '14px 16px' }) }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif" }}>{cm.label}</span>
                        {cm.coeff && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: `${C.cg}14`, color: C.cg }}>×{cm.coeff}</span>}
                      </div>
                      {score !== null && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: C.nk }}>{score.toFixed(1)}<span style={{ fontSize: 9, color: C.muted }}>/10</span></span>}
                      {score === null && !cm.note && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: '#ccc' }}>–</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: hasMetrics && score !== null ? 8 : 0 }}>{cm.sub}</div>
                    {hasMetrics && score !== null && (
                      <div style={{ height: 4, borderRadius: 2, background: '#EDE7DF' }}>
                        <div style={{ width: `${score * 10}%`, height: '100%', borderRadius: 2, background: scoreColor(score), transition: 'width 0.6s ease' }} />
                      </div>
                    )}
                    {cm.note && <div style={{ fontSize: 11, color: C.cg, fontStyle: 'italic', marginTop: 4 }}>{cm.note}</div>}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ ...card({ padding: 20, textAlign: 'center' }), marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>
              {levelInfo?.levelName ?? ''} Test {selectedTest} — Coming soon
            </div>
            <p style={{ fontSize: 12, color: C.muted, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6, margin: 0 }}>
              Full movement breakdown for this test is on its way. Keep building at Intro A — your scores there will carry forward.
            </p>
          </div>
        )}

        {/* ── Simulate the Test ─────────────────────────────────────── */}
        <div style={{ ...card({ background: C.na, padding: 20 }) }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: C.cg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7 4L15 10L7 16V4Z" fill="#fff" /></svg>
            </div>
            <div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#fff', marginBottom: 6 }}>Simulate the Test</div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'rgba(212,175,118,0.75)', lineHeight: 1.6, margin: 0 }}>
                Ride through the {levelInfo?.levelName ?? 'Intro Level'} Test {selectedTest} movements in order and receive a predicted judge's score for each — just like competition day. See exactly where you stand today.
              </p>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {['9 movements', 'Predicted scores', 'Full scorecard'].map(chip => (
                  <span key={chip} style={{ fontSize: 9, fontWeight: 500, padding: '3px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontFamily: "'DM Sans', sans-serif" }}>{chip}</span>
                ))}
              </div>
              <span style={{ display: 'inline-block', marginTop: 10, fontSize: 9, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: C.ch, color: C.nk }}>Coming soon</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
