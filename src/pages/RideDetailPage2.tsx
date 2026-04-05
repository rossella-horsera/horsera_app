import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRides, updateRide, deleteRide, type StoredRide } from '@/lib/storage';
import { parseLocalDate } from '@/lib/utils';
import VideoWithSkeleton from '../components/VideoWithSkeleton';

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
  const [editingDate, setEditingDate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emptyFileInputRef = useRef<HTMLInputElement>(null);
  const emptyDateRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss upload error after 4s
  useEffect(() => {
    if (!uploadError) return;
    const t = setTimeout(() => setUploadError(null), 4000);
    return () => clearTimeout(t);
  }, [uploadError]);

  const ride: StoredRide | undefined = getRides().find(r => r.id === id);

  async function handleVideoReplace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !ride) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { supabase } = await import('../integrations/supabase/client');
      const ext = file.name.split('.').pop() ?? 'mp4';
      const path = `videos/${ride.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('ride-videos')
        .upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage
        .from('ride-videos')
        .getPublicUrl(path);
      updateRide(ride.id, { videoUrl: publicUrl });
      forceUpdate(n => n + 1);
    } catch {
      setUploadError('Upload failed — please try again.');
    } finally {
      setUploading(false);
    }
  }

  if (!ride) {
    return (
      <div style={{
        minHeight: '100dvh', background: C.pa,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 28px', gap: 24, position: 'relative',
      }}>
        <button onClick={() => navigate('/')} style={{
          position: 'absolute', top: 20, left: 20,
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 20, color: 'rgba(28,28,30,0.4)',
        }}>←</button>

        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'rgba(193,127,74,0.08)',
          border: '1.5px dashed rgba(193,127,74,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="13" r="4" stroke={C.cg} strokeWidth="1.5"/>
            <path d="M3 9h2l2-3h10l2 3h2a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z"
              stroke={C.cg} strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
        </div>

        <div style={{ textAlign: 'center', maxWidth: 280 }}>
          <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: C.nk, marginBottom: 8 }}>
            No video yet
          </p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'rgba(28,28,30,0.5)', lineHeight: 1.6 }}>
            Upload a video to get your position scores, riding quality analysis, and Cadence insights.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(28,28,30,0.4)', fontFamily: "'DM Sans', sans-serif" }}>
            Ride date
          </label>
          <input type="date" ref={emptyDateRef}
            defaultValue={new Date().toISOString().slice(0, 10)}
            style={{
              border: 'none', borderBottom: '1px solid rgba(193,127,74,0.4)',
              background: 'transparent', fontSize: 14,
              color: C.nk, fontFamily: "'DM Mono', monospace",
              padding: '4px 8px', outline: 'none', textAlign: 'center',
            }}
          />
        </div>

        <button onClick={() => navigate('/')} style={{
          background: C.cg, color: 'white', border: 'none',
          borderRadius: 24, padding: '13px 32px', fontSize: 13,
          fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ↑ Upload ride video
        </button>

        <input type="file" accept="video/*" style={{ display: 'none' }} ref={emptyFileInputRef} />
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

  const dateStr = parseLocalDate(ride.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

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
          {editingDate ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="date"
                autoFocus
                defaultValue={ride.date.slice(0, 10)}
                onChange={e => updateRide(ride.id, { date: e.target.value })}
                onBlur={() => { setEditingDate(false); forceUpdate(n => n + 1); }}
                style={{
                  border: 'none', borderBottom: '1px solid rgba(193,127,74,0.4)',
                  background: 'transparent', fontSize: 10, letterSpacing: '0.1em',
                  color: C.nk, fontFamily: "'DM Mono', monospace",
                  padding: '2px 4px', outline: 'none',
                }}
              />
              <button onClick={() => { setEditingDate(false); forceUpdate(n => n + 1); }} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.ideal, fontSize: 14, lineHeight: 1, padding: '0 4px',
              }}>✓</button>
            </div>
          ) : (
            <div onClick={() => setEditingDate(true)} style={{
              fontSize: 10, color: '#999', fontFamily: "'DM Mono', monospace",
              textTransform: 'uppercase', letterSpacing: '0.5px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {dateStr}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.3 }}>
                <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            if (window.confirm(`Delete this ${ride.type} ride from ${dateStr}? This cannot be undone.`)) {
              deleteRide(ride.id);
              navigate('/rides');
            }
          }}
          aria-label="Delete ride"
          title="Delete ride"
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(28,28,30,0.4)',
            transition: 'background 0.15s ease, color 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FDEDE5'; (e.currentTarget as HTMLElement).style.color = C.focus; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,28,30,0.4)'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" fill="none" stroke="#EDE7DF" strokeWidth="3" />
          <circle cx="26" cy="26" r="22" fill="none" stroke={C.cg} strokeWidth="3"
            strokeDasharray={`${(displayScore / 100) * 2 * Math.PI * 22} ${2 * Math.PI * 22}`}
            strokeLinecap="round" transform="rotate(-90 26 26)" />
          <text x="26" y="29" textAnchor="middle" style={{ fontFamily: "'DM Mono', monospace" }}>
            <tspan fontSize="13" fontWeight="600" fill={C.cg}>{displayScore}</tspan>
            <tspan fontSize="9" fill="rgba(28,28,30,0.4)">/100</tspan>
          </text>
        </svg>
      </div>

      {/* ── S2: VIDEO ── */}
      <div style={{ position: 'relative' }}>
        {ride.videoUrl ? (
          <VideoWithSkeleton
            videoUrl={ride.videoUrl}
            keyframes={ride.keyframes ?? []}
            biometrics={ride.biometrics}
          />
        ) : (
          <div style={{
            width: '100%', aspectRatio: '16/9', background: '#1a1a1a',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            position: 'relative',
          }}>
            <button onClick={() => fileInputRef.current?.click()} style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="13" r="4" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5"/>
                <path d="M3 9h2l2-3h10l2 3h2a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z"
                  stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </button>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}>
              Tap to add video
            </span>
          </div>
        )}

        {/* Camera icon overlay on video */}
        {ride.videoUrl && (
          <button onClick={() => fileInputRef.current?.click()} title="Replace video" style={{
            position: 'absolute', top: 12, right: 12, zIndex: 10,
            width: 36, height: 36, borderRadius: '50%',
            background: uploading ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', backdropFilter: 'blur(4px)',
          }}>
            {uploading ? (
              <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="13" r="4" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5"/>
                <path d="M3 9h2l2-3h10l2 3h2a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z"
                  stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        )}

        {/* Upload error toast */}
        {uploadError && (
          <div style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, background: C.focus, color: '#fff',
            fontSize: 11, borderRadius: 8, padding: '6px 12px',
            fontFamily: "'DM Sans', sans-serif",
            animation: 'fadeIn 0.3s ease',
          }}>
            {uploadError}
          </div>
        )}

        <input type="file" accept="video/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleVideoReplace} />
      </div>

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
          ].map(m => {
            const [mm, ss] = m.time.split(':').map(Number);
            const seekSec = (mm || 0) * 60 + (ss || 0);
            return (
            <div key={m.label} style={{ ...card({ padding: 0, overflow: 'hidden' }) }}>
              <div style={{
                position: 'relative', height: 80, background: '#1a1a1a', overflow: 'hidden',
              }}>
                {ride.videoUrl && (
                  <video
                    src={`${ride.videoUrl}#t=${seekSec}`}
                    preload="metadata"
                    muted
                    playsInline
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%', objectFit: 'cover',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0.15))',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
                  padding: '0 8px 6px',
                }}>
                  <span style={{
                    fontSize: 10, fontFamily: "'DM Mono', monospace",
                    color: '#fff', fontWeight: 600,
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                  }}>{m.time}</span>
                </div>
              </div>
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
            );
          })}
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
