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
};

// ── Biomechanics trend data ────────────────────────────────────────────────
const BIO_TRENDS = [
  { label: 'Core',      scores: [72,75,78,80,82,85,88,92], color: C.ideal, trend: '+8%',  dir: 'up'   },
  { label: 'Lower Leg', scores: [80,78,75,72,70,72,71,71], color: C.focus, trend: '-5%',  dir: 'down' },
  { label: 'Reins',     scores: [82,83,84,85,86,87,88,88], color: C.good,  trend: '+3%',  dir: 'up'   },
  { label: 'Pelvis',    scores: [75,76,78,79,80,81,82,83], color: C.good,  trend: '+4%',  dir: 'up'   },
  { label: 'Shoulder',  scores: [88,89,90,91,92,93,93,94], color: C.ideal, trend: '+2%',  dir: 'up'   },
];

// ── Riding Quality data ────────────────────────────────────────────────────
const RQ = [
  { label: 'Rhythm',       stage: 'Developing',   pct: 62, note: 'Trunk angle variance limiting cycle' },
  { label: 'Relaxation',   stage: 'Inconsistent', pct: 44, note: 'Lower leg brace → tension transfer'  },
  { label: 'Contact',      stage: 'Developing',   pct: 68, note: 'Right rein 5° higher than left'      },
  { label: 'Straightness', stage: 'Emerging',     pct: 38, note: 'Rein asymmetry → lateral drift'      },
  { label: 'Balance',      stage: 'Consistent',   pct: 78, note: 'Core holding despite leg brace'      },
  { label: 'Impulsion',    stage: 'Developing',   pct: 65, note: 'Rhythm disruption dampening push'    },
];

const STAGE_STYLES: Record<string, { bg: string; color: string }> = {
  Emerging:     { bg: C.focus,           color: '#fff'   },
  Inconsistent: { bg: C.good,            color: C.nk     },
  Developing:   { bg: C.ch,              color: C.nk     },
  Consistent:   { bg: C.ideal,           color: '#fff'   },
  Mastering:    { bg: C.na,              color: '#fff'   },
};

// ── Chart data (8 sessions) ────────────────────────────────────────────────
const SCORES   = [68, 71, 70, 73, 75, 74, 77, 78];
const X_LABELS = ['Jan 18','Jan 25','Feb 1','Feb 8','Feb 15','Feb 22','Mar 1','Mar 8'];

// Map score (60–100 range) to SVG y (top=20, bottom=150)
function sy(score: number) {
  return 20 + (100 - score) / 40 * 130;
}
// Map index to x
function sx(i: number, n = 8, w = 280) {
  return 30 + (i / (n - 1)) * (w - 40);
}

const polyPts = SCORES.map((s, i) => `${sx(i)},${sy(s)}`).join(' ');
const areaPath = `M${sx(0)},${sy(SCORES[0])} ` +
  SCORES.map((s, i) => `L${sx(i)},${sy(s)}`).join(' ') +
  ` L${sx(SCORES.length - 1)},150 L${sx(0)},150 Z`;

// Trend line (first to last)
const trendX1 = sx(0);
const trendY1 = sy(SCORES[0]);
const trendX2 = sx(SCORES.length - 1);
const trendY2 = sy(SCORES[SCORES.length - 1]);

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

