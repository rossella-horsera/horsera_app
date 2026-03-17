import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

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

// ── Joint data ─────────────────────────────────────────────────────────────
const JOINTS = [
  { id: 'rein',     label: 'Rein Symmetry',     x: 52, y: 38, color: C.good,  you: '88',  ideal: '100', unit: 'score', trend: 'up',   pulse: true  },
  { id: 'core',     label: 'Core Stability',     x: 50, y: 55, color: C.ideal, you: '92',  ideal: '100', unit: 'score', trend: 'up',   pulse: false },
  { id: 'leg',      label: 'Lower Leg',          x: 48, y: 72, color: C.focus, you: '71',  ideal: '100', unit: 'score', trend: 'down', pulse: false },
  { id: 'pelvis',   label: 'Pelvis Stability',   x: 50, y: 62, color: C.good,  you: '+2°', ideal: '0°',  unit: 'angle', trend: 'up',   pulse: false },
  { id: 'shoulder', label: 'Shoulder Levelness', x: 50, y: 32, color: C.ideal, you: '94',  ideal: '100', unit: 'score', trend: 'up',   pulse: false },
];

// ── Flag markers ────────────────────────────────────────────────────────────
const FLAGS = [
  { pct: 15, color: C.ideal, label: '✓ Best posture' },
  { pct: 38, color: C.focus, label: '⚠ Rein +5°'     },
  { pct: 62, color: C.good,  label: '⚠ Leg drift'    },
  { pct: 85, color: C.good,  label: '⚠ Core tension' },
];

// ── Sparkline data ──────────────────────────────────────────────────────────
const SPARKS = [
  { name: 'Core',     color: C.ideal, pts: 'M0,21 10,19 20,16 30,17 40,14 50,15 60,13 70,14 80,13' },
  { name: 'Leg',      color: C.focus, pts: 'M0,23 10,21 20,17 30,12 40,9 50,7 60,7 70,6 80,5' },
  { name: 'Reins',    color: C.good,  pts: 'M0,10 10,13 20,9 30,17 40,19 50,15 60,21 70,17 80,18' },
  { name: 'Pelvis',   color: C.good,  pts: 'M0,19 10,17 20,13 30,10 40,8 50,6 60,6 70,4 80,4' },
  { name: 'Shoulder', color: C.ideal, pts: 'M0,15 10,15 20,14 30,15 40,13 50,15 60,13 70,14 80,13' },
];

