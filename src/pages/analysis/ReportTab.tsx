import { useNavigate } from 'react-router-dom';

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

// ── Compensation chain data ─────────────────────────────────────────────────
const CHAIN = [
  {
    num: 1, color: C.focus, sublabel: 'Biomechanics · Root cause',
    title: 'Lower leg bracing',
    metrics: 'Rein Steadiness: 0.12 · Lower Leg Stability: 0.11',
    desc: 'The lower leg is pushing forward and bracing against the stirrup, creating a fixed base that propagates tension upward through the kinetic chain.',
    tags: [
      { label: 'Contact ↓',    color: C.focus },
      { label: 'Relaxation ↓', color: C.focus },
    ],
  },
  {
    num: 2, color: C.good, sublabel: 'Consequence',
    title: 'Rein tension compensation',
    metrics: 'Rein Symmetry: 88 · Elbow Mean: 142°',
    desc: 'To maintain balance with the braced leg, the arms are compensating with uneven rein contact — right rein 5° higher than left.',
    tags: [
      { label: 'Straightness ↓',   color: C.focus },
      { label: 'Balance — held',    color: C.good  },
    ],
  },
  {
    num: 3, color: C.ch, sublabel: 'Downstream',
    title: 'Rhythm disruption',
    metrics: 'Trunk Angle Std: 3.2° · APS Score: 78',
    desc: "The combined tension creates micro-variations in trunk angle that interrupt the horse's rhythm cycle, showing up as slight irregularity in the trot.",
    tags: [
      { label: 'Rhythm ↓',    color: C.focus },
      { label: 'Impulsion ↓', color: C.good  },
    ],
  },
];

