interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  label: string;
  sublabel: string;
  sublabelCaption?: string;
  color?: string;
  trackColor?: string;
}

export default function ProgressRing({
  progress,
  size = 190,
  strokeWidth = 13,
  label,
  sublabel,
  sublabelCaption = 'rides',
  color = '#8C5A3C',
  trackColor = '#EDE7DF',
}: ProgressRingProps) {
  const viewSize = 200;
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const r = 80;
  const circumference = 2 * Math.PI * r;

  const arcAngle = 270;
  const arcLength = (arcAngle / 360) * circumference;
  const innerR = 66;
  const innerCircumference = 2 * Math.PI * innerR;
  const innerArcLength = (arcAngle / 360) * innerCircumference;
  const progressLength = Math.max(0, Math.min(progress, 1)) * arcLength;
  const rotation = 135;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(140,90,60,0.07) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      <svg
        viewBox={`0 0 ${viewSize} ${viewSize}`}
        width={size}
        height={size}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <circle
          cx={cx} cy={cy} r={r + 12}
          stroke="rgba(140,90,60,0.05)"
          strokeWidth="1"
          fill="none"
        />

        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${cx} ${cy})`}
        />

        <circle
          cx={cx} cy={cy} r={innerR}
          fill="none"
          stroke="rgba(201,169,110,0.18)"
          strokeWidth="1.5"
          strokeDasharray={`${innerArcLength} ${innerCircumference}`}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${cx} ${cy})`}
        />

        {progressLength > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${progressLength} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        )}

        {progressLength > 8 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="#C9A96E"
            strokeWidth={strokeWidth}
            strokeDasharray={`4 ${circumference}`}
            strokeDashoffset={-(progressLength - 4)}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${cx} ${cy})`}
            opacity="0.7"
          />
        )}
      </svg>

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          textAlign: 'center',
          padding: '0 20px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: size > 150 ? '13.5px' : '11px',
            fontWeight: 500,
            color: '#1A140E',
            lineHeight: 1.3,
            marginBottom: '6px',
          }}
        >
          {label}
        </div>
        <div
          style={{
            width: '24px',
            height: '1px',
            background: '#D4C9BC',
            margin: '0 auto 6px',
          }}
        />
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: size > 150 ? '19px' : '14px',
            fontWeight: 500,
            color: color,
            lineHeight: 1,
            marginBottom: '2px',
          }}
        >
          {sublabel}
        </div>
        {sublabelCaption && (
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '9px',
              color: '#B5A898',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {sublabelCaption}
          </div>
        )}
      </div>
    </div>
  );
}
