import { useState } from 'react';
import { saveUserProfile } from '../lib/userProfile';

const COLORS = {
  parchment: '#FAF7F3',
  cognac: '#8C5A3C',
  champagne: '#C9A96E',
  charcoal: '#1A140E',
  muted: '#B5A898',
  border: '#EDE7DF',
  softBg: '#F0EBE4',
};

const FONTS = {
  heading: "'Playfair Display', serif",
  body: "'DM Sans', sans-serif",
  mono: "'DM Mono', monospace",
};

const DISCIPLINES = [
  { value: 'usdf' as const, label: 'USDF Dressage' },
  { value: 'pony-club' as const, label: 'Pony Club' },
  { value: 'hunter-jumper' as const, label: 'Hunter / Jumper' },
  { value: 'a-bit-of-everything' as const, label: 'A Bit of Everything' },
];

interface ProfileSetupModalProps {
  onComplete?: () => void;
  open?: boolean;
  onClose?: () => void;
}

export default function ProfileSetupModal({ onComplete, open, onClose }: ProfileSetupModalProps) {
  const [firstName, setFirstName] = useState('');
  const [horseName, setHorseName] = useState('');
  const [discipline, setDiscipline] = useState<'usdf' | 'pony-club' | 'hunter-jumper' | 'a-bit-of-everything'>('usdf');

  // Support both prop patterns: { onComplete } and { open, onClose }
  const isVisible = open !== undefined ? open : true;
  const handleDismiss = onClose || onComplete || (() => {});

  const handleSave = () => {
    if (!firstName.trim()) return;
    saveUserProfile({
      firstName: firstName.trim(),
      horseName: horseName.trim(),
      discipline,
      isOnboarded: true,
    });
    handleDismiss();
  };

  if (!isVisible) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(26,20,14,0.5)',
      zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: COLORS.parchment,
        borderRadius: '24px',
        padding: '32px 24px',
        maxWidth: 380,
        width: '100%',
        boxShadow: '0 16px 48px rgba(26,20,14,0.2)',
      }}>
        {/* Branding */}
        <div style={{
          fontFamily: FONTS.heading,
          fontSize: '14px',
          color: COLORS.champagne,
          letterSpacing: '0.06em',
          marginBottom: '8px',
        }}>
          Horsera
        </div>

        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: '24px',
          fontWeight: 400,
          color: COLORS.charcoal,
          marginBottom: '6px',
          lineHeight: 1.2,
        }}>
          Welcome, rider.
        </h2>

        <p style={{
          fontFamily: FONTS.body,
          fontSize: '13px',
          color: COLORS.muted,
          lineHeight: 1.5,
          marginBottom: '24px',
        }}>
          Tell us a little about yourself so Cadence can personalize your experience.
        </p>

        {/* First Name */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 600, color: COLORS.muted,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: FONTS.body, display: 'block', marginBottom: '8px',
          }}>
            Your First Name
          </label>
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="e.g. Rossella"
            style={{
              width: '100%', padding: '12px 14px',
              borderRadius: '12px', border: `1.5px solid ${COLORS.border}`,
              fontSize: '14px', color: COLORS.charcoal,
              fontFamily: FONTS.body, outline: 'none',
              background: '#FFFFFF', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Horse Name */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 600, color: COLORS.muted,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: FONTS.body, display: 'block', marginBottom: '8px',
          }}>
            Horse's Name
          </label>
          <input
            value={horseName}
            onChange={e => setHorseName(e.target.value)}
            placeholder="e.g. Allegra"
            style={{
              width: '100%', padding: '12px 14px',
              borderRadius: '12px', border: `1.5px solid ${COLORS.border}`,
              fontSize: '14px', color: COLORS.charcoal,
              fontFamily: FONTS.body, outline: 'none',
              background: '#FFFFFF', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Discipline */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 600, color: COLORS.muted,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: FONTS.body, display: 'block', marginBottom: '8px',
          }}>
            Discipline
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {DISCIPLINES.map(d => (
              <button
                key={d.value}
                onClick={() => setDiscipline(d.value)}
                style={{
                  padding: '10px 6px',
                  borderRadius: '10px', border: 'none', cursor: 'pointer',
                  background: discipline === d.value ? COLORS.cognac : COLORS.softBg,
                  color: discipline === d.value ? COLORS.parchment : '#7A6B5D',
                  fontSize: '11px', fontWeight: 600,
                  fontFamily: FONTS.body,
                  transition: 'all 0.15s',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleSave}
          disabled={!firstName.trim()}
          style={{
            width: '100%',
            background: firstName.trim() ? COLORS.cognac : COLORS.softBg,
            color: firstName.trim() ? COLORS.parchment : COLORS.muted,
            border: 'none', borderRadius: '14px', padding: '14px',
            fontSize: '15px', fontWeight: 600, cursor: firstName.trim() ? 'pointer' : 'default',
            fontFamily: FONTS.body,
            boxShadow: firstName.trim() ? '0 4px 16px rgba(140,90,60,0.25)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          Let's Begin
        </button>
      </div>
    </div>
  );
}