// ── Section label component ────────────────────────────────────────────────
function SecLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '2px',
      textTransform: 'uppercase', color: C.cg, marginBottom: 14,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {children}
      <span style={{ flex: 1, height: 1, background: 'rgba(193,127,74,0.2)' }}/>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ReportTab() {
  const navigate = useNavigate();

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
            Allegra · March 16
          </div>
          <div style={{ fontSize: 10, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'rgba(28,28,30,0.38)', marginTop: 1 }}>
            Ride Score 74 · ↑ +3 from last ride
          </div>
        </div>
        <button
          onClick={() => navigate('/analysis')}
          style={{
            fontSize: 11, color: C.cg, background: 'none',
            border: '1px solid rgba(193,127,74,0.4)', borderRadius: 12,
            padding: '5px 12px', cursor: 'pointer',
            fontFamily: "'Inter', sans-serif", fontWeight: 500,
          }}
        >
          ← Video
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          ① CADENCE DEBRIEF
      ──────────────────────────────────────────────────────────────────── */}
      <div style={{ padding: '28px 22px', borderBottom: '0.5px solid rgba(28,28,30,0.07)' }}>
        <SecLabel>① Cadence Debrief</SecLabel>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          {/* Cognac circle with C */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%', background: C.cg,
            color: '#fff', fontFamily: "'Playfair Display', serif",
            fontSize: 24, fontWeight: 700, fontStyle: 'italic',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px',
          }}>
            C
          </div>

          {/* Italic paragraph */}
          <p style={{
            fontFamily: "'Playfair Display', serif", fontStyle: 'italic',
            fontSize: 14, color: C.na, lineHeight: 1.92, marginBottom: 20,
          }}>
            Today's ride showed real strength in your core engagement — that's new. The compensation pattern
            through your lower leg is still present but it's shifting from a brace into a swing, which tells me
            you're beginning to release. Focus on your right rein contact in the next session.
          </p>

          {/* Stat chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
            <span style={{ fontSize: 11, fontWeight: 500, padding: '5px 13px', borderRadius: 6, background: C.ch, color: '#fff' }}>
              🏆 PB Core 92
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, padding: '5px 13px', borderRadius: 6, background: 'rgba(91,158,86,0.18)', color: '#2A5228' }}>
              ↑ Shoulder +4
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, padding: '5px 13px', borderRadius: 6, background: 'rgba(232,168,87,0.2)', color: '#7A5814' }}>
              ⚠ Leg 71
            </span>
          </div>

          {/* Ask Cadence input */}
          <input
            type="text"
            placeholder="Ask Cadence…"
            style={{
              width: '100%', height: 42,
              border: '1px solid rgba(193,127,74,0.5)', borderRadius: 21,
              padding: '0 18px', fontSize: 12.5,
              fontFamily: "'Inter', sans-serif", color: '#aaa',
              background: 'rgba(255,255,255,0.6)', outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = C.ch; e.currentTarget.style.color = C.nk; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(193,127,74,0.5)'; e.currentTarget.style.color = '#aaa'; }}
          />
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          ② BEST & WORST FRAMES
      ──────────────────────────────────────────────────────────────────── */}
      <div style={{ padding: '28px 22px', borderBottom: '0.5px solid rgba(28,28,30,0.07)' }}>
        <SecLabel>② Best &amp; Worst Frames</SecLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Best moment 2:18 */}
          <div style={{ borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
            <div style={{ position: 'relative', aspectRatio: '16/9', background: '#0A0608' }}>
              {/* Mini skeleton — all green */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }} viewBox="0 0 400 225">
                <line x1="230" y1="38"  x2="228" y2="68"  stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="228" y1="68"  x2="226" y2="118" stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="228" y1="68"  x2="238" y2="90"  stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="238" y1="90"  x2="253" y2="100" stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="226" y1="118" x2="210" y2="158" stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="210" y1="158" x2="200" y2="193" stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <circle cx="228" cy="68"  r="3.5" fill="#fff"/>
                <circle cx="226" cy="118" r="3.5" fill="#fff"/>
                <circle cx="253" cy="100" r="3.5" fill="#fff"/>
                <circle cx="210" cy="158" r="3.5" fill="#fff"/>
              </svg>
              <div style={{
                position: 'absolute', top: 7, right: 9,
                background: 'rgba(0,0,0,0.62)', color: 'rgba(255,255,255,0.7)',
                fontSize: 9.5, fontWeight: 500, padding: '2px 7px', borderRadius: 6,
              }}>2:18</div>
            </div>
            <div style={{ padding: '9px 13px', fontSize: 11.5, fontWeight: 600, color: C.ideal, background: 'rgba(91,158,86,0.08)' }}>
              ✦ Best moment
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 13px 10px' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', background: C.na, color: '#fff',
                fontSize: 10, fontWeight: 500, borderRadius: 10,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.ideal, flexShrink: 0 }}/>
                All joints on target
              </span>
            </div>
            <button
              onClick={() => navigate('/analysis?t=48')}
              style={{
                display: 'block', padding: '9px 13px', fontSize: 11, color: C.cg,
                fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
                fontFamily: "'Inter', sans-serif", width: '100%', textAlign: 'left',
                borderTop: '0.5px solid rgba(28,28,30,0.07)',
              }}
            >
              Watch in playback →
            </button>
          </div>

          {/* Focus moment 1:24 */}
          <div style={{ borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
            <div style={{ position: 'relative', aspectRatio: '16/9', background: '#0A0608' }}>
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }} viewBox="0 0 400 225">
                <line x1="230" y1="38"  x2="228" y2="68"  stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="228" y1="68"  x2="236" y2="118" stroke={C.good}  strokeWidth="3" strokeLinecap="round"/>
                <line x1="228" y1="68"  x2="242" y2="90"  stroke={C.ideal} strokeWidth="3" strokeLinecap="round"/>
                <line x1="242" y1="90"  x2="270" y2="104" stroke={C.focus} strokeWidth="3" strokeLinecap="round"/>
                <line x1="236" y1="118" x2="226" y2="158" stroke={C.good}  strokeWidth="3" strokeLinecap="round"/>
                <line x1="226" y1="158" x2="222" y2="193" stroke={C.good}  strokeWidth="3" strokeLinecap="round"/>
                <circle cx="270" cy="104" r="3.5" fill="#fff"/>
              </svg>
              <div style={{
                position: 'absolute', top: 7, right: 9,
                background: 'rgba(0,0,0,0.62)', color: 'rgba(255,255,255,0.7)',
                fontSize: 9.5, fontWeight: 500, padding: '2px 7px', borderRadius: 6,
              }}>1:24</div>
            </div>
            <div style={{ padding: '9px 13px', fontSize: 11.5, fontWeight: 600, color: C.focus, background: 'rgba(193,74,42,0.07)' }}>
              ◎ Focus moment
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 13px 10px' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', background: C.na, color: '#fff',
                fontSize: 10, fontWeight: 500, borderRadius: 10,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.focus, flexShrink: 0 }}/>
                Rein +5° asymmetry
              </span>
            </div>
            <button
              onClick={() => navigate('/analysis?t=29')}
              style={{
                display: 'block', padding: '9px 13px', fontSize: 11, color: C.cg,
                fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
                fontFamily: "'Inter', sans-serif", width: '100%', textAlign: 'left',
                borderTop: '0.5px solid rgba(28,28,30,0.07)',
              }}
            >
              Watch in playback →
            </button>
          </div>

        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          ③ COMPENSATION CHAIN
      ──────────────────────────────────────────────────────────────────── */}
      <div style={{ padding: '28px 22px' }}>
        <SecLabel>③ Compensation Chain</SecLabel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {CHAIN.map((layer, i) => (
            <div key={layer.num}>
              {/* Layer row */}
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                {/* Number column */}
                <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: layer.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 700, color: '#fff',
                    flexShrink: 0,
                  }}>
                    {layer.num}
                  </div>
                  {i < CHAIN.length - 1 && (
                    <div style={{ width: 2, flex: 1, background: 'rgba(28,28,30,0.1)', margin: '4px 0' }}/>
                  )}
                </div>

                {/* Body */}
                <div style={{
                  flex: 1, padding: '14px 0 14px 0',
                  borderBottom: i < CHAIN.length - 1 ? '0.5px solid rgba(28,28,30,0.06)' : 'none',
                }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'rgba(28,28,30,0.35)', marginBottom: 5 }}>
                    {layer.sublabel}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.nk, marginBottom: 4 }}>
                    {layer.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'rgba(28,28,30,0.5)', marginBottom: 8, lineHeight: 1.5 }}>
                    {layer.metrics}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(28,28,30,0.44)', lineHeight: 1.55, marginBottom: 10 }}>
                    {layer.desc}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {layer.tags.map((tag) => (
                      <span
                        key={tag.label}
                        style={{
                          fontSize: 10, fontWeight: 500, padding: '3px 10px',
                          borderRadius: 12,
                          border: `1px solid ${tag.color}40`,
                          color: tag.color,
                          background: `${tag.color}10`,
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8">
                          <circle cx="4" cy="4" r="3.5" fill={tag.color}/>
                        </svg>
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Connector between layers */}
              {i < CHAIN.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 0 27px', padding: '6px 0' }}>
                  <div style={{ width: 2, height: 22, background: 'rgba(28,28,30,0.1)' }}/>
                  <span style={{ color: 'rgba(28,28,30,0.28)', fontSize: 10, marginLeft: 6 }}>propagates to →</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Cadence insight box */}
        <div style={{
          borderLeft: `3px solid ${C.cg}`,
          background: `rgba(44,62,80,0.04)`,
          border: '1px solid rgba(44,62,80,0.12)',
          borderRadius: 10,
          padding: '14px 16px',
          marginTop: 18,
        }}>
          <div style={{
            fontSize: 9.5, fontWeight: 600, letterSpacing: '1.3px',
            textTransform: 'uppercase' as const, color: C.cg, marginBottom: 8,
            fontVariant: 'small-caps',
          }}>
            Cadence Insight
          </div>
          <p style={{
            fontFamily: "'Playfair Display', serif", fontStyle: 'italic',
            fontSize: 13, color: C.na, lineHeight: 1.82, margin: 0,
          }}>
            Your lower leg is the key. When you soften that brace, the rein tension resolves naturally and
            the rhythm follows — you don't need to fix three things, just one.
          </p>
        </div>
      </div>

    </div>
  );
}
