import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStoredRides } from '../../lib/storage';
import { getUserProfile } from '../../lib/userProfile';
import { useCadence } from '../../context/CadenceContext';
import { CadenceIcon } from '../../components/layout/CadenceFAB';

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  pa:    '#F5EFE6',
  nk:    '#1C1C1E',
  cg:    '#C17F4A',
  na:    '#2C3E50',
  ch:    '#D4AF76',
  ideal: '#5B9E56',
  good:  '#E8A857',
  focus: '#C14A2A',
  muted: 'rgba(28,28,30,0.38)',
};

// 5-band scale — matches the rest of the app
function scoreColor(s: number) {
  if (s >= 90) return '#5B9E56';  // Excellent
  if (s >= 75) return '#7D9B76';  // On target
  if (s >= 60) return '#C9A96E';  // Working
  if (s >= 40) return '#C17F4A';  // Building
  return '#C4714A';                // Focus area
}
function scoreLabel(s: number) {
  if (s >= 90) return 'Excellent';
  if (s >= 75) return 'On target';
  if (s >= 60) return 'Working';
  if (s >= 40) return 'Building';
  return 'Focus area';
}

// ── Mock fallback data ─────────────────────────────────────────────────────
const MOCK_BIO = {
  coreStability: 0.88, lowerLegStability: 0.71, reinSteadiness: 0.85,
  pelvisStability: 0.83, upperBodyAlignment: 0.92, reinSymmetry: 0.80,
};
const MOCK_RQ = {
  rhythm: 0.62, relaxation: 0.44, contact: 0.68,
  impulsion: 0.65, straightness: 0.38, balance: 0.78,
};
const MOCK_SCORES = [68, 71, 70, 73, 75, 74, 77, 78];
const MOCK_LABELS = ['Jan 18','Jan 25','Feb 1','Feb 8','Feb 15','Feb 22','Mar 1','Mar 8'];

const BIO_METRICS: Array<{ label: string; key: keyof typeof MOCK_BIO }> = [
  { label: 'Core', key: 'coreStability' },
  { label: 'Lower Leg', key: 'lowerLegStability' },
  { label: 'Reins', key: 'reinSteadiness' },
  { label: 'Pelvis', key: 'pelvisStability' },
  { label: 'Upper Body', key: 'upperBodyAlignment' },
  { label: 'Symmetry', key: 'reinSymmetry' },
];

const RQ_METRICS = ['Rhythm','Relaxation','Contact','Impulsion','Straightness','Balance'] as const;
const RQ_KEYS: Array<keyof typeof MOCK_RQ> = ['rhythm','relaxation','contact','impulsion','straightness','balance'];

// ── Score Ring SVG ─────────────────────────────────────────────────────────
function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = 45;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#EDE7DF" strokeWidth="6" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 50 50)" />
      <text x="50" y="48" textAnchor="middle" dominantBaseline="middle"
        style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
        <tspan fontSize="28" fill={color}>{score}</tspan>
      </text>
      <text x="50" y="70" textAnchor="middle" dominantBaseline="middle"
        style={{ fontFamily: "'DM Mono', monospace", fontSize: '9px', fill: 'rgba(28,28,30,0.3)' }}>
        /100
      </text>
    </svg>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
function SecHdr({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '2px',
      textTransform: 'uppercase', color: C.cg, marginBottom: 10,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {children}
      <span style={{ flex: 1, height: 1, background: 'rgba(193,127,74,0.2)' }}/>
    </div>
  );
}

// ── Chart helpers ──────────────────────────────────────────────────────────
function sy(score: number, scores: number[]) {
  const min = Math.min(...scores) - 5;
  const max = Math.max(...scores) + 5;
  const range = max - min || 1;
  return 10 + (max - score) / range * 120;
}
function sx(i: number, n: number, w = 280) {
  if (n <= 1) return w / 2;
  return 30 + (i / (n - 1)) * (w - 40);
}

// ── Pill button ────────────────────────────────────────────────────────────
function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      height: 28, padding: '0 14px', borderRadius: 14,
      border: active ? 'none' : '1px solid rgba(28,28,30,0.15)',
      background: active ? C.nk : 'transparent',
      color: active ? '#fff' : C.muted,
      fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 600, cursor: 'pointer',
    }}>
      {label}
    </button>
  );
}

