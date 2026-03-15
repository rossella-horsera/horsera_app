import { useState } from 'react';
import { getUserProfile } from '../lib/userProfile';

// ─── Milestone path node ───────────────────────────────────────────────────────

interface PathNode {
  label: string;
  sublabel: string;
  state: 'done' | 'active' | 'future' | 'far';
}

function getJourneyNodes(discipline: string): PathNode[] {
  if (discipline === 'pony-club') {
    return [
      { label: 'D1 — Foundations',      sublabel: 'Walk, trot control, circles',          state: 'done'   },
      { label: 'D2 — Independent Rider', sublabel: 'Diagonal, 20m circle, transitions',    state: 'active' },
      { label: 'D3 — Balanced Rider',    sublabel: 'Correct leads, small cross rails',      state: 'future' },
      { label: 'C1 — Influential Rider', sublabel: '4–6 fence course, consistent leads',    state: 'future' },
      { label: 'C2 — Performance Ready', sublabel: "2'–2'6\" course, stride adjustability", state: 'far'    },
    ];
  }
  if (discipline === 'usdf' || discipline === 'usdf-dressage') {
    return [
      { label: 'Intro Level',    sublabel: 'Walk, trot, rhythm, relaxation',  state: 'done'   },
      { label: 'Training Level', sublabel: 'Steady contact, balanced canter', state: 'active' },
      { label: 'First Level',    sublabel: 'Bend, balance, leg yield',        state: 'future' },
      { label: 'Second Level',   sublabel: 'Collection, shoulder-in, travers',state: 'future' },
      { label: 'Third Level',    sublabel: 'Flying changes, half-pass',       state: 'far'    },
    ];
  }
  if (discipline === 'hunter-jumper') {
    return [
      { label: 'Foundation',       sublabel: 'Position, 2-point, ground poles',    state: 'done'   },
      { label: 'Cross rails',      sublabel: 'Course work, rhythm, approach',       state: 'active' },
      { label: "Novice (2')",      sublabel: 'Consistent pace, turns, 8-fence',     state: 'future' },
      { label: "Modified (2'6\")", sublabel: 'Related distances, pace control',     state: 'future' },
      { label: "Training (3')",    sublabel: 'Scope, adjustability, confidence',    state: 'far'    },
    ];
  }
  return [
    { label: 'Foundation',   sublabel: 'Balance & rhythm',        state: 'done'   },
    { label: 'Connection',   sublabel: 'Rein contact & softness', state: 'active' },
    { label: 'Impulsion',    sublabel: 'Energy & forward',        state: 'future' },
    { label: 'Straightness', sublabel: 'Alignment & symmetry',    state: 'future' },
    { label: 'Collection',   sublabel: 'Elevation & lightness',   state: 'far'    },
  ];
}

