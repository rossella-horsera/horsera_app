interface CadenceFABProps {
  onClick: () => void;
  isActive?: boolean;   // true when Cadence is streaming a response
  isListening?: boolean; // true when voice input is active
}

export default function CadenceFAB({ onClick, isActive = false, isListening = false }: CadenceFABProps) {
  // isAnimated = wave bars animate only when active (listening or speaking)
  const isAnimated = isActive || isListening;
  return (
    <div style={{
      position: 'fixed',
      bottom: '94px',
      right: '20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      zIndex: 60,
    }}>

      {/* "Ask Cadence" label — always visible, soft invitation */}
      <div style={{
        background: 'rgba(28,21,16,0.72)',
        borderRadius: '8px',
        padding: '3px 9px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(201,169,110,0.22)',
        pointerEvents: 'none',
      }}>
        {/* Mic icon — SVG */}
        <svg width="9" height="11" viewBox="0 0 9 11" fill="none">
          <rect x="2.5" y="0.5" width="4" height="6" rx="2" fill="rgba(201,169,110,0.75)" />
          <path d="M1 5.5C1 7.43 2.57 9 4.5 9C6.43 9 8 7.43 8 5.5" stroke="rgba(201,169,110,0.75)" strokeWidth="1" strokeLinecap="round" />
          <line x1="4.5" y1="9" x2="4.5" y2="10.5" stroke="rgba(201,169,110,0.75)" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span style={{
          fontSize: '9px',
          color: 'rgba(201,169,110,0.85)',
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}>
          Ask Cadence
        </span>
      </div>

      {/* FAB button */}
      <button
        onClick={onClick}
        aria-label="Open Cadence — your intelligent riding advisor"
        style={{
          position: 'relative',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: '#1C1510',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: isAnimated
            ? 'cadence-glow 4s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            : 'cadence-breathe 3.8s cubic-bezier(0.45, 0, 0.55, 1) infinite',
          transition: 'transform 0.15s ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.07)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
      >
        {/* Sonar ripple — expands outward and fades */}
        <div style={{
          position: 'absolute',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          border: '1.5px solid rgba(201,169,110,0.40)',
          animation: 'cadence-ripple 4s cubic-bezier(0.2, 0, 0.8, 1) infinite',
          pointerEvents: 'none',
        }} />

        {/* Organic waveform / flame icon — alive, intelligent, warm */}
        <CadenceIcon size={28} animated={isAnimated} />
      </button>
    </div>
  );
}

export function CadenceIcon({ size = 28, animated = true }: { size?: number; animated?: boolean }) {
  // Idle state: gentle breathing orb (no waveform)
  // Active state: animated waveform bars
  if (!animated) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden="true"
      >
        <div style={{
          width: `${size * 0.36}px`,
          height: `${size * 0.36}px`,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 38%, #F0D888 0%, #C9A96E 55%, #A07040 100%)',
          boxShadow: `0 0 ${size * 0.28}px rgba(201,169,110,0.55)`,
          animation: 'cadence-orb-breathe 3.8s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        }} />
        <style>{`
          @keyframes cadence-orb-breathe {
            0%, 100% { transform: scale(0.88); opacity: 0.80; box-shadow: 0 0 6px rgba(201,169,110,0.35); }
            50%       { transform: scale(1.12); opacity: 1.0;  box-shadow: 0 0 14px rgba(201,169,110,0.65); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: `${size * 0.09}px`,
      }}
      aria-hidden="true"
    >
      <div style={{
        width: `${size * 0.115}px`,
        height: `${size * 0.46}px`,
        borderRadius: `${size * 0.058}px`,
        background: 'linear-gradient(180deg, #DFBF74 0%, #A87D4A 100%)',
        opacity: 0.65,
        transformOrigin: 'bottom center',
        animation: 'cadence-wv-0 2.9s ease-in-out infinite',
      }} />
      <div style={{
        width: `${size * 0.115}px`,
        height: `${size * 0.64}px`,
        borderRadius: `${size * 0.058}px`,
        background: 'linear-gradient(180deg, #EACF80 0%, #C9A96E 100%)',
        opacity: 0.85,
        transformOrigin: 'bottom center',
        animation: 'cadence-wv-1 2.1s ease-in-out infinite',
      }} />
      <div style={{
        width: `${size * 0.13}px`,
        height: `${size * 0.82}px`,
        borderRadius: `${size * 0.065}px`,
        background: 'linear-gradient(180deg, #F0D888 0%, #C9A96E 60%, #A07040 100%)',
        opacity: 1,
        transformOrigin: 'bottom center',
        animation: 'cadence-wv-2 1.8s ease-in-out infinite',
        boxShadow: `0 0 ${size * 0.25}px rgba(201,169,110,0.4)`,
      }} />
      <div style={{
        width: `${size * 0.115}px`,
        height: `${size * 0.68}px`,
        borderRadius: `${size * 0.058}px`,
        background: 'linear-gradient(180deg, #EACF80 0%, #C9A96E 100%)',
        opacity: 0.85,
        transformOrigin: 'bottom center',
        animation: 'cadence-wv-3 2.5s ease-in-out infinite',
      }} />
      <div style={{
        width: `${size * 0.115}px`,
        height: `${size * 0.42}px`,
        borderRadius: `${size * 0.058}px`,
        background: 'linear-gradient(180deg, #DFBF74 0%, #A87D4A 100%)',
        opacity: 0.6,
        transformOrigin: 'bottom center',
        animation: 'cadence-wv-4 3.1s ease-in-out infinite',
      }} />

      <style>{`
        @keyframes cadence-wv-0 {
          0%, 100% { transform: scaleY(0.55); }
          50%       { transform: scaleY(1.0); }
        }
        @keyframes cadence-wv-1 {
          0%, 100% { transform: scaleY(0.6); }
          45%       { transform: scaleY(1.0); }
        }
        @keyframes cadence-wv-2 {
          0%, 100% { transform: scaleY(0.58); }
          40%       { transform: scaleY(1.0); }
        }
        @keyframes cadence-wv-3 {
          0%, 100% { transform: scaleY(0.65); }
          55%       { transform: scaleY(1.0); }
        }
        @keyframes cadence-wv-4 {
          0%, 100% { transform: scaleY(0.5); }
          50%       { transform: scaleY(1.0); }
        }
      `}</style>
    </div>
  );
}