// ── Component ───────────────────────────────────────────────────────────────
export default function InsightsTab() {
  const navigate = useNavigate();
  const { openCadence } = useCadence();
  const storedRides = useStoredRides();

  // Time selector state
  const [timeMode, setTimeMode] = useState<'months' | 'rides'>('months');
  const [monthsValue, setMonthsValue] = useState(6);
  const [ridesValue, setRidesValue] = useState(10);

  // Bio scroll state
  const bioScrollRef = useRef<HTMLDivElement>(null);
  const [showScrollArrow, setShowScrollArrow] = useState(true);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [hoveredScoreIdx, setHoveredScoreIdx] = useState<number | null>(null);

  const checkScroll = useCallback(() => {
    const el = bioScrollRef.current;
    if (!el) return;
    setShowScrollArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
    setShowLeftArrow(el.scrollLeft > 10);
  }, []);

  useEffect(() => {
    const el = bioScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll);
    checkScroll();
    return () => el.removeEventListener('scroll', checkScroll);
  }, [checkScroll]);

  const scrollBioRight = () => {
    bioScrollRef.current?.scrollBy({ left: 160, behavior: 'smooth' });
  };
  const scrollBioLeft = () => {
    bioScrollRef.current?.scrollBy({ left: -160, behavior: 'smooth' });
  };

  const allRides = useMemo(() =>
    [...storedRides].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  [storedRides]);

  const hasReal = allRides.length > 0;

  // Filter rides based on time selector
  const rides = useMemo(() => {
    if (!hasReal) return [];
    if (timeMode === 'months') {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - monthsValue);
      return allRides.filter(r => new Date(r.date) >= cutoff);
    }
    return ridesValue === 0 ? allRides : allRides.slice(-ridesValue);
  }, [hasReal, allRides, timeMode, monthsValue, ridesValue]);

  // Derived data
  const overallScores = hasReal
    ? rides.map(r => Math.round(r.overallScore * 100))
    : MOCK_SCORES;
  const xLabels = hasReal
    ? rides.map(r => new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    : MOCK_LABELS;
  const latestScore = overallScores[overallScores.length - 1] ?? 0;
  const prevAvg = overallScores.length > 1
    ? overallScores.slice(0, -1).reduce((a, b) => a + b, 0) / (overallScores.length - 1)
    : null;

  const trendBadge = prevAvg === null ? null
    : latestScore > prevAvg + 3 ? { label: '↑ Building', color: C.ideal }
    : latestScore < prevAvg - 3 ? { label: '↓ Dip', color: C.focus }
    : { label: '→ Steady', color: C.good };

  const totalChange = overallScores.length > 1
    ? overallScores[overallScores.length - 1] - overallScores[0]
    : 0;
  const avgChange = overallScores.length > 1
    ? Math.round(totalChange / (overallScores.length - 1))
    : 0;

  // Bio trend data
  const bioData = BIO_METRICS.map(m => {
    const scores = hasReal
      ? rides.map(r => Math.round(r.biometrics[m.key] * 100))
      : Array(8).fill(0).map(() => Math.round(MOCK_BIO[m.key] * 100));
    const cur = scores[scores.length - 1] ?? 0;
    const nonZero = scores.filter(s => s > 0);
    const first = nonZero[0] ?? 0;
    const last = nonZero[nonZero.length - 1] ?? 0;
    const trend = nonZero.length >= 2 ? last - first : null;
    const hasSufficientData = nonZero.length >= 2;
    return { ...m, scores, cur, trend, hasSufficientData };
  });

  // Riding quality data
  const latestRide = hasReal ? rides[rides.length - 1] : null;
  const rqData = RQ_METRICS.map((name, i) => {
    const key = RQ_KEYS[i];
    const score = latestRide?.ridingQuality
      ? Math.round(latestRide.ridingQuality[key] * 100)
      : Math.round(MOCK_RQ[key] * 100);
    return { name, score };
  });

  // Chart SVG
  const n = overallScores.length;
  const polyPts = overallScores.map((s, i) => `${sx(i, n)},${sy(s, overallScores)}`).join(' ');
  const areaPath = n > 0
    ? `M${sx(0, n)},${sy(overallScores[0], overallScores)} ` +
      overallScores.map((s, i) => `L${sx(i, n)},${sy(s, overallScores)}`).join(' ') +
      ` L${sx(n - 1, n)},135 L${sx(0, n)},135 Z`
    : '';

  const riderName = getUserProfile().firstName || 'Your';
  const dateRange = xLabels.length > 1 ? `${xLabels[0]} – ${xLabels[xLabels.length - 1]}` : xLabels[0] ?? '';

  const headerSubtext = timeMode === 'months'
    ? `Last ${monthsValue} month${monthsValue > 1 ? 's' : ''} · ${dateRange}`
    : `Last ${rides.length} ride${rides.length !== 1 ? 's' : ''} · ${dateRange}`;

  return (
    <div style={{ background: C.pa, paddingBottom: 100 }}>

      {/* ── Score header ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', background: '#fff',
        borderBottom: '0.5px solid rgba(28,28,30,0.08)',
      }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 600, color: C.ch }}>
            {riderName === 'Your' ? 'Your Progress' : `${riderName} · Your Progress`}
          </div>
          <div style={{ fontSize: 10, letterSpacing: '1.2px', textTransform: 'uppercase', color: C.muted, marginTop: 1 }}>
            {headerSubtext}
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 10 }}>
          {trendBadge && (
            <span style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
              padding: '3px 8px', borderRadius: 8, background: `${trendBadge.color}18`, color: trendBadge.color,
              fontFamily: "'DM Sans', sans-serif",
            }}>{trendBadge.label}</span>
          )}
          {/* Score ring — consistent with ride cards + month headers */}
          {(() => {
            const bandColor =
              latestScore >= 90 ? '#5B9E56' :
              latestScore >= 75 ? '#7D9B76' :
              latestScore >= 60 ? '#C9A96E' :
              latestScore >= 40 ? '#C17F4A' :
              '#C4714A';
            const r = 22;
            const circ = 2 * Math.PI * r;
            const dash = (latestScore / 100) * circ;
            return (
              <div style={{ position: 'relative', width: 52, height: 52 }}>
                <svg width="52" height="52" viewBox="0 0 52 52" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(28,28,30,0.08)" strokeWidth="3"/>
                  <circle cx="26" cy="26" r={r} fill="none" stroke={bandColor} strokeWidth="3"
                    strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
                </svg>
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{
                    fontSize: 16, fontWeight: 700, color: bandColor,
                    fontFamily: "'DM Mono', monospace", lineHeight: 1,
                  }}>{latestScore}</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div style={{ padding: '20px 18px 28px' }}>

        {/* ── Time selector (two-tier) — sticky as user scrolls ─────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 20,
          background: C.pa, paddingTop: 10, paddingBottom: 12,
          marginBottom: 10, marginTop: -20, marginLeft: -18, marginRight: -18,
          paddingLeft: 18, paddingRight: 18,
          borderBottom: '0.5px solid rgba(28,28,30,0.06)',
        }}>
          {/* Row 1: mode toggle */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <Pill label="By months" active={timeMode === 'months'} onClick={() => setTimeMode('months')} />
            <Pill label="By rides" active={timeMode === 'rides'} onClick={() => setTimeMode('rides')} />
          </div>
          {/* Row 2: options */}
          <div style={{ display: 'flex', gap: 6 }}>
            {timeMode === 'months'
              ? [{ l: '1M', v: 1 }, { l: '3M', v: 3 }, { l: '6M', v: 6 }, { l: '1Y', v: 12 }].map(o => (
                  <Pill key={o.v} label={o.l} active={monthsValue === o.v} onClick={() => setMonthsValue(o.v)} />
                ))
              : [{ l: '5', v: 5 }, { l: '10', v: 10 }, { l: '20', v: 20 }, { l: 'All', v: 0 }].map(o => (
                  <Pill key={o.v} label={o.l} active={ridesValue === o.v} onClick={() => setRidesValue(o.v)} />
                ))
            }
          </div>
        </div>

        {/* ── Cadence Pattern Insight ─────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Cadence · Pattern insight</SecHdr>
          <div className="cadence-aura" style={{
            position: 'relative', borderRadius: 14, padding: 1.5,
            background: `conic-gradient(from var(--aura-angle,0deg), ${C.cg}, ${C.ch}, ${C.cg}66, ${C.cg})`,
          }}>
          <div style={{
            background: C.na, borderRadius: 12.5, padding: '18px 20px',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: C.cg, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 0 2px rgba(212,175,118,0.25)',
              }}>
                <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontSize: 22, color: '#fff' }}>C</span>
              </div>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.15em',
                textTransform: 'uppercase', color: C.ch, paddingTop: 14,
              }}>
                {n} rides · {dateRange}
              </div>
            </div>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13, color: C.ch, lineHeight: 1.7, margin: 0, marginBottom: 14,
            }}>
              {(() => {
                // Derive strongest + weakest metrics from actual rides in the window
                if (!hasReal || rides.length === 0) {
                  return (
                    <>
                      <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic' }}>
                        Your pattern will emerge here.
                      </span>{' '}
                      Upload a handful of rides and Cadence will show you which biomechanics
                      are your strengths and which are holding you back.
                    </>
                  );
                }
                // Average each biomechanic across the windowed rides
                const avgBy = (key: keyof typeof MOCK_BIO) => {
                  const vals = rides.map(r => Math.round((r.biometrics[key] ?? 0) * 100)).filter(v => v > 0);
                  if (vals.length === 0) return { avg: 0, count: 0 };
                  return { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), count: vals.length };
                };
                const metricRows = BIO_METRICS.map(m => ({
                  label: m.label,
                  key: m.key,
                  ...avgBy(m.key),
                })).filter(m => m.count > 0);

                if (metricRows.length < 2) {
                  return (
                    <>
                      <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic' }}>
                        Early days.
                      </span>{' '}
                      Upload a few more rides to surface the pattern in your biomechanics —
                      Cadence needs at least two metrics with data to compare strengths and gaps.
                    </>
                  );
                }
                const sorted = [...metricRows].sort((a, b) => b.avg - a.avg);
                const strongest = sorted[0];
                const weakest = sorted[sorted.length - 1];
                const spread = strongest.avg - weakest.avg;

                // Trend: compare first-half avg vs second-half avg for weakest
                const halfIdx = Math.floor(rides.length / 2);
                const weakFirst = rides.slice(0, halfIdx).map(r => Math.round((r.biometrics[weakest.key] ?? 0) * 100)).filter(v => v > 0);
                const weakSecond = rides.slice(halfIdx).map(r => Math.round((r.biometrics[weakest.key] ?? 0) * 100)).filter(v => v > 0);
                const weakFirstAvg = weakFirst.length ? weakFirst.reduce((a,b)=>a+b,0)/weakFirst.length : 0;
                const weakSecondAvg = weakSecond.length ? weakSecond.reduce((a,b)=>a+b,0)/weakSecond.length : 0;
                const weakDelta = Math.round(weakSecondAvg - weakFirstAvg);

                const trendPhrase = weakDelta >= 3
                  ? `and ${weakest.label.toLowerCase()} is already climbing (+${weakDelta} pts in the second half of this window).`
                  : weakDelta <= -3
                  ? `and ${weakest.label.toLowerCase()} has dipped ${weakDelta} pts recently — worth flagging with your trainer.`
                  : `addressing ${weakest.label.toLowerCase()} will unlock improvements across the training scales.`;

                const headline = spread >= 25
                  ? 'A clear compensation pattern is emerging.'
                  : spread >= 12
                  ? 'A consistent pattern is emerging.'
                  : 'Your biomechanics are tracking close together.';

                return (
                  <>
                    <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic' }}>
                      {headline}
                    </span>{' '}
                    Across your last {n} ride{n !== 1 ? 's' : ''},
                    {' '}<strong style={{ color: '#fff' }}>{strongest.label.toLowerCase()}</strong> is your standout at {strongest.avg}%,
                    while <strong style={{ color: '#fff' }}>{weakest.label.toLowerCase()}</strong> sits at {weakest.avg}% — {trendPhrase}
                  </>
                );
              })()}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={openCadence}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  background: C.cg, border: 'none', color: '#fff',
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  WebkitTapHighlightColor: 'transparent',
                  boxShadow: '0 2px 12px rgba(193,127,74,0.35)',
                }}
              >
                <CadenceIcon size={16} animated={false} />
                Ask Cadence about your progress
              </button>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  'What pattern should I work on?',
                  'Compare this window to before',
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={openCadence}
                    style={{
                      fontSize: 11, padding: '5px 10px', borderRadius: 14,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(212,175,118,0.25)',
                      color: 'rgba(212,175,118,0.85)',
                      fontFamily: "'DM Sans', sans-serif", fontWeight: 400,
                      cursor: 'pointer', textAlign: 'left',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* ── Ride Score Chart ────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Ride score</SecHdr>
          <div style={{ background: '#fff', borderRadius: 12, padding: '17px 19px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.nk }}>Score over {n} sessions</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 9,
                background: totalChange >= 0 ? 'rgba(91,158,86,0.15)' : 'rgba(193,74,42,0.15)',
                color: totalChange >= 0 ? C.ideal : C.focus,
              }}>{totalChange >= 0 ? '↑' : '↓'} {totalChange >= 0 ? '+' : ''}{totalChange} pts total</span>
            </div>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 12 }}>
              {avgChange >= 0 ? '↑' : '↓'} {avgChange >= 0 ? '+' : ''}{avgChange} pt / session avg
            </div>

            {n > 1 && (
              <div style={{ position: 'relative' }}>
              <svg viewBox="0 0 280 145" style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="areaGradP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.cg} stopOpacity="0.15"/>
                    <stop offset="100%" stopColor={C.cg} stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#areaGradP)"/>
                <line x1={sx(0, n)} y1={sy(overallScores[0], overallScores)} x2={sx(n - 1, n)} y2={sy(overallScores[n - 1], overallScores)}
                  stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeDasharray="5,4"/>
                <polyline points={polyPts} fill="none" stroke={C.cg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                {overallScores.map((s, i) => {
                  const last = i === n - 1;
                  const hovered = hoveredScoreIdx === i;
                  const ride = hasReal && rides[i] ? rides[i] : null;
                  return (
                    <g
                      key={i}
                      onMouseEnter={() => setHoveredScoreIdx(i)}
                      onMouseLeave={() => setHoveredScoreIdx(null)}
                      onClick={() => ride && navigate(`/rides/${ride.id}`)}
                      style={{ cursor: ride ? 'pointer' : 'default' }}
                    >
                      {/* Invisible hit target — larger than visible dot for easy tap/hover */}
                      <circle cx={sx(i, n)} cy={sy(s, overallScores)} r="14" fill="transparent"/>
                      {last
                        ? <circle cx={sx(i, n)} cy={sy(s, overallScores)} r={hovered ? 9 : 7} fill={C.cg} stroke="#fff" strokeWidth="2"/>
                        : <circle cx={sx(i, n)} cy={sy(s, overallScores)} r={hovered ? 6 : 4} fill={hovered ? C.cg : '#fff'} stroke={C.cg} strokeWidth="1.5"/>
                      }
                      {last && !hovered && (
                        <text x={sx(i, n)} y={sy(s, overallScores) - 12} textAnchor="middle"
                          fontSize="12" fontWeight="700" fill={C.cg}
                          fontFamily="'Playfair Display',serif">{s}</text>
                      )}
                    </g>
                  );
                })}
                {xLabels.map((lbl, i) => {
                  if (n > 6 && i % 2 !== 0 && i !== n - 1) return null;
                  const last = i === n - 1;
                  return (
                    <text key={i} x={sx(i, n)} y="142" textAnchor="middle"
                      fontSize="7" fill={last ? C.cg : '#bbb'}
                      fontFamily="Inter,sans-serif"
                      fontWeight={last ? '600' : '400'}>{lbl}</text>
                  );
                })}
              </svg>
              {/* Tooltip */}
              {hoveredScoreIdx !== null && overallScores[hoveredScoreIdx] !== undefined && (() => {
                const idx = hoveredScoreIdx;
                const score = overallScores[idx];
                const ride = hasReal && rides[idx] ? rides[idx] : null;
                const dateLbl = xLabels[idx] ?? '';
                // Position as % of svg width
                const leftPct = n > 1 ? (idx / (n - 1)) * 100 : 50;
                return (
                  <div style={{
                    position: 'absolute', left: `${leftPct}%`, top: -8,
                    transform: 'translate(-50%, -100%)',
                    background: '#1C1C1E', color: '#fff',
                    borderRadius: 8, padding: '6px 10px',
                    fontSize: 11, fontFamily: "'DM Sans', sans-serif",
                    pointerEvents: 'none', whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 5,
                  }}>
                    <div style={{ fontWeight: 600 }}>{dateLbl}</div>
                    <div style={{ color: 'rgba(255,255,255,0.75)', fontFamily: "'DM Mono', monospace" }}>
                      {score}<span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9 }}>/100</span>
                      {ride && <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.55)', fontSize: 9 }}>tap to open →</span>}
                    </div>
                  </div>
                );
              })()}
              </div>
            )}
          </div>
        </div>

        {/* ── Biomechanics Trends — small-multiples sparkline grid ────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Biomechanics trends</SecHdr>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 10, letterSpacing: '0.05em' }}>
            {headerSubtext} · oldest → newest
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {bioData.map(m => {
              const nonZero = m.scores.filter(s => s > 0);
              const hasData = nonZero.length > 0;
              const cur = hasData ? nonZero[nonZero.length - 1] : 0;
              const bandColor = scoreColor(cur);
              const minS = hasData ? Math.min(...nonZero) : 0;
              const maxS = hasData ? Math.max(...nonZero) : 0;
              const rangeS = Math.max(maxS - minS, 1);
              // Sparkline points (zeros are treated as "no data" gaps)
              const W = 120, H = 34;
              const yFor = (s: number) => H - 4 - ((s - minS) / rangeS) * (H - 10);
              const N = m.scores.length;
              const xFor = (i: number) => N === 1 ? W / 2 : (i / (N - 1)) * (W - 6) + 3;
              const segments: string[] = [];
              let pts: string[] = [];
              m.scores.forEach((s, i) => {
                if (s > 0) {
                  pts.push(`${xFor(i)},${yFor(s)}`);
                } else if (pts.length > 0) {
                  segments.push(pts.join(' '));
                  pts = [];
                }
              });
              if (pts.length > 0) segments.push(pts.join(' '));

              return (
                <div key={m.label} style={{
                  background: '#fff', borderRadius: 12, padding: '12px 14px',
                  boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                      textTransform: 'uppercase', color: C.muted, fontFamily: "'DM Sans', sans-serif",
                    }}>
                      {m.label}
                    </div>
                    {m.trend !== null && hasData && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                        background: `${m.trend >= 0 ? C.ideal : C.focus}12`,
                        color: m.trend >= 0 ? C.ideal : C.focus,
                        fontFamily: "'DM Sans', sans-serif",
                      }}>
                        {m.trend >= 0 ? '↑' : '↓'} {m.trend >= 0 ? '+' : ''}{m.trend}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 700,
                    color: hasData ? bandColor : '#ccc', lineHeight: 1, marginBottom: 6,
                  }}>
                    {hasData ? cur : '–'}<span style={{ fontSize: 12, color: '#bbb' }}>/100</span>
                  </div>
                  {/* Bar chart — one bar per ride, hover shows date + score */}
                  {hasData ? (
                    <div style={{
                      display: 'flex', alignItems: 'flex-end', gap: 2, height: H, marginTop: 2,
                    }}>
                      {m.scores.map((s, i) => {
                        const rideDate = hasReal && rides[i]
                          ? new Date(rides[i].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : `#${i + 1}`;
                        const barColor = s > 0 ? scoreColor(s) : 'rgba(0,0,0,0.08)';
                        const height = s > 0 ? Math.max(4, (s / 100) * H) : 3;
                        return (
                          <div
                            key={i}
                            title={s > 0 ? `${rideDate}: ${s}/100` : `${rideDate}: no data`}
                            style={{
                              flex: 1, minWidth: 2, maxWidth: 8,
                              height, borderRadius: '2px 2px 0 0',
                              background: barColor,
                              transition: 'transform 0.15s ease, opacity 0.15s ease',
                              cursor: 'help',
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ height: H, display: 'flex', alignItems: 'center', fontSize: 10, color: '#ccc', fontStyle: 'italic' }}>
                      No data yet
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Riding Quality (rings) ─────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Riding Quality</SecHdr>
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
            The Training Scales — how your riding looks from the outside.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {rqData.map(m => (
              <div key={m.name} style={{
                background: '#fff', borderRadius: 16, padding: 14, textAlign: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              }}>
                <ScoreRing score={m.score} />
                <div style={{ fontSize: 12, color: '#888', fontFamily: "'DM Sans', sans-serif", marginTop: 6 }}>
                  {m.name}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                  color: scoreColor(m.score), fontFamily: "'DM Sans', sans-serif", marginTop: 2,
                }}>
                  {scoreLabel(m.score)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Progression Signal ──────────────────────────────────────── */}
        <div>
          <SecHdr>Progression signal</SecHdr>
          <div style={{
            background: C.na, color: '#fff',
            padding: '20px', borderRadius: 12,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 600, letterSpacing: '1.4px',
              textTransform: 'uppercase', color: C.ch, marginBottom: 8,
              fontFamily: "'Inter', sans-serif",
            }}>
              Intro Level → Training Level
            </div>
            {(() => {
              // Compute progression signal from the latest ride's biometrics:
              // percentage of metrics at "On target" (>=75) or higher.
              const latestRide = hasReal ? allRides[allRides.length - 1] : null;
              const metricsArr = latestRide
                ? [
                    Math.round((latestRide.biometrics.upperBodyAlignment ?? 0) * 100),
                    Math.round((latestRide.biometrics.lowerLegStability ?? 0) * 100),
                    Math.round((latestRide.biometrics.coreStability ?? 0) * 100),
                    Math.round((latestRide.biometrics.pelvisStability ?? 0) * 100),
                    Math.round((latestRide.biometrics.reinSteadiness ?? 0) * 100),
                    Math.round((latestRide.biometrics.reinSymmetry ?? 0) * 100),
                  ]
                : [];
              const atConsistent = metricsArr.filter(s => s >= 75).length;
              const total = Math.max(metricsArr.length, 1);
              const pct = metricsArr.length > 0 ? Math.round((atConsistent / total) * 100) : 68;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 32, fontWeight: 700, color: '#fff', fontFamily: "'Inter', sans-serif" }}>{pct}%</span>
                    <span style={{ fontSize: 13, color: C.ch }}>of biomechanics at On target or above</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.13)', marginBottom: 16 }}>
                    <div style={{
                      height: '100%', borderRadius: 3, width: `${pct}%`,
                      background: `linear-gradient(to right, ${C.cg}, ${C.ch})`,
                    }}/>
                  </div>
                </>
              );
            })()}
            <p style={{
              fontFamily: "'Playfair Display', serif", fontStyle: 'italic',
              fontSize: 13, color: 'rgba(212,175,118,0.82)', lineHeight: 1.78, margin: 0,
            }}>
              {(() => {
                const latestRide = hasReal ? allRides[allRides.length - 1] : null;
                if (!latestRide) {
                  return 'Upload a ride to see what\'s keeping you from the next level.';
                }
                const bio = latestRide.biometrics;
                const entries = [
                  { label: 'Upper Body', score: Math.round((bio.upperBodyAlignment ?? 0) * 100) },
                  { label: 'Lower Leg', score: Math.round((bio.lowerLegStability ?? 0) * 100) },
                  { label: 'Core', score: Math.round((bio.coreStability ?? 0) * 100) },
                  { label: 'Pelvis', score: Math.round((bio.pelvisStability ?? 0) * 100) },
                  { label: 'Rein Steadiness', score: Math.round((bio.reinSteadiness ?? 0) * 100) },
                  { label: 'Rein Symmetry', score: Math.round((bio.reinSymmetry ?? 0) * 100) },
                ].filter(e => e.score > 0);
                if (entries.length === 0) return 'Your first analyzed ride will set your baseline.';
                const below = entries.filter(e => e.score < 75).sort((a, b) => a.score - b.score);
                if (below.length === 0) {
                  return 'Every biomechanic is at On target or above — you\'re ready to aim higher.';
                }
                if (below.length === 1) {
                  return `${below[0].label} at ${below[0].score}/100 is your last remaining barrier. Stabilize it and the next level opens up.`;
                }
                const top2 = below.slice(0, 2).map(e => e.label).join(' and ');
                return `${top2} are the biggest gaps right now. Focusing there will unlock the rest of the training scales.`;
              })()}
            </p>

            {/* CTAs */}
            <button onClick={() => navigate('/journey')} style={{
              width: '100%', height: 44, marginTop: 16,
              background: C.cg, color: '#fff', border: 'none', borderRadius: 22,
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              Explore your Journey →
            </button>
            <div style={{
              marginTop: 8, padding: '10px 14px',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 14,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <span style={{
                  color: 'rgba(255,255,255,0.55)', fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13, fontWeight: 600,
                }}>Run the Test</span>
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                  background: C.ch, color: C.nk,
                }}>Coming soon</span>
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.4)', fontFamily: "'DM Sans', sans-serif",
                fontSize: 11, marginTop: 4, lineHeight: 1.45,
              }}>
                Ride a full test and see each movement scored like a judge would — your readiness, explained.
              </div>
            </div>
          </div>
        </div>

      </div>

      <style>{`
        @property --aura-angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes aura-rotate { to { --aura-angle: 360deg; } }
        .cadence-aura { animation: aura-rotate 6s linear infinite; }
        @keyframes cadPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