const DISCIPLINE_LABELS: Record<string, string> = {
  'usdf-dressage':        'USDF Dressage',
  'usdf':                 'USDF Dressage',
  'pony-club':            'Pony Club',
  'hunter-jumper':        'Hunter / Jumper',
  'a-bit-of-everything':  'All-Round',
};

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function JourneyPage() {
  const [excited, setExcited] = useState(false);
  const [heartCount, setHeartCount] = useState(0);
  const [thanked, setThanked] = useState(false);
  const profile = getUserProfile();
  const disciplineLabel = DISCIPLINE_LABELS[profile.discipline] ?? 'Equestrian';
  const journeyNodes = getJourneyNodes(profile.discipline);

  const handleExcited = () => {
    if (thanked) return;
    const next = heartCount + 1;
    setHeartCount(next);
    setExcited(true);
    setTimeout(() => setExcited(false), 600);
    if (next >= 1) {
      setTimeout(() => setThanked(true), 300);
    }
  };

  return (
    <div style={{
      background: '#FAF7F3',
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '36px 28px 60px',
      position: 'relative',
      overflow: 'hidden',
    }}>

      <style>{`
        @keyframes journey-float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
        @keyframes journey-pulse-ring {
          0%   { transform: scale(1);   opacity: 0.5; }
          70%  { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes journey-heart-pop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.35); }
          70%  { transform: scale(0.92); }
          100% { transform: scale(1); }
        }
        @keyframes journey-node-appear {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes journey-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* ─── Soft ambient background circles ─── */}
      <div style={{
        position: 'absolute', top: -80, right: -60,
        width: 240, height: 240, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(201,169,110,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: 100, left: -40,
        width: 180, height: 180, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(140,90,60,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* ─── Header eyebrow ─── */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        marginBottom: 20,
        animation: 'journey-fade-in 0.6s ease both',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 600, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: '#C9A96E',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          Your Journey
        </div>
        <div style={{
          fontSize: '10px', color: 'rgba(181,168,152,0.8)',
          fontFamily: "'DM Mono', monospace",
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          background: 'rgba(201,169,110,0.08)',
          border: '1px solid rgba(201,169,110,0.18)',
          borderRadius: '20px',
          padding: '3px 10px',
        }}>
          {disciplineLabel}{profile.discipline === 'pony-club' ? ' · Progression Path' : profile.discipline === 'hunter-jumper' ? ' · Course Path' : ' · Training Scale'}
        </div>
      </div>

      {/* ─── Floating icon ─── */}
      <div style={{
        position: 'relative',
        marginBottom: 28,
        animation: 'journey-float 4s ease-in-out infinite',
      }}>
        {/* Pulse ring behind the icon */}
        <div style={{
          position: 'absolute', inset: -12,
          borderRadius: '50%',
          border: '1.5px solid rgba(201,169,110,0.35)',
          pointerEvents: 'none',
          animation: 'journey-pulse-ring 2.4s ease-out infinite',
        }} />
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(145deg, rgba(201,169,110,0.14) 0%, rgba(140,90,60,0.08) 100%)',
          border: '1.5px solid rgba(201,169,110,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(140,90,60,0.1)',
        }}>
          {/* Path / journey SVG icon */}
          <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true">
            {/* Winding path */}
            <path
              d="M8 30 Q10 22 16 20 Q22 18 22 12 Q22 6 19 4"
              stroke="#C9A96E"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
              opacity="0.5"
            />
            {/* Milestone dots on path */}
            <circle cx="19" cy="4"  r="2.5" fill="#C9A96E" opacity="0.35" />
            <circle cx="22" cy="12" r="2.5" fill="#C9A96E" opacity="0.55" />
            <circle cx="19" cy="20" r="3"   fill="#C9A96E" opacity="0.8" />
            <circle cx="13" cy="26" r="2"   fill="#8C5A3C" opacity="0.6" />
            <circle cx="8"  cy="30" r="2.5" fill="#8C5A3C" />
            {/* Rider glyph at current position */}
            <circle cx="8" cy="30" r="5" stroke="#8C5A3C" strokeWidth="1.5" fill="rgba(140,90,60,0.1)" />
          </svg>
        </div>
      </div>

      {/* ─── Headline ─── */}
      <h1 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: '26px',
        fontWeight: 400,
        color: '#1A140E',
        textAlign: 'center',
        lineHeight: 1.3,
        letterSpacing: '-0.01em',
        marginBottom: 12,
        maxWidth: 280,
        animation: 'journey-fade-in 0.7s 0.1s ease both',
      }}>
        Your riding journey is being crafted.
      </h1>

      {/* ─── Subtitle ─── */}
      <p style={{
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '14px',
        color: '#7A6B5D',
        textAlign: 'center',
        lineHeight: 1.65,
        maxWidth: 290,
        marginBottom: 40,
        animation: 'journey-fade-in 0.7s 0.2s ease both',
      }}>
        A personal progression path — levels, milestones, and skills tailored to where you are and where you&#39;re going. Every ride, a step forward.
      </p>

      {/* ─── Milestone path visual ─── */}
      <div style={{
        width: '100%',
        maxWidth: 340,
        marginBottom: 44,
        animation: 'journey-fade-in 0.8s 0.3s ease both',
      }}>
        {journeyNodes.map((node, i) => {
          const isLast = i === journeyNodes.length - 1;
          const isDone = node.state === 'done';
          const isActive = node.state === 'active';
          const isFar = node.state === 'far';

          const nodeColor = isDone ? '#8C5A3C' : isActive ? '#C9A96E' : isFar ? '#D4C9BC' : '#C4B8AC';
          const nodeSize = isActive ? 16 : isDone ? 12 : isFar ? 8 : 10;
          const labelColor = isDone ? '#1A140E' : isActive ? '#8C5A3C' : isFar ? '#C4B8AC' : '#B5A898';
          const opacity = isFar ? 0.45 : 1;

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                opacity,
                animation: `journey-node-appear 0.5s ${0.3 + i * 0.1}s ease both`,
              }}
            >
              {/* Node + connector */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      width: nodeSize + 10, height: nodeSize + 10,
                      borderRadius: '50%',
                      border: '1.5px solid rgba(201,169,110,0.4)',
                      animation: 'journey-pulse-ring 2.4s ease-out infinite',
                    }} />
                  )}
                  <div style={{
                    width: nodeSize, height: nodeSize,
                    borderRadius: '50%',
                    background: isDone
                      ? '#8C5A3C'
                      : isActive
                      ? 'linear-gradient(135deg, #E2C384, #C9A96E)'
                      : 'transparent',
                    border: `2px solid ${nodeColor}`,
                    flexShrink: 0,
                    boxShadow: isActive ? '0 0 12px rgba(201,169,110,0.35)' : 'none',
                    transition: 'all 0.3s ease',
                  }} />
                </div>
                {!isLast && (
                  <div style={{
                    width: 2,
                    height: 36,
                    marginTop: 4,
                    background: isDone
                      ? 'linear-gradient(180deg, #8C5A3C 0%, rgba(201,169,110,0.4) 100%)'
                      : 'linear-gradient(180deg, rgba(201,169,110,0.2) 0%, transparent 100%)',
                    borderRadius: 1,
                  }} />
                )}
              </div>

              {/* Text */}
              <div style={{ paddingBottom: isLast ? 0 : 24 }}>
                <div style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 500,
                  color: labelColor,
                  lineHeight: 1.3,
                  marginBottom: 2,
                }}>
                  {node.label}
                  {isDone && (
                    <span style={{
                      marginLeft: 8,
                      fontSize: '10px',
                      color: '#8C5A3C',
                      background: 'rgba(140,90,60,0.08)',
                      padding: '1px 7px',
                      borderRadius: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                    }}>
                      Mastered
                    </span>
                  )}
                  {isActive && (
                    <span style={{
                      marginLeft: 8,
                      fontSize: '10px',
                      color: '#C9A96E',
                      background: 'rgba(201,169,110,0.12)',
                      padding: '1px 7px',
                      borderRadius: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                    }}>
                      Now
                    </span>
                  )}
                </div>
                <div style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '11.5px',
                  color: isFar ? '#C4B8AC' : '#B5A898',
                  lineHeight: 1.4,
                }}>
                  {node.sublabel}
                </div>
              </div>
            </div>
          );
        })}

        {/* "...and beyond" fade out hint */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          paddingTop: 4,
          opacity: 0.3,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#C4B8AC' }} />
            <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#C4B8AC', marginTop: 4 }} />
            <div style={{ width: 2, height: 2, borderRadius: '50%', background: '#C4B8AC', marginTop: 4 }} />
          </div>
          <div style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '11px',
            color: '#C4B8AC',
            fontStyle: 'italic',
          }}>
            and beyond…
          </div>
        </div>
      </div>

      {/* ─── "I'm excited" tap interaction ─── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        animation: 'journey-fade-in 0.7s 0.6s ease both',
      }}>
        {!thanked ? (
          <>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '12px',
              color: '#B5A898',
              textAlign: 'center',
              marginBottom: 4,
            }}>
              Feeling the excitement?
            </p>
            <button
              onClick={handleExcited}
              aria-label="I'm excited about Journey"
              style={{
                background: 'none',
                border: '1.5px solid rgba(201,169,110,0.3)',
                borderRadius: '28px',
                padding: '10px 22px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'border-color 0.2s ease, background 0.2s ease',
                animation: excited ? 'journey-heart-pop 0.4s ease' : 'none',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ display: 'inline-block', animation: excited ? 'journey-heart-pop 0.4s ease' : 'none' }}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="#8C5A3C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px',
                fontWeight: 500,
                color: '#8C5A3C',
                letterSpacing: '0.01em',
              }}>
                I&#39;m excited
              </span>
            </button>
          </>
        ) : (
          <div style={{
            padding: '14px 24px',
            background: 'rgba(201,169,110,0.08)',
            borderRadius: '20px',
            border: '1px solid rgba(201,169,110,0.18)',
            textAlign: 'center',
            animation: 'journey-fade-in 0.5s ease both',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#8C5A3C" strokeWidth="1.4" fill="rgba(140,90,60,0.08)"/>
                <path d="M8 12l3 3 5-5" stroke="#8C5A3C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '13px',
              fontWeight: 500,
              color: '#8C5A3C',
              lineHeight: 1.5,
              margin: 0,
            }}>
              We'll let you know.
            </p>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '12px',
              color: '#B5A898',
              lineHeight: 1.5,
              marginTop: 4,
              marginBottom: 0,
            }}>
              Your full journey map is coming — you'll be the first to see it.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
