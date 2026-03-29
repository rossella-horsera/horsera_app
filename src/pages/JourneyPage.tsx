import { useState } from 'react';
import { getUserProfile } from '../lib/userProfile';
import { getRides } from '../lib/storage';

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  pa: '#F5EFE6', nk: '#1C1C1E', cg: '#C17F4A', ch: '#D4AF76',
  ideal: '#5B9E56', good: '#E8A857', focus: '#C14A2A', na: '#2C3E50',
  muted: 'rgba(28,28,30,0.38)',
};
function scoreColor(s: number) { return s >= 8 ? C.ideal : s >= 6 ? C.good : C.focus; }

// ── USDF Intro A Test Data ────────────────────────────────────────────────
const TEST_PURPOSE = "To introduce the rider and/or horse to the sport of dressage. The horse should be ridden freely forward in a steady tempo and clear rhythm, accepting contact with the bit.";
const TEST_REQUIREMENTS = ['Free walk', 'Medium walk', 'Working trot rising', '20m circle', 'Halt'];

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
  { label: "Geometry & accuracy", sub: "Size and shape of circles and turns", metrics: [], note: "Spatial tracking coming soon" },
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

// ── Section Header ─────────────────────────────────────────────────────────
function SecHdr({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '2px',
      textTransform: 'uppercase', color: C.cg, marginBottom: 10,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {children}
      <span style={{ flex: 1, height: 1, background: 'rgba(193,127,74,0.2)' }} />
    </div>
  );
}

const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: '#fff', borderRadius: 16, padding: 16,
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)', ...extra,
});

// ── Journey nodes ──────────────────────────────────────────────────────────
interface PathNode { label: string; sublabel: string; state: 'done' | 'active' | 'future' | 'far'; }

function getDressageNodes(): PathNode[] {
  return [
    { label: 'Intro Level', sublabel: 'Walk, trot, rhythm, relaxation', state: 'active' },
    { label: 'Training Level', sublabel: 'Steady contact, balanced canter', state: 'future' },
    { label: 'First Level', sublabel: 'Bend, balance, leg yield', state: 'future' },
    { label: 'Second Level', sublabel: 'Collection, shoulder-in, travers', state: 'far' },
    { label: 'Third Level', sublabel: 'Flying changes, half-pass', state: 'far' },
  ];
}

const DISCIPLINE_LABELS: Record<string, string> = {
  'usdf-dressage': 'USDF Dressage', 'usdf': 'USDF Dressage',
  'pony-club': 'Pony Club', 'hunter-jumper': 'Hunter / Jumper',
  'a-bit-of-everything': 'All-Round',
};

