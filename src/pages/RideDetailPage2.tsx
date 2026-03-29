import { useParams, useNavigate } from 'react-router-dom';
import { getRides, type StoredRide } from '@/lib/storage';

const C = {
  pa: '#F5EFE6',
  nk: '#1C1C1E',
  cg: '#C17F4A',
  ch: '#D4AF76',
  ideal: '#5B9E56',
  good: '#E8A857',
  focus: '#C14A2A',
  na: '#2C3E50',
};

function scoreColor(score: number): string {
  if (score >= 80) return C.ideal;
  if (score >= 60) return C.good;
  return C.focus;
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Good';
  if (score >= 60) return 'Working';
  return 'Focus area';
}

function qualityLabel(score: number): string {
  if (score >= 80) return 'Consistent';
  if (score >= 60) return 'Developing';
  return 'Focus';
}

/* ── Score Ring SVG ────────────────────────────────────────────────── */
function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = 45;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#EDE7DF" strokeWidth="6" />
      <circle
        cx="50" cy="50" r={r} fill="none"
        stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" textAnchor="middle" fill={color}
        style={{ fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
        <tspan style={{ fontSize: '18px' }}>{score}</tspan>
        <tspan style={{ fontSize: '10px', fill: '#BBB' }}>/100</tspan>
      </text>
    </svg>
  );
}

/* ── Section Header ────────────────────────────────────────────────── */
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ padding: '0 18px', marginBottom: 14 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.cg, textTransform: 'uppercase',
        letterSpacing: '1.2px', fontFamily: "'DM Sans', sans-serif", marginBottom: 4,
      }}>{title}</div>
      {subtitle && (
        <div style={{
          fontSize: 13, color: '#999', fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic',
        }}>{subtitle}</div>
      )}
      <div style={{ height: 1, background: '#EDE7DF', marginTop: 8 }} />
    </div>
  );
}

/* ── Card wrapper ──────────────────────────────────────────────────── */
const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: '#fff',
  borderRadius: 16,
  padding: 16,
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  ...extra,
});

/* ════════════════════════════════════════════════════════════════════ */

