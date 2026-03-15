import { useCadence } from '../../context/CadenceContext';

interface CadenceInsightCardProps {
  text: string;
  onAskMore?: () => void;
  compact?: boolean;
}

export default function CadenceInsightCard({
  text,
  onAskMore,
  compact = false,
}: CadenceInsightCardProps) {
  const { openCadence } = useCadence();
  const handleAsk = onAskMore ?? openCadence;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #EAF0FB 0%, #F0F4FC 45%, #EEF2FA 100%)',
        borderRadius: '16px',
        padding: compact ? '12px 14px' : '14px 16px',
        border: '1px solid rgba(107,127,163,0.18)',
        boxShadow: [
          '0 2px 16px rgba(107,127,163,0.13)',
          '0 0 0 0.5px rgba(107,127,163,0.10)',
          'inset 0 1px 0 rgba(255,255,255,0.75)',
          'inset 0 0 32px rgba(107,127,163,0.05)',
        ].join(', '),
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* AI shimmer sweep — soft champagne/white line moving across */}
      <div style={{
        position: 'absolute',
        top: 0, left: '-100%',
        width: '60%', height: '100%',
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 50%, transparent 100%)',
        animation: 'cadence-card-shimmer 3.5s cubic-bezier(0.4,0,0.6,1) infinite',
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      <style>{`
        @keyframes cadence-card-shimmer {
          0%   { left: -100%; opacity: 0.6; }
          40%  { left: 140%;  opacity: 0.9; }
          100% { left: 140%;  opacity: 0; }
        }
      `}</style>

      {/* Subtle top-left luminescence */}
      <div style={{
        position: 'absolute', top: -20, left: -20,
        width: 100, height: 100, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(107,127,163,0.10) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '9px' }}>
          {/* Cadence orb logo */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              position: 'absolute', inset: -3,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(107,127,163,0.22) 0%, transparent 70%)',
            }} />
            <div style={{
              width: 22, height: 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #7B8FB5 0%, #6B7FA3 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 8px rgba(107,127,163,0.35)',
              position: 'relative',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#DCE6F5' }} />
            </div>
          </div>

          <span style={{
            fontSize: '10px', fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase' as const,
            color: '#5A6E90',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            Cadence
          </span>

          <span style={{
            marginLeft: 'auto',
            fontSize: '9px',
            color: 'rgba(107,127,163,0.65)',
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.06em',
          }}>
            AI insight
          </span>
        </div>

        <p style={{
          fontSize: compact ? '12.5px' : '13px',
          color: '#4A5568',
          lineHeight: 1.6,
          marginBottom: '12px',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {text}
        </p>

        {/* Chat CTA */}
        <button
          onClick={handleAsk}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(107,127,163,0.12)',
            border: '1px solid rgba(107,127,163,0.22)',
            borderRadius: '20px',
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: '11.5px',
            color: '#4A6490',
            fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(107,127,163,0.20)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(107,127,163,0.12)'; }}
        >
          <svg width="10" height="11" viewBox="0 0 10 11" fill="none">
            <rect x="1.5" y="0.5" width="3" height="5" rx="1.5" fill="rgba(74,100,144,0.7)" />
            <path d="M0.5 4.5C0.5 6.43 2.07 8 4 8C5.93 8 7.5 6.43 7.5 4.5" stroke="rgba(74,100,144,0.7)" strokeWidth="0.9" strokeLinecap="round" />
            <line x1="4" y1="8" x2="4" y2="10.5" stroke="rgba(74,100,144,0.7)" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
          Ask Cadence more
        </button>
      </div>
    </div>
  );
}