// ── Keyframes injected once ─────────────────────────────────────────────────
const STYLE_ID = 'ride-tab-styles';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes pulseRing {
      0%   { transform: scale(1);   opacity: 1; }
      100% { transform: scale(1.8); opacity: 0; }
    }
    @keyframes cadPulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.28; }
    }
  `;
  document.head.appendChild(el);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(pct: number, total = 272 /* 4:32 */) {
  const s = Math.round((pct / 100) * total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function RideTab() {
  const [searchParams] = useSearchParams();
  const initT = Number(searchParams.get('t') ?? 0);
  const [scrub,       setScrub]       = useState<number>(initT);
  const [playing,     setPlaying]     = useState(false);
  const [ghost,       setGhost]       = useState(false);
  const [activeJoint, setActiveJoint] = useState<string | null>(null);
  const [hoveredFlag, setHoveredFlag] = useState<number | null>(null);
  const pillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef    = useRef<number | null>(null);
  const lastTRef  = useRef<number | null>(null);

  useEffect(() => { ensureStyles(); }, []);

  // Update scrub from URL param on navigation back
  useEffect(() => {
    const t = Number(searchParams.get('t') ?? 0);
    if (t > 0) setScrub(t);
  }, [searchParams]);

  // Auto-dismiss pill after 4 s
  useEffect(() => {
    if (activeJoint) {
      if (pillTimer.current) clearTimeout(pillTimer.current);
      pillTimer.current = setTimeout(() => setActiveJoint(null), 4000);
    }
    return () => { if (pillTimer.current) clearTimeout(pillTimer.current); };
  }, [activeJoint]);

  // Playback animation
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTRef.current = null;
      return;
    }
    const tick = (t: number) => {
      if (!lastTRef.current) lastTRef.current = t;
      const delta = t - lastTRef.current;
      lastTRef.current = t;
      setScrub(prev => {
        const next = prev + (delta / 1000) * (100 / 272);
        if (next >= 100) { setPlaying(false); return 100; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing]);

  const joint = JOINTS.find(j => j.id === activeJoint) ?? null;

  // ── Pill position (clamped) ────────────────────────────────────────────────
  const pillLeft = joint ? Math.min(joint.x, 55) : 0;
  const pillTop  = joint ? joint.y : 0;

  return (
    <div style={{ background: C.pa }}>

      {/* ── Ride header ─────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '10px 18px',
        background:     '#fff',
        borderBottom:   '0.5px solid rgba(28,28,30,0.08)',
      }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 600, color: C.ch }}>
            Allegra · Dressage
          </div>
          <div style={{ fontSize: 10, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'rgba(28,28,30,0.38)', marginTop: 1 }}>
            March 16 · 4:32 min · Analysed
          </div>
        </div>
        <svg width="46" height="46" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="18" fill="none" stroke="rgba(193,127,74,0.15)" strokeWidth="3"/>
          <circle cx="23" cy="23" r="18" fill="none" stroke={C.cg} strokeWidth="3"
            strokeDasharray="84.8 113.1" strokeLinecap="round"
            transform="rotate(-90 23 23)"/>
          <text x="23" y="27.5" textAnchor="middle" fill={C.ch}
            fontFamily="'Playfair Display',serif" fontSize="12" fontWeight="600">74</text>
        </svg>
      </div>

      {/* ── Video area ──────────────────────────────────────────────────── */}
      <div
        style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#07000A', overflow: 'hidden' }}
        onClick={() => setActiveJoint(null)}
      >

        {/* Color legend strip */}
        <div style={{
          position: 'absolute', top: 11, left: 13, zIndex: 5,
          background: 'rgba(7,0,10,0.8)', borderRadius: 22, padding: '5px 14px',
          display: 'flex', gap: 14, fontSize: 10, fontWeight: 500,
          pointerEvents: 'none',
        }}>
          {[
            { color: C.ideal, label: 'On target' },
            { color: C.good,  label: 'Working'   },
            { color: C.focus, label: 'Needs focus'},
          ].map(d => (
            <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, display: 'inline-block' }}/>
              <span style={{ color: 'rgba(255,255,255,0.78)' }}>{d.label}</span>
            </span>
          ))}
        </div>

        {/* Ghost Rider toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setGhost(g => !g); }}
          style={{
            position: 'absolute', bottom: 52, left: 13, zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 7,
            background: ghost ? 'rgba(170,205,240,0.15)' : 'rgba(7,0,10,0.7)',
            border: `1px solid ${ghost ? 'rgba(170,205,240,0.6)' : 'rgba(255,255,255,0.18)'}`,
            borderRadius: 22, padding: '5px 13px 5px 9px',
            color: ghost ? 'rgba(200,225,250,0.9)' : 'rgba(255,255,255,0.45)',
            fontSize: 10.5, fontWeight: 500, letterSpacing: '0.3px',
            cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3,2.2"/>
            <circle cx="6" cy="6" r="1.6" fill="currentColor"/>
          </svg>
          {ghost ? 'Ghost On ✓' : 'Ghost Rider'}
        </button>

        {/* Skeleton SVG */}
        <svg
          viewBox="0 0 800 450"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
        >
          {/* Ghost layer */}
          {ghost && (
            <g style={{ animation: 'ghostIn .25s ease' }}>
              {[
                [458,76,452,138],[452,138,449,238],[452,138,475,182],
                [475,182,508,202],[449,238,420,316],[420,316,400,384],[400,384,390,400],
              ].map(([x1,y1,x2,y2],i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(180,215,250,.6)" strokeWidth="2.5"
                  strokeDasharray="7,4" strokeLinecap="round"/>
              ))}
              {/* +3° gap annotation */}
              <path d="M449,224 Q455,211 464,224" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="1.5"/>
              <rect x="466" y="211" width="28" height="15" rx="7.5" fill="rgba(255,255,255,.95)"/>
              <text x="480" y="222" textAnchor="middle" fill={C.nk}
                fontFamily="Inter,sans-serif" fontSize="8.5" fontWeight="700">+3°</text>
            </g>
          )}

          {/* Aura skeleton segments */}
          <line x1="462" y1="76"  x2="456" y2="138" stroke={C.ideal} strokeWidth="4" strokeLinecap="round"/>
          <line x1="456" y1="138" x2="453" y2="242" stroke={C.good}  strokeWidth="4" strokeLinecap="round"/>
          <line x1="456" y1="138" x2="479" y2="184" stroke={C.ideal} strokeWidth="4" strokeLinecap="round"/>
          <line x1="479" y1="184" x2="514" y2="206" stroke={C.focus} strokeWidth="4" strokeLinecap="round"/>
          <line x1="453" y1="242" x2="424" y2="320" stroke={C.good}  strokeWidth="4" strokeLinecap="round"/>
          <line x1="424" y1="320" x2="404" y2="388" stroke={C.good}  strokeWidth="4" strokeLinecap="round"/>
          <line x1="404" y1="388" x2="394" y2="402" stroke={C.ideal} strokeWidth="4" strokeLinecap="round"/>

          {/* Joint circles — mapped to JOINTS data */}
          {/* Map joints from % to viewBox coords */}
          {JOINTS.map((j) => {
            const cx = j.x / 100 * 800;
            const cy = j.y / 100 * 450;
            return (
              <g key={j.id} style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setActiveJoint(j.id); }}>
                <circle cx={cx} cy={cy} r="8" fill="none" stroke={j.color} strokeWidth="1.5" opacity=".5"/>
                <circle cx={cx} cy={cy} r="4.5" fill="#fff"/>
                {j.pulse && (
                  <circle cx={cx} cy={cy} r="13" fill="none" stroke={j.color} strokeWidth="1" opacity=".35"
                    style={{ animation: 'pulseRing 2s ease-out infinite', transformOrigin: `${cx}px ${cy}px` }}/>
                )}
                {/* Always-pulse for rein (terracotta) */}
                {j.id === 'rein' && (
                  <circle cx={cx} cy={cy} r="13" fill="none" stroke={j.color} strokeWidth="1" opacity=".35"
                    style={{ animation: 'pulseRing 1.8s ease-out infinite', transformOrigin: `${cx}px ${cy}px` }}/>
                )}
              </g>
            );
          })}
        </svg>

        {/* Metric pill popup */}
        {activeJoint && joint && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position:     'absolute',
              left:         `${pillLeft}%`,
              top:          `${pillTop}%`,
              transform:    'translateY(-112%)',
              background:   '#fff',
              borderRadius: 10,
              padding:      '10px 14px',
              minWidth:     156,
              zIndex:       20,
              boxShadow:    '0 4px 18px rgba(0,0,0,0.16)',
              borderTop:    `3px solid ${joint.color}`,
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(28,28,30,0.36)', marginBottom: 4 }}>
              {joint.label}
            </div>
            {/* You / Ideal row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 9, color: 'rgba(28,28,30,0.4)', marginBottom: 1 }}>You</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.nk, lineHeight: 1 }}>{joint.you}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'rgba(28,28,30,0.4)', marginBottom: 1 }}>Ideal</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.nk, lineHeight: 1 }}>{joint.ideal}</div>
              </div>
            </div>
            {/* Bar */}
            {joint.unit === 'score' && (
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(28,28,30,0.1)', marginBottom: 5 }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: joint.color,
                  width: `${Number(joint.you)}%`,
                }}/>
              </div>
            )}
            {/* Trend */}
            <div style={{
              fontSize: 11, fontWeight: 500,
              color: joint.trend === 'up' ? C.ideal : C.focus,
            }}>
              {joint.trend === 'up' ? '↑ Improving' : '↓ Focus area'}
            </div>
            {/* Arrow */}
            <div style={{
              position: 'absolute', bottom: -6, left: 14,
              width: 0, height: 0,
              borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
              borderTop: '6px solid #fff',
            }}/>
          </div>
        )}

        {/* Playback controls bar */}
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 44,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center',
            padding: '0 13px', gap: 10, zIndex: 6,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setPlaying(p => !p)}
            style={{
              width: 27, height: 27, borderRadius: '50%', background: C.ch,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {playing
              ? <svg width="8" height="10" viewBox="0 0 8 10"><rect x="0" y="0" width="2.5" height="10" fill="#161412"/><rect x="5.5" y="0" width="2.5" height="10" fill="#161412"/></svg>
              : <svg width="8" height="10" viewBox="0 0 8 10"><path d="M0,0L8,5L0,10Z" fill="#161412"/></svg>
            }
          </button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {fmtTime(scrub)} / 4:32
          </span>
          {/* Scrub bar */}
          <div
            style={{ flex: 1, position: 'relative', height: 4, cursor: 'pointer' }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const p = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
              setScrub(p); setPlaying(false);
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.14)', borderRadius: 2 }}/>
            <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 2, background: C.ch, width: `${scrub}%`, transition: 'width 0.09s linear' }}/>
            <div style={{
              position: 'absolute', top: '50%', left: `${scrub}%`,
              width: 13, height: 13, background: '#fff', border: `2px solid ${C.ch}`,
              borderRadius: '50%', transform: 'translate(-50%, -50%)',
              transition: 'left 0.09s linear',
            }}/>
          </div>
        </div>
      </div>

      {/* ── Session timeline ────────────────────────────────────────────── */}
      <div style={{ background: C.pa, padding: '12px 17px 15px', borderTop: '0.5px solid rgba(28,28,30,0.07)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'rgba(28,28,30,0.35)' }}>
            Session arc
          </span>
          <span style={{ fontSize: 10.5, color: '#aaa' }}>4 flagged moments</span>
        </div>

        {/* Ribbon with flag markers */}
        <div style={{ position: 'relative', paddingTop: 20, marginBottom: 13, cursor: 'pointer' }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const p = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
            setScrub(p);
          }}
        >
          {/* Flag markers */}
          {FLAGS.map((f, i) => (
            <div
              key={i}
              style={{ position: 'absolute', top: 0, left: `${f.pct}%`, transform: 'translateX(-50%)', cursor: 'pointer', zIndex: 2 }}
              onClick={(e) => { e.stopPropagation(); setScrub(f.pct); }}
              onMouseEnter={() => setHoveredFlag(i)}
              onMouseLeave={() => setHoveredFlag(null)}
            >
              {/* Tooltip */}
              {hoveredFlag === i && (
                <div style={{
                  position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.72)', color: 'rgba(255,255,255,0.9)',
                  fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                  whiteSpace: 'nowrap', letterSpacing: '0.3px',
                }}>
                  {f.label}
                </div>
              )}
              {/* Diamond */}
              <div style={{
                width: 10, height: 10,
                background: f.color,
                transform: 'rotate(45deg)',
              }}/>
            </div>
          ))}

          {/* Gradient ribbon */}
          <div style={{
            height: 8, borderRadius: 4,
            background: `linear-gradient(to right, ${C.ideal} 0% 14%, ${C.good} 14% 28%, ${C.focus} 28% 48%, ${C.good} 48% 65%, ${C.good} 65% 78%, ${C.ideal} 78% 88%, ${C.good} 88% 100%)`,
            opacity: 0.8, position: 'relative',
          }}>
            {/* Ribbon knob */}
            <div style={{
              position: 'absolute', top: '50%', left: `${scrub}%`,
              width: 14, height: 14,
              background: '#fff', border: `2px solid ${C.ch}`,
              borderRadius: '50%', transform: 'translate(-50%, -50%)',
              boxShadow: '0 1px 5px rgba(0,0,0,0.4)', zIndex: 2,
              transition: 'left 0.09s linear',
            }}/>
          </div>
        </div>

        {/* Sparklines row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
          {SPARKS.map(s => (
            <div key={s.name} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'rgba(28,28,30,0.36)', marginBottom: 2 }}>
                {s.name}
              </div>
              <svg viewBox="0 0 80 26" style={{ width: '100%', height: 18 }} preserveAspectRatio="none">
                <polyline points={s.pts.replace('M','')} fill="none" stroke={s.color} strokeWidth="1.5"/>
              </svg>
            </div>
          ))}
        </div>
      </div>

      {/* ── Cadence hint strip ──────────────────────────────────────────── */}
      <div style={{
        borderTop: '0.5px solid rgba(28,28,30,0.07)',
        padding: '9px 17px', display: 'flex', alignItems: 'flex-start', gap: 9,
        background: '#fff',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%', background: C.cg,
          marginTop: 5, flexShrink: 0,
          animation: 'cadPulse 2.4s ease-in-out infinite',
        }}/>
        <p style={{
          fontSize: 12, fontStyle: 'italic',
          color: 'rgba(28,28,30,0.48)', lineHeight: 1.62, margin: 0,
          fontFamily: "'Playfair Display', serif",
        }}>
          <span style={{ color: C.cg, fontStyle: 'normal', fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>Cadence</span>
          {' '}— Focus on following the movement through your lower leg — your core stability is actually your strongest asset today.
        </p>
      </div>

    </div>
  );
}
