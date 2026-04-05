import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRides, updateRide, deleteRide, type StoredRide } from '@/lib/storage';
import { parseLocalDate } from '@/lib/utils';
import { useCadence } from '@/context/CadenceContext';
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

/* ── Notes editor — inline editable name/notes ────────────────────── */
function RideNotesEditor({ ride, onChange }: { ride: StoredRide; onChange: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(ride.name || '');
  const [notes, setNotes] = useState(ride.notes || '');

  const hasContent = !!(ride.name || ride.notes);

  const save = () => {
    updateRide(ride.id, {
      name: name.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setIsEditing(false);
    onChange();
  };

  const cancel = () => {
    setName(ride.name || '');
    setNotes(ride.notes || '');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div style={{ padding: '12px 18px 0' }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: 14,
          border: '1px solid rgba(0,0,0,0.08)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name this ride (optional)"
            maxLength={60}
            autoFocus
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.1)', fontSize: 14,
              fontFamily: "'DM Sans', sans-serif", color: '#1C1C1E',
              background: '#FAF7F3', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="How did it feel? What did you work on?"
            rows={3}
            maxLength={500}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.1)', fontSize: 13,
              fontFamily: "'DM Sans', sans-serif", color: '#1C1C1E', lineHeight: 1.5,
              background: '#FAF7F3', outline: 'none', boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={cancel}
              style={{
                background: 'transparent', border: '1px solid rgba(0,0,0,0.1)',
                borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
                fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.55)',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >Cancel</button>
            <button
              onClick={save}
              style={{
                background: '#C17F4A', border: 'none',
                borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: '#fff',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >Save</button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div style={{ padding: '12px 18px 0' }}>
        <button
          onClick={() => setIsEditing(true)}
          style={{
            background: 'transparent', border: '1.5px dashed rgba(0,0,0,0.12)',
            borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
            fontSize: 12, color: 'rgba(0,0,0,0.45)',
            fontFamily: "'DM Sans', sans-serif",
            width: '100%', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          Add a name or note to this ride
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 18px 0' }}>
      <div
        onClick={() => setIsEditing(true)}
        style={{
          background: 'rgba(255,255,255,0.6)',
          borderLeft: '2px solid rgba(28,28,30,0.15)',
          padding: '10px 14px', borderRadius: '0 10px 10px 0',
          cursor: 'pointer', position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'rgba(28,28,30,0.4)',
            fontFamily: "'DM Sans', sans-serif",
          }}>Your notes</div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.35 }}>
            <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {ride.name && (
          <div style={{
            fontSize: 14, fontWeight: 600, color: '#1C1C1E',
            fontFamily: "'DM Sans', sans-serif", marginBottom: 4,
          }}>{ride.name}</div>
        )}
        {ride.notes && (
          <div style={{
            fontSize: 13, color: '#1C1C1E', lineHeight: 1.5,
            fontFamily: "'DM Sans', sans-serif", whiteSpace: 'pre-wrap',
          }}>{ride.notes}</div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */

export default function RideDetailPage2() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { openCadence } = useCadence();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedMoment, setSelectedMoment] = useState<null | 'best' | 'focus'>(null);
  const [, forceUpdate] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emptyFileInputRef = useRef<HTMLInputElement>(null);
  const emptyDateRef = useRef<HTMLInputElement>(null);
  const headerDateRef = useRef<HTMLInputElement>(null);

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: C.nk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ride.name || `${ride.type.charAt(0).toUpperCase() + ride.type.slice(1)} · ${ride.horse}`}
          </div>
          <div
            onClick={() => {
              const input = headerDateRef.current;
              if (!input) return;
              // Try to open the native date picker immediately
              if (typeof (input as any).showPicker === 'function') {
                try { (input as any).showPicker(); return; } catch {}
              }
              input.focus();
              input.click();
            }}
            style={{
              fontSize: 10, color: '#999', fontFamily: "'DM Mono', monospace",
              textTransform: 'uppercase', letterSpacing: '0.5px',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              position: 'relative',
            }}
          >
            {dateStr}
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.3 }}>
              <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {/* Hidden native date input — triggered by click above */}
            <input
              ref={headerDateRef}
              type="date"
              value={ride.date.slice(0, 10)}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => { updateRide(ride.id, { date: e.target.value }); forceUpdate(n => n + 1); }}
              style={{
                position: 'absolute', left: 0, top: 0,
                width: '100%', height: '100%',
                opacity: 0, pointerEvents: 'none',
                border: 'none', padding: 0, margin: 0,
              }}
              aria-label="Change ride date"
            />
          </div>
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

        {/* Replace-video button — video-swap icon */}
        {ride.videoUrl && (
          <button onClick={() => fileInputRef.current?.click()} aria-label="Replace video" title="Replace video" style={{
            position: 'absolute', top: 10, right: 10, zIndex: 10,
            height: 30, borderRadius: 15,
            background: uploading ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 12px 0 10px',
            cursor: 'pointer', backdropFilter: 'blur(4px)',
            color: 'rgba(255,255,255,0.9)',
          }}>
            {uploading ? (
              <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  {/* Video rectangle with play triangle + small swap arrows */}
                  <rect x="3" y="6" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.7"/>
                  <path d="M17 10l4-2v8l-4-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 3l-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
                  <path d="M5 5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
                </svg>
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  fontFamily: "'DM Sans', sans-serif",
                }}>Replace</span>
              </>
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

      {/* ── Rider name + notes (editable) ── */}
      <RideNotesEditor ride={ride} onChange={() => forceUpdate(n => n + 1)} />

      {/* ── S4: CADENCE INSIGHT ── */}
      <div style={{ padding: '12px 18px' }}>
        <div style={{
          ...card(), borderLeft: `3px solid ${C.cg}`, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: C.cg, marginTop: 4, flexShrink: 0,
              animation: 'pulse 2s infinite',
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: C.cg, fontFamily: "'Inter', sans-serif", marginBottom: 4 }}>
                Cadence
              </div>
              <div style={{ fontSize: 13, color: C.na, fontFamily: "'Playfair Display', serif", fontStyle: 'italic', lineHeight: 1.5 }}>
                {ride.insights?.[0] || "Upload a video to unlock Cadence's analysis."}
              </div>
            </div>
          </div>
          {ride.insights?.[0] && (
            <div style={{
              borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {/* Primary CTA — full-width, visually distinct */}
              <button
                onClick={openCadence}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 10,
                  background: C.cg, border: 'none', color: '#fff',
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  WebkitTapHighlightColor: 'transparent',
                  boxShadow: '0 2px 8px rgba(193,127,74,0.2)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1C4.13 1 1 3.58 1 6.75c0 1.74.95 3.29 2.5 4.33L3 14l3.5-1.83c.48.08.98.12 1.5.12 3.87 0 7-2.58 7-5.75S11.87 1 8 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
                Ask Cadence about this ride
              </button>
              {/* Suggested prompts — secondary, visually subordinate */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                  fontSize: 9, fontWeight: 600, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)',
                  fontFamily: "'DM Sans', sans-serif", marginBottom: 2,
                }}>Or try</div>
                {[
                  `Why is my ${worstZone.label.toLowerCase()} at ${worstZone.score}?`,
                  `How do I improve from this session?`,
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={openCadence}
                    style={{
                      fontSize: 12, padding: '8px 12px', borderRadius: 10,
                      background: 'transparent', border: `1px solid rgba(0,0,0,0.08)`,
                      color: 'rgba(0,0,0,0.65)',
                      fontFamily: "'DM Sans', sans-serif", fontWeight: 400,
                      cursor: 'pointer', textAlign: 'left',
                      WebkitTapHighlightColor: 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
                    <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 14, flexShrink: 0 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── S5: POSITION SCORES (6 metrics, 3-col grid) ── */}
      <div style={{ paddingTop: 12 }}>
        <SectionHeader title="Your Position" subtitle="Movement & Biomechanics" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: '0 18px', marginBottom: 24 }}>
          {zones.map(z => (
            <div key={z.label} style={{ ...card(), textAlign: 'center', padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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
              <div key={m.name} style={{ ...card(), textAlign: 'center', padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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
            { key: 'best' as const, label: 'Best moment', seekSec: 14, color: C.ideal, zone: bestZone },
            { key: 'focus' as const, label: 'Focus moment', seekSec: 6, color: C.focus, zone: worstZone },
          ].map(m => {
            const mm = Math.floor(m.seekSec / 60);
            const ss = m.seekSec % 60;
            const timeLabel = `${mm}:${String(ss).padStart(2, '0')}`;
            return (
            <button
              key={m.label}
              onClick={() => setSelectedMoment(m.key)}
              aria-label={`See ${m.label.toLowerCase()}`}
              style={{
                ...card({ padding: 0, overflow: 'hidden' }),
                border: 'none', cursor: 'pointer', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                position: 'relative', height: 80, background: '#1a1a1a', overflow: 'hidden',
              }}>
                {ride.videoUrl && (
                  <video
                    src={`${ride.videoUrl}#t=${m.seekSec}`}
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
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                  padding: '0 8px 6px',
                }}>
                  <span style={{
                    fontSize: 10, fontFamily: "'DM Mono', monospace",
                    color: '#fff', fontWeight: 600,
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                  }}>{timeLabel}</span>
                  <span style={{
                    fontSize: 11, fontFamily: "'DM Mono', monospace",
                    color: '#fff', fontWeight: 700,
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                  }}>{m.zone.score}</span>
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
                }}>{m.zone.label}</span>
              </div>
            </button>
            );
          })}
        </div>
      </div>

      {/* ── Key moment detail modal ── */}
      {selectedMoment && (() => {
        const isBest = selectedMoment === 'best';
        const zone = isBest ? bestZone : worstZone;
        const seekSec = isBest ? 14 : 6;
        const color = isBest ? C.ideal : C.focus;
        const mm = Math.floor(seekSec / 60);
        const ss = seekSec % 60;
        const timeLabel = `${mm}:${String(ss).padStart(2, '0')}`;
        const insight = isBest
          ? `Your ${zone.label.toLowerCase()} peaked here at ${zone.score}/100. This is the feel to hold onto — anchor other aspects of your ride to this moment.`
          : `${zone.label} is at ${zone.score}/100 in this moment — your weakest area this session. Focus here first: small, consistent improvements compound across every other metric.`;
        return (
          <div
            onClick={() => setSelectedMoment(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: C.pa, borderRadius: '20px 20px 0 0',
                width: '100%', maxWidth: 520, padding: 20,
                animation: 'fadeIn 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                  color, fontFamily: "'DM Sans', sans-serif",
                }}>
                  {isBest ? 'Best Moment' : 'Focus Moment'}
                </div>
                <button
                  onClick={() => setSelectedMoment(null)}
                  aria-label="Close"
                  style={{
                    width: 28, height: 28, borderRadius: '50%', border: 'none',
                    background: 'rgba(0,0,0,0.08)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: C.nk, fontSize: 18, lineHeight: 1,
                  }}
                >×</button>
              </div>
              {ride.videoUrl && (
                <div style={{
                  position: 'relative', width: '100%', aspectRatio: '16/9',
                  borderRadius: 12, overflow: 'hidden', background: '#1a1a1a', marginBottom: 12,
                }}>
                  <video
                    src={`${ride.videoUrl}#t=${seekSec}`}
                    preload="metadata"
                    controls
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(0,0,0,0.65)', color: '#fff',
                    fontSize: 10, fontFamily: "'DM Mono', monospace", fontWeight: 600,
                    padding: '3px 8px', borderRadius: 6,
                  }}>{timeLabel}</div>
                </div>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
              }}>
                <span style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6,
                  background: `${color}14`, color,
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                }}>{zone.label}</span>
                <span style={{
                  fontSize: 20, fontWeight: 700, color,
                  fontFamily: "'DM Mono', monospace",
                }}>{zone.score}<span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>/100</span></span>
              </div>
              <div style={{
                fontSize: 14, color: C.na, lineHeight: 1.55,
                fontFamily: "'Playfair Display', serif", fontStyle: 'italic',
              }}>
                {insight}
              </div>
            </div>
          </div>
        );
      })()}

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
