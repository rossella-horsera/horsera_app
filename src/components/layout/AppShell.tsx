import React, { useState } from 'react';
import BottomNav from './BottomNav';
import CadenceFAB from './CadenceFAB';
import { CadenceProvider, useCadence } from '../../context/CadenceContext';
import { getUserProfile, isProfileComplete } from '../../lib/userProfile';
import ProfileSettingsPanel from '../ProfileSettingsPanel';
import ProfileSetupModal from '../ProfileSetupModal';
import { safeStorage } from '../../lib/safeStorage';

/** Profile avatar — shows photo if available, otherwise initials */
function ProfileAvatar({ initial }: { initial: string }) {
  const photo = safeStorage.getItem('horsera_profile_photo');
  if (photo) {
    return (
      <img
        src={photo}
        alt="Profile"
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
      />
    );
  }
  return <span style={{ fontSize: '13px', fontWeight: 600, color: '#FAF7F3', fontFamily: "'DM Sans', sans-serif", lineHeight: 1 }}>{initial}</span>;
}

interface AppShellProps {
  children: React.ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const { openCadence, isStreaming, speechState } = useCadence();
  const [showSettings, setShowSettings] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(isProfileComplete);
  const profile = getUserProfile();
  const initial = profile.firstName ? profile.firstName[0].toUpperCase() : '?';

  // Show onboarding modal before any app content if profile not yet set
  if (!onboardingDone) {
    return (
      <ProfileSetupModal onComplete={() => setOnboardingDone(true)} />
    );
  }

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        height: '100dvh',
        background: '#FAF7F3',
        fontFamily: "'DM Sans', sans-serif",
        maxWidth: '430px',
        margin: '0 auto',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #FAF7F3; }
        ::-webkit-scrollbar { display: none; }
        scrollbar-width: none;
        /* #60 — Branded Champagne pulse loader */
        @keyframes champagnePulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        /* #60 — safe-area helpers */
        .safe-top    { padding-top:    env(safe-area-inset-top,    0px); }
        .safe-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }
        @keyframes cadence-breathe {
          0%   { transform: scale(1);    opacity: 1; }
          38%  { transform: scale(1.13); opacity: 0.85; }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes cadence-glow {
          0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.28), 0 0 0 1px rgba(201,169,110,0.18), 0 0 0px rgba(201,169,110,0); }
          38%  { box-shadow: 0 4px 20px rgba(0,0,0,0.28), 0 0 0 1px rgba(201,169,110,0.50), 0 0 28px rgba(201,169,110,0.32); }
          100% { box-shadow: 0 4px 20px rgba(0,0,0,0.28), 0 0 0 1px rgba(201,169,110,0.18), 0 0 0px rgba(201,169,110,0); }
        }
        @keyframes cadence-ripple {
          0%   { transform: scale(1);   opacity: 0.45; }
          80%  { transform: scale(1.85); opacity: 0; }
          100% { transform: scale(1.85); opacity: 0; }
        }
        @keyframes cadence-bar-left {
          0%, 100% { height: 10px; opacity: 0.85; }
          45%      { height: 15px; opacity: 1; }
        }
        @keyframes cadence-bar-center {
          0%, 100% { height: 16px; opacity: 0.9; }
          50%      { height: 10px; opacity: 0.75; }
        }
        @keyframes cadence-bar-right {
          0%, 100% { height: 12px; opacity: 0.85; }
          40%      { height: 8px;  opacity: 0.7; }
          70%      { height: 16px; opacity: 1; }
        }
      `}</style>

      {/* ── Top header bar — Horsera brand mark ── */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: '430px',
        minHeight: '48px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'rgba(250,247,243,0.95)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid #EDE7DF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        flexShrink: 0,
      }}>
        <img
          src={`${import.meta.env.BASE_URL}horsera-logo.png`}
          alt="Horsera"
          style={{ height: '30px', width: 'auto', display: 'block' }}
        />
        <button
          onClick={() => setShowSettings(true)}
          style={{
            position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
            width: 32, height: 32,
            minWidth: 32, minHeight: 32,
            borderRadius: '50%',
            background: '#8C5A3C', color: '#FAF7F3', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '13px', fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            padding: 0,
            flexShrink: 0,
            overflow: 'hidden',
          }}
          aria-label="Profile settings"
          id="profile-avatar-btn"
        >
          <ProfileAvatar initial={initial} />
        </button>
      </header>

      <ProfileSettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />

      <main
        className="flex-1 overflow-y-auto"
        style={{
          paddingBottom: 'calc(82px + env(safe-area-inset-bottom, 0px))',
          paddingTop: 'calc(48px + env(safe-area-inset-top, 0px))',
        }}
      >
        {children}
      </main>

      <BottomNav />
      <CadenceFAB
        onClick={openCadence}
        isActive={isStreaming}
        isListening={speechState === 'listening'}
      />
    </div>
  );
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <CadenceProvider>
      <AppShellInner>{children}</AppShellInner>
    </CadenceProvider>
  );
}