// ── Mini bar color by score ────────────────────────────────────────────────
function barColor(s: number, themeColor: string) {
  if (themeColor === C.focus) {
    // Lower leg — lower = worse
    if (s >= 80) return C.ideal;
    if (s >= 70) return C.good;
    return C.focus;
  }
  if (s >= 85) return C.ideal;
  if (s >= 72) return C.good;
  return C.focus;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function InsightsTab() {
  return (
    <div style={{ background: C.pa, paddingBottom: 100 }}>

      {/* ── Ride header ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', background: '#fff',
        borderBottom: '0.5px solid rgba(28,28,30,0.08)',
      }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 600, color: C.ch }}>
            Your Progress
          </div>
          <div style={{ fontSize: 10, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'rgba(28,28,30,0.38)', marginTop: 1 }}>
            Last 8 rides · Jan 18 – Mar 8
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 600, color: C.cg }}>78</div>
          <div style={{ fontSize: 9.5, color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase' }}>Latest</div>
        </div>
      </div>

      <div style={{ padding: '20px 18px 28px' }}>

        {/* ────────────────────────────────────────────────────────────────
            CARD 1 — Cadence Pattern Insight
        ──────────────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Cadence · Pattern insight</SecHdr>
          <div style={{
            background: '#fff', borderRadius: 12, padding: '18px 20px',
            borderLeft: `3px solid ${C.cg}`,
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '1.3px',
              textTransform: 'uppercase', color: C.cg, marginBottom: 9,
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: C.good, flexShrink: 0,
                animation: 'cadPulse 2.4s ease-in-out infinite',
              }}/>
              8 rides · Jan–Mar 2026
            </div>
            <p style={{
              fontFamily: "'Playfair Display', serif", fontStyle: 'italic',
              fontSize: 13.5, color: C.na, lineHeight: 1.88, margin: 0,
            }}>
              Across your last 8 rides, a consistent pattern is emerging: your core strength has improved 12%
              since January, but your lower leg brace activates most strongly when working on right rein.
              This compensation is masking real progress — your intrinsic balance is building even as the surface
              score stays flat. The next breakthrough will come from addressing the brace directly.
            </p>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────────
            CARD 2 — Ride Score Chart
        ──────────────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Ride score</SecHdr>
          <div style={{ background: '#fff', borderRadius: 12, padding: '17px 19px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.nk }}>Score over 8 sessions</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 9,
                background: 'rgba(193,127,74,0.11)', color: C.cg,
              }}>↑ +10 pts total</span>
            </div>

            <svg viewBox="0 0 280 170" style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={C.cg} stopOpacity="0.15"/>
                  <stop offset="100%" stopColor={C.cg} stopOpacity="0"/>
                </linearGradient>
              </defs>

              {/* Grid lines */}
              {[60, 70, 80].map(v => (
                <line key={v} x1="30" y1={sy(v)} x2="270" y2={sy(v)}
                  stroke="rgba(0,0,0,0.06)" strokeDasharray="4,4"/>
              ))}
              {[60, 70, 80].map(v => (
                <text key={v} x="26" y={sy(v) + 3} textAnchor="end"
                  fontSize="8" fill="#ccc" fontFamily="Inter,sans-serif">{v}</text>
              ))}

              {/* Area fill */}
              <path d={areaPath} fill="url(#areaGrad)"/>

              {/* Dashed trend line */}
              <line x1={trendX1} y1={trendY1} x2={trendX2} y2={trendY2}
                stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeDasharray="5,4"/>

              {/* Polyline */}
              <polyline points={polyPts} fill="none" stroke={C.cg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>

              {/* Data points */}
              {SCORES.map((s, i) => {
                const last = i === SCORES.length - 1;
                return (
                  <g key={i}>
                    {last
                      ? <circle cx={sx(i)} cy={sy(s)} r="7" fill={C.cg} stroke="#fff" strokeWidth="2"/>
                      : <circle cx={sx(i)} cy={sy(s)} r="4" fill="#fff" stroke={C.cg} strokeWidth="1.5"/>
                    }
                    {last && (
                      <text x={sx(i)} y={sy(s) - 12} textAnchor="middle"
                        fontSize="12" fontWeight="700" fill={C.cg}
                        fontFamily="'Playfair Display',serif">{s}</text>
                    )}
                  </g>
                );
              })}

              {/* "+1 pt / session" badge */}
              <rect x="190" y="8" width="80" height="18" rx="9" fill="rgba(91,158,86,0.15)"/>
              <text x="230" y="21" textAnchor="middle" fontSize="9" fontWeight="600" fill={C.ideal}
                fontFamily="Inter,sans-serif">+1 pt / session</text>

              {/* X-axis labels — every other one to avoid crowding */}
              {X_LABELS.map((lbl, i) => {
                if (i % 2 !== 0 && i !== X_LABELS.length - 1) return null;
                const last = i === X_LABELS.length - 1;
                return (
                  <text key={i} x={sx(i)} y="165" textAnchor="middle"
                    fontSize="7" fill={last ? C.cg : '#bbb'}
                    fontFamily="Inter,sans-serif"
                    fontWeight={last ? '600' : '400'}>{lbl}</text>
                );
              })}
            </svg>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────────
            CARD 3 — Biomechanics Trends (horizontal scroll)
        ──────────────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Biomechanics trends</SecHdr>
          <div
            style={{
              display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8,
              WebkitOverflowScrolling: 'touch',
            } as React.CSSProperties}
          >
            {BIO_TRENDS.map(m => {
              const cur = m.scores[m.scores.length - 1];
              const maxS = Math.max(...m.scores);
              return (
                <div key={m.label} style={{
                  flexShrink: 0, width: 130, background: '#fff',
                  borderRadius: 10, padding: '12px 12px 10px',
                  boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', color: C.na, marginBottom: 8 }}>
                    {m.label}
                  </div>
                  {/* Mini bar chart */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28, marginBottom: 8 }}>
                    {m.scores.map((s, i) => (
                      <div key={i} style={{
                        flex: 1, borderRadius: 2,
                        background: barColor(s, m.color),
                        height: `${(s / maxS) * 100}%`,
                      }}/>
                    ))}
                  </div>
                  {/* Current score */}
                  <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Inter', sans-serif", color: C.nk, lineHeight: 1 }}>
                    {cur}
                  </div>
                  {/* Trend */}
                  <div style={{
                    fontSize: 11, fontWeight: 500, marginTop: 4,
                    color: m.dir === 'up' ? C.ideal : C.focus,
                  }}>
                    {m.dir === 'up' ? '↑' : '↓'} {m.trend}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────────
            CARD 4 — Riding Quality Assessment
        ──────────────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>
          <SecHdr>Riding Quality</SecHdr>
          <p style={{ fontSize: 12, color: 'rgba(28,28,30,0.45)', marginBottom: 14, lineHeight: 1.6 }}>
            How your riding looks from the outside — the dimensions a judge or trainer evaluates.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {RQ.map(rq => {
              const st = STAGE_STYLES[rq.stage] ?? STAGE_STYLES.Developing;
              return (
                <div key={rq.label} style={{
                  background: '#fff', borderRadius: 10, padding: '13px 14px',
                  boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.na, marginBottom: 5 }}>
                    {rq.label}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 500, letterSpacing: '0.5px',
                    padding: '3px 9px', borderRadius: 8,
                    background: st.bg, color: st.color,
                    display: 'inline-block', marginBottom: 8,
                  }}>
                    {rq.stage}
                  </span>
                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(28,28,30,0.09)' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: st.bg, width: `${rq.pct}%` }}/>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(28,28,30,0.42)', marginTop: 6, lineHeight: 1.5 }}>
                    {rq.note}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────────
            CARD 5 — Progression Signal
        ──────────────────────────────────────────────────────────────── */}
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
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: '#fff', fontFamily: "'Inter', sans-serif" }}>68%</span>
              <span style={{ fontSize: 13, color: C.ch }}>of milestone tasks at Consistent or above</span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.13)', marginBottom: 16 }}>
              <div style={{
                height: '100%', borderRadius: 3, width: '68%',
                background: `linear-gradient(to right, ${C.cg}, ${C.ch})`,
              }}/>
            </div>
            <p style={{
              fontFamily: "'Playfair Display', serif", fontStyle: 'italic',
              fontSize: 13, color: `rgba(212,175,118,0.82)`, lineHeight: 1.78, margin: 0,
            }}>
              Relaxation and Straightness are the remaining barriers to Training Level. Once your lower leg
              releases, both will follow naturally.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