// ════════════════════════════════════════════════════════════════════════════
export default function JourneyPage() {
  const profile = getUserProfile();
  const disciplineLabel = DISCIPLINE_LABELS[profile.discipline] ?? 'Equestrian';
  const isDressage = profile.discipline === 'usdf' || profile.discipline === 'usdf-dressage';

  const allRides = getRides().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = allRides.length > 0 ? allRides[allRides.length - 1] : null;

  const [expandedMvt, setExpandedMvt] = useState(0); // first expanded by default
  const [showPurpose, setShowPurpose] = useState(false);

  // Readiness
  const mvtScores = MOVEMENTS.map(m => movementReadiness(latest, m.metrics));
  const overallReadiness = latest
    ? Math.round((mvtScores.reduce((a, b) => a + b, 0) / mvtScores.length) * 10)
    : null;

  // Non-dressage fallback
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
      </div>
    );
  }

  const journeyNodes = getDressageNodes();

  return (
    <div style={{ background: C.pa, minHeight: '100dvh', paddingBottom: 120 }}>

      <style>{`
        @keyframes jPulse { 0%,100%{transform:scale(1);opacity:0.5} 70%{transform:scale(1.6);opacity:0} }
        @keyframes jFade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 18px', background: '#fff',
        borderBottom: '0.5px solid rgba(28,28,30,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.ch, fontFamily: "'DM Sans', sans-serif" }}>
            Your Journey
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 600, color: C.nk, marginTop: 2 }}>
            USDF Intro Level · Test A
          </div>
          <div style={{
            fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.10em', textTransform: 'uppercase', marginTop: 2,
            background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.18)',
            borderRadius: 20, padding: '2px 10px', display: 'inline-block',
          }}>
            {disciplineLabel}
          </div>
        </div>
        {/* Readiness ring */}
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

      <div style={{ padding: '20px 18px' }}>

        {/* ── Test Purpose (collapsible) ───────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          <button onClick={() => setShowPurpose(p => !p)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 12, color: C.cg, fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            About this test {showPurpose ? '↑' : '↓'}
          </button>
          {showPurpose && (
            <div style={{ ...card({ marginTop: 10 }), animation: 'jFade 0.3s ease' }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.na, lineHeight: 1.65, margin: 0, marginBottom: 12 }}>
                {TEST_PURPOSE}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TEST_REQUIREMENTS.map(r => (
                  <span key={r} style={{
                    fontSize: 10, padding: '3px 10px', borderRadius: 12,
                    background: 'rgba(193,127,74,0.08)', color: C.cg,
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                  }}>{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Test Readiness Bar ───────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...card() }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>
              <span>Not ready</span>
              <span>Test ready</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: `linear-gradient(to right, ${C.focus}, ${C.good}, ${C.ideal})`, position: 'relative', marginBottom: 8 }}>
              {overallReadiness !== null && (
                <div style={{
                  position: 'absolute', left: `${overallReadiness}%`, top: -3,
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#fff', border: `2px solid ${C.cg}`,
                  transform: 'translateX(-50%)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                }} />
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif" }}>
              You: {overallReadiness !== null ? `${overallReadiness}% predicted readiness` : '–– Upload a ride to see your readiness'}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Based on your most recent session. Upload more rides to improve accuracy.
            </div>
          </div>
        </div>

        {/* ── Movements ───────────────────────────────────────────── */}
        <SecHdr>Movements</SecHdr>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {MOVEMENTS.map((m, idx) => {
            const score = mvtScores[idx];
            const expanded = expandedMvt === idx;
            const dotColor = scoreColor(score);
            const lowestMetric = latest
              ? m.metrics.reduce((low, k) => getMetricScore(latest, k) < getMetricScore(latest, low) ? k : low, m.metrics[0])
              : null;
            const lowestScore = lowestMetric ? getMetricScore(latest!, lowestMetric) : 0;

            return (
              <div key={m.num} style={{ ...card({ padding: 0, overflow: 'hidden' }) }}>
                <button onClick={() => setExpandedMvt(expanded ? -1 : idx)} style={{
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', background: `${C.cg}12`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    fontSize: 12, fontWeight: 700, color: C.cg, fontFamily: "'DM Mono', monospace",
                  }}>{m.num}</div>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif" }}>
                      {m.movement}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: C.nk }}>
                      {latest ? score.toFixed(1) : '–'}
                    </span>
                    <span style={{ fontSize: 9, color: C.muted }}>/10</span>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: latest ? dotColor : '#ddd' }} />
                  </div>
                </button>

                {expanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid #f0ece6', animation: 'jFade 0.2s ease' }}>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic', fontSize: 12, color: C.na, lineHeight: 1.55, margin: '10px 0' }}>
                      {m.directive}
                    </p>
                    {latest && (
                      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {m.metrics.map(k => {
                            const val = Math.round(getMetricScore(latest, k) * 10 * 10) / 10;
                            return (
                              <span key={k} style={{
                                fontSize: 10, padding: '3px 8px', borderRadius: 8,
                                background: `${scoreColor(val)}14`, color: scoreColor(val),
                                fontFamily: "'DM Mono', monospace", fontWeight: 600,
                              }}>
                                {METRIC_LABELS[k] ?? k} {val.toFixed(1)}
                              </span>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 12, color: C.na, fontFamily: "'DM Sans', sans-serif", borderLeft: `2px solid ${C.cg}`, paddingLeft: 10 }}>
                          {lowestScore < 0.6
                            ? `Focus on ${METRIC_LABELS[lowestMetric!] ?? lowestMetric} to improve this movement.`
                            : 'This movement looks strong — keep building.'}
                        </div>
                      </>
                    )}
                    {!latest && (
                      <div style={{ fontSize: 12, color: C.muted }}>Upload a ride to see metric breakdown.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Collective Marks ────────────────────────────────────── */}
        <SecHdr>Collective Marks</SecHdr>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {COLLECTIVE_MARKS.map(cm => {
            const hasMetrics = cm.metrics.length > 0 && !cm.note;
            const score = hasMetrics && latest
              ? Math.min(10, Math.round((cm.metrics.reduce((s, k) => s + getMetricScore(latest, k), 0) / cm.metrics.length) * 10 * 10) / 10)
              : null;

            return (
              <div key={cm.label} style={{ ...card({ padding: '14px 16px' }) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif" }}>
                      {cm.label}
                    </span>
                    {cm.coeff && (
                      <span style={{
                        marginLeft: 8, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                        background: `${C.cg}14`, color: C.cg,
                      }}>×{cm.coeff}</span>
                    )}
                  </div>
                  {score !== null && (
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: C.nk }}>
                      {score.toFixed(1)}<span style={{ fontSize: 9, color: C.muted }}>/10</span>
                    </span>
                  )}
                  {score === null && !cm.note && (
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: '#ccc' }}>–</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: hasMetrics && score !== null ? 8 : 0 }}>
                  {cm.sub}
                </div>
                {hasMetrics && score !== null && (
                  <div style={{ height: 4, borderRadius: 2, background: '#EDE7DF' }}>
                    <div style={{ width: `${score * 10}%`, height: '100%', borderRadius: 2, background: scoreColor(score), transition: 'width 0.6s ease' }} />
                  </div>
                )}
                {cm.note && (
                  <div style={{ fontSize: 11, color: C.cg, fontStyle: 'italic', marginTop: 4 }}>
                    {cm.note}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Level Progression Path ─────────────────────────────── */}
        <SecHdr>Progression</SecHdr>
        <div style={{ marginBottom: 24 }}>
          {journeyNodes.map((node, i) => {
            const isLast = i === journeyNodes.length - 1;
            const isActive = node.state === 'active';
            const isFar = node.state === 'far';
            const nodeColor = isActive ? C.ch : isFar ? '#D4C9BC' : '#C4B8AC';
            const nodeSize = isActive ? 16 : isFar ? 8 : 10;
            const labelColor = isActive ? C.cg : isFar ? '#C4B8AC' : '#B5A898';

            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, opacity: isFar ? 0.45 : 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isActive && (
                      <div style={{
                        position: 'absolute', width: nodeSize + 10, height: nodeSize + 10,
                        borderRadius: '50%', border: '1.5px solid rgba(201,169,110,0.4)',
                        animation: 'jPulse 2.4s ease-out infinite',
                      }} />
                    )}
                    <div style={{
                      width: nodeSize, height: nodeSize, borderRadius: '50%',
                      background: isActive ? `linear-gradient(135deg, #E2C384, ${C.ch})` : 'transparent',
                      border: `2px solid ${nodeColor}`, flexShrink: 0,
                      boxShadow: isActive ? '0 0 12px rgba(201,169,110,0.35)' : 'none',
                    }} />
                  </div>
                  {!isLast && (
                    <div style={{
                      width: 2, height: 36, marginTop: 4,
                      background: `linear-gradient(180deg, rgba(201,169,110,0.2) 0%, transparent 100%)`,
                      borderRadius: 1,
                    }} />
                  )}
                </div>
                <div style={{ paddingBottom: isLast ? 0 : 24 }}>
                  <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, color: labelColor, fontFamily: "'DM Sans', sans-serif" }}>
                    {node.label}
                    {isActive && (
                      <span style={{
                        marginLeft: 8, fontSize: 10, color: C.ch,
                        background: 'rgba(201,169,110,0.12)', padding: '1px 7px',
                        borderRadius: 10, fontWeight: 600,
                      }}>Now · Test A</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: isFar ? '#C4B8AC' : '#B5A898', lineHeight: 1.4 }}>
                    {node.sublabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Test Simulation CTA ────────────────────────────────── */}
        <div style={{ ...card({ background: C.na, padding: 20 }) }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: C.cg, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M7 4L15 10L7 16V4Z" fill="#fff" />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: '#fff', marginBottom: 6 }}>
                Run the Test
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'rgba(212,175,118,0.75)', lineHeight: 1.6, margin: 0 }}>
                Ride through the Intro A movements and get a predicted judge's score for each.
              </p>
              <span style={{
                display: 'inline-block', marginTop: 10,
                fontSize: 9, fontWeight: 600, padding: '3px 10px', borderRadius: 8,
                background: C.ch, color: C.nk,
              }}>Coming soon</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
