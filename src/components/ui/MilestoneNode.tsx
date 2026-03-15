import type { MilestoneState } from '../../data/mock';

interface MilestoneNodeProps {
  name: string;
  state: MilestoneState;
  ridesConsistent: number;
  ridesRequired: number;
  isActive?: boolean;
  isLast?: boolean;
  onClick?: () => void;
}

const stateConfig = {
  untouched: {
    nodeBackground: '#FAF7F3',
    nodeBorder: '2px solid #EDE7DF',
    nodeColor: '#B5A898',
    labelColor: '#B5A898',
    pillBackground: '#F5F0E8',
    pillText: '#B5A898',
    pillLabel: 'Not started',
  },
  working: {
    nodeBackground: '#FBF6EE',
    nodeBorder: '2px solid #C9A96E',
    nodeColor: '#C9A96E',
    labelColor: '#1A140E',
    pillBackground: '#FBF6EE',
    pillText: '#8C5A3C',
    pillLabel: 'Working on it',
  },
  mastered: {
    nodeBackground: '#8C5A3C',
    nodeBorder: '2px solid #8C5A3C',
    nodeColor: '#FAF7F3',
    labelColor: '#1A140E',
    pillBackground: '#F0EDE8',
    pillText: '#7D9B76',
    pillLabel: 'Mastered',
  },
};

export default function MilestoneNode({
  name,
  state,
  ridesConsistent,
  ridesRequired,
  isActive = false,
  isLast = false,
  onClick,
}: MilestoneNodeProps) {
  const config = stateConfig[state];

  return (
    <div style={{ display: 'flex', gap: '14px', position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <button
          onClick={onClick}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: config.nodeBackground,
            border: isActive ? `2.5px solid #8C5A3C` : config.nodeBorder,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: onClick ? 'pointer' : 'default',
            boxShadow: isActive ? '0 0 0 4px rgba(140,90,60,0.1)' : 'none',
            transition: 'box-shadow 0.2s ease',
            flexShrink: 0,
          }}
        >
          {state === 'mastered' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M5 12L10 17L19 7" stroke="#FAF7F3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : state === 'working' ? (
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#C9A96E' }} />
          ) : (
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#EDE7DF' }} />
          )}
        </button>

        {!isLast && (
          <div
            style={{
              width: '2px',
              flex: 1,
              minHeight: '24px',
              background: state === 'mastered' ? '#8C5A3C' : '#EDE7DF',
              margin: '4px 0',
              borderRadius: '1px',
            }}
          />
        )}
      </div>

      <div
        style={{
          flex: 1,
          paddingBottom: isLast ? 0 : '20px',
          cursor: onClick ? 'pointer' : 'default',
        }}
        onClick={onClick}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span
            style={{
              fontFamily: state === 'mastered' ? "'Playfair Display', serif" : "'DM Sans', sans-serif",
              fontStyle: state === 'mastered' ? 'italic' : 'normal',
              fontSize: '15px',
              fontWeight: state === 'untouched' ? 400 : 500,
              color: config.labelColor,
            }}
          >
            {name}
          </span>

          <span
            style={{
              fontSize: '10px',
              fontWeight: 500,
              color: config.pillText,
              background: config.pillBackground,
              borderRadius: '20px',
              padding: '3px 8px',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {config.pillLabel}
          </span>
        </div>

        {state === 'working' && (
          <div style={{ marginBottom: '6px' }}>
            <div
              style={{
                height: '4px',
                background: '#F0EBE4',
                borderRadius: '2px',
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(ridesConsistent / ridesRequired) * 100}%`,
                  background: '#C9A96E',
                  borderRadius: '2px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '10px',
                color: '#B5A898',
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {ridesConsistent}/{ridesRequired} rides consistent
            </div>
          </div>
        )}

        {isActive && state !== 'untouched' && (
          <div style={{ fontSize: '11px', color: '#8C5A3C', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
            Tap to view exercises →
          </div>
        )}
      </div>
    </div>
  );
}
