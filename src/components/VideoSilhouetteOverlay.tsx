import { useState } from 'react';
import type { BiometricsSnapshot } from '../data/mock';

const COLORS = {
  parchment: '#FAF7F3',
  green: '#7D9B76',
  champagne: '#C9A96E',
  attention: '#C4714A',
};

function scoreColor(score: number): string {
  if (score >= 0.80) return COLORS.green;
  if (score >= 0.60) return COLORS.champagne;
  return COLORS.attention;
}

interface VideoSilhouetteOverlayProps {
  biometrics: BiometricsSnapshot;
}

export default function VideoSilhouetteOverlay({ biometrics }: VideoSilhouetteOverlayProps) {
  const [visible, setVisible] = useState(true);

  const upperBodyColor = scoreColor(biometrics.upperBodyAlignment);
  const coreColor = scoreColor(biometrics.coreStability);
  const reinColor = scoreColor(biometrics.reinSteadiness);
  const pelvisColor = scoreColor(biometrics.pelvisStability);
  const lowerLegColor = scoreColor(biometrics.lowerLegStability);

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0,
      width: '30%', height: '100%',
      pointerEvents: 'none',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Toggle button */}
      <button
        onClick={() => setVisible(v => !v)}
        style={{
          position: 'absolute', top: 8, right: 8,
          width: 28, height: 28, borderRadius: '50%',
          background: 'rgba(26,20,14,0.6)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'auto',
          zIndex: 2,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          {visible ? (
            <>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke={COLORS.parchment} strokeWidth="1.5" />
              <circle cx="12" cy="12" r="3" stroke={COLORS.parchment} strokeWidth="1.5" />
            </>
          ) : (
            <>
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" stroke={COLORS.parchment} strokeWidth="1.5" strokeLinecap="round" />
              <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" stroke={COLORS.parchment} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="1" x2="23" y2="23" stroke={COLORS.parchment} strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>

      {visible && (
        <svg
          viewBox="0 0 100 220"
          width="80%"
          style={{ opacity: 0.6 }}
        >
          {/* Head / helmet (not scored) */}
          <ellipse cx="50" cy="22" rx="12" ry="14" fill="rgba(250,247,243,0.5)" />

          {/* Neck */}
          <rect x="46" y="36" width="8" height="10" fill="rgba(250,247,243,0.4)" rx="3" />

          {/* Upper body / shoulders */}
          <path
            d="M30 46 Q50 42 70 46 L68 80 Q50 82 32 80 Z"
            fill={upperBodyColor}
            opacity="0.8"
          />

          {/* Core / torso */}
          <path
            d="M32 80 Q50 82 68 80 L65 115 Q50 118 35 115 Z"
            fill={coreColor}
            opacity="0.8"
          />

          {/* Arms / hands (left) */}
          <path
            d="M30 46 L18 72 L16 90 L22 90 L24 74 L30 56"
            fill={reinColor}
            opacity="0.7"
            strokeLinejoin="round"
          />

          {/* Arms / hands (right) */}
          <path
            d="M70 46 L82 72 L84 90 L78 90 L76 74 L70 56"
            fill={reinColor}
            opacity="0.7"
            strokeLinejoin="round"
          />

          {/* Pelvis / seat */}
          <path
            d="M35 115 Q50 118 65 115 L62 135 Q50 140 38 135 Z"
            fill={pelvisColor}
            opacity="0.8"
          />

          {/* Left leg */}
          <path
            d="M38 135 L32 170 L28 210 L36 210 L38 172 L42 140"
            fill={lowerLegColor}
            opacity="0.7"
            strokeLinejoin="round"
          />

          {/* Right leg */}
          <path
            d="M62 135 L68 170 L72 210 L64 210 L62 172 L58 140"
            fill={lowerLegColor}
            opacity="0.7"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