export default function RideDetailPage2() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const ride: StoredRide | undefined = getRides().find(r => r.id === id);

  if (!ride) {
    return (
      <div style={{ background: C.pa, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: C.nk }}>Ride not found</div>
        <button onClick={() => navigate('/')} style={{
          background: C.cg, color: '#fff', border: 'none', borderRadius: 8,
          padding: '10px 24px', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, cursor: 'pointer',
        }}>Back to Rides</button>
      </div>
    );
  }

  const bio = ride.biometrics;
  const rq = ride.ridingQuality;
  const displayScore = Math.round(ride.overallScore * 100);

  const zones = [
    { label: 'Upper Body', score: Math.round(bio.upperBodyAlignment * 100) },
    { label: 'Lower Leg', score: Math.round(bio.lowerLegStability * 100) },
    { label: 'Core', score: Math.round(bio.coreStability * 100) },
    { label: 'Pelvis', score: Math.round(bio.pelvisStability * 100) },
    { label: 'Rein Steady', score: Math.round(bio.reinSteadiness * 100) },
    { label: 'Rein Symmetry', score: Math.round(bio.reinSymmetry * 100) },
  ];

  const qualityMetrics = rq ? [
    { name: 'Rhythm', score: Math.round(rq.rhythm * 100) },
    { name: 'Relaxation', score: Math.round(rq.relaxation * 100) },
    { name: 'Contact', score: Math.round(rq.contact * 100) },
    { name: 'Impulsion', score: Math.round(rq.impulsion * 100) },
    { name: 'Straightness', score: Math.round(rq.straightness * 100) },
    { name: 'Balance', score: Math.round(rq.balance * 100) },
  ] : null;

  const bestZone = zones.reduce((a, b) => a.score >= b.score ? a : b);
  const worstZone = zones.reduce((a, b) => a.score <= b.score ? a : b);

  const dateStr = new Date(ride.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div style={{ background: C.pa, minHeight: '100vh', paddingBottom: 100 }}>

      {/* ── S1: HEADER ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 40, background: '#fff',
        borderBottom: '1px solid #EDE7DF', display: 'flex', alignItems: 'center',
        padding: '10px 14px', gap: 10,
      }}>
        <button onClick={() => navigate('/')} style={{
          width: 34, height: 34, borderRadius: '50%', background: '#F5F0EA',
          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8L10 13" stroke={C.nk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: C.nk }}>
            {ride.type.charAt(0).toUpperCase() + ride.type.slice(1)} · {ride.horse}
          </div>
          <div style={{ fontSize: 10, color: '#999', fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {dateStr}
          </div>
        </div>
        <svg width="46" height="46" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#EDE7DF" strokeWidth="5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke={C.cg} strokeWidth="5"
            strokeDasharray={`${(displayScore / 100) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
            strokeLinecap="round" transform="rotate(-90 50 50)" />
          <text x="50" y="55" textAnchor="middle" fill={C.cg}
            style={{ fontSize: '26px', fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
            {displayScore}
          </text>
        </svg>
      </div>

      {/* ── S2: VIDEO ── */}
      {ride.videoUrl ? (
        <video
          src={ride.videoUrl}
          controls
          playsInline
          style={{ width: '100%', aspectRatio: '16/9', background: '#000', display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', aspectRatio: '16/9', background: '#1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#666', fontFamily: "'DM Sans', sans-serif", fontSize: 13,
        }}>
          No video for this ride
        </div>
      )}

      {/* ── S3: SESSION INFO STRIP ── */}
      <div style={{
        padding: '8px 18px', background: C.pa,
        fontSize: 11, color: '#999', fontFamily: "'DM Mono', monospace",
      }}>
        {ride.horse} · {ride.duration}min · {ride.type.charAt(0).toUpperCase() + ride.type.slice(1)}
      </div>

      {/* ── S4: CADENCE INSIGHT ── */}
      <div style={{ padding: '12px 18px' }}>
        <div style={{
          ...card(), borderLeft: `3px solid ${C.cg}`, display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: C.cg, marginTop: 4, flexShrink: 0,
            animation: 'pulse 2s infinite',
          }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: C.cg, fontFamily: "'Inter', sans-serif", marginBottom: 4 }}>
              Cadence
            </div>
            <div style={{ fontSize: 13, color: C.na, fontFamily: "'Playfair Display', serif", fontStyle: 'italic', lineHeight: 1.5 }}>
              {ride.insights?.[0] || "Upload a video to unlock Cadence's analysis."}
            </div>
          </div>
        </div>
      </div>

      {/* ── S5: POSITION SCORES (6 metrics, 3-col grid) ── */}
      <div style={{ paddingTop: 12 }}>
        <SectionHeader title="Your Position" subtitle="Movement & Biomechanics" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: '0 18px', marginBottom: 24 }}>
          {zones.map(z => (
            <div key={z.label} style={{ ...card(), textAlign: 'center', padding: 14 }}>
              <ScoreRing score={z.score} />
              <div style={{ fontSize: 12, color: '#888', fontFamily: "'DM Sans', sans-serif", marginTop: 6 }}>
                {z.label}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                color: scoreColor(z.score), fontFamily: "'DM Sans', sans-serif", marginTop: 2,
              }}>
                {scoreLabel(z.score)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── S6: RIDING QUALITY (6 metrics, 3-col ring grid) ── */}
      {qualityMetrics && (
        <div style={{ paddingTop: 4 }}>
          <SectionHeader title="Riding Quality" subtitle="The Training Scales" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: '0 18px', marginBottom: 24 }}>
            {qualityMetrics.map(m => (
              <div key={m.name} style={{ ...card(), textAlign: 'center', padding: 14 }}>
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
      )}

      {/* ── S7: CADENCE DEBRIEF ── */}
      <div style={{ padding: '0 18px', marginBottom: 24 }}>
        <div style={{ ...card({ background: C.na, padding: 20 }) }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: C.cg, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontSize: 22, color: '#fff' }}>C</span>
            </div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontSize: 13.5, color: C.ch, lineHeight: 1.6 }}>
              Today's ride showed strength in your {bestZone.label.toLowerCase()} — your strongest zone at {bestZone.score}%.
              Focus on the {worstZone.label.toLowerCase()} in your next session to unlock improvements across all the scales.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, background: `${C.ideal}22`, color: C.ideal, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              {bestZone.label} {bestZone.score}%
            </span>
            <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, background: `${scoreColor(displayScore)}22`, color: scoreColor(displayScore), fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              Overall {displayScore}
            </span>
            <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, background: `${C.focus}22`, color: C.focus, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              {worstZone.label} {worstZone.score}%
            </span>
          </div>
        </div>
      </div>

      {/* ── S8: COMPENSATION CHAIN ── */}
      <div style={{ paddingTop: 4 }}>
        <SectionHeader title="Compensation Chain" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px', marginBottom: 24 }}>
          {[
            { num: 1, color: C.focus, title: 'Lower leg stability', sub: 'Root cause', desc: 'Instability in the lower leg creates a cascading effect through the body.' },
            { num: 2, color: C.good, title: 'Rein tension', sub: 'Consequence', desc: 'Compensating for balance by relying on the reins for stability.' },
            { num: 3, color: C.ch, title: 'Rhythm disruption', sub: 'Downstream', desc: 'Inconsistent aids lead to breaks in the horse\'s natural rhythm.' },
          ].map(item => (
            <div key={item.num} style={{ ...card({ display: 'flex', gap: 12, alignItems: 'flex-start' }) }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', background: `${item.color}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                fontSize: 13, fontWeight: 700, color: item.color, fontFamily: "'DM Mono', monospace",
              }}>{item.num}</div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: item.color, fontFamily: "'DM Sans', sans-serif" }}>
                  {item.sub}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.nk, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 12, color: '#888', fontFamily: "'DM Sans', sans-serif", marginTop: 2, lineHeight: 1.4 }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── S9: KEY MOMENTS ── */}
      <div style={{ paddingTop: 4 }}>
        <SectionHeader title="Key Moments" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 18px', marginBottom: 24 }}>
          {[
            { label: 'Best moment', time: '2:18', color: C.ideal, tag: 'All joints on target' },
            { label: 'Focus moment', time: '1:24', color: C.focus, tag: 'Rein asymmetry' },
          ].map(m => (
            <div key={m.label} style={{ ...card({ padding: 0, overflow: 'hidden' }) }}>
              <div style={{
                height: 80, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#555', fontSize: 11, fontFamily: "'DM Mono', monospace",
              }}>{m.time}</div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: m.color, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
                  {m.label}
                </div>
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: `${m.color}14`, color: m.color,
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                }}>{m.tag}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
