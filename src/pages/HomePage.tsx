import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CadenceInsightCard from '../components/ui/CadenceInsightCard';
import { useCadence } from '../context/CadenceContext';
import {
  mockRider,
  mockGoal,
  mockRides,
  mockWeek,
  biometricsTrend,
  cadenceInsights,
} from '../data/mock';
import { getUserProfile, isProfileComplete } from '../lib/userProfile';
import ProfileSetupModal from '../components/ProfileSetupModal';

// ─── Atmospheric hero placeholder ─────────────────────────────────────────────
// Replace the gradient hero with a real photo by swapping this component.
// Photo spec: equestrian rider in motion, warm light, 430×280px, editorial feel.

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function HeroPlaceholder() {
  const activeMilestone = mockGoal.milestones.find(m => m.state === 'working');
  const profile = getUserProfile();
  const displayName = profile.firstName || 'Rider';
  const horseName = profile.horseName || mockRider.horse;
  const discipline = profile.discipline || mockRider.track;

  return (
    <div style={{ height: '290px', position: 'relative', overflow: 'hidden', background: '#2A1F15' }}>
      {/* Real hero photo */}
      <img
        src={`${import.meta.env.BASE_URL}hero.jpg`}
        alt=""
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          objectPosition: 'center 35%',
        }}
      />

      {/* Dark overlay — top to bottom, light at top, dark at bottom for text */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(20,14,8,0.15) 0%, rgba(20,14,8,0.10) 40%, rgba(20,14,8,0.65) 80%, rgba(20,14,8,0.82) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Horsera wordmark — top left */}
      <div style={{ position: 'absolute', top: 18, left: 20 }}>
        <p style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: '14px',
          color: 'rgba(250,247,243,0.70)',
          letterSpacing: '0.06em',
        }}>
          Horsera
        </p>
      </div>

      {/* Content — bottom of hero */}
      <div style={{ position: 'absolute', bottom: 22, left: 20, right: 20 }}>
        <p style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '9.5px',
          color: 'rgba(201,169,110,0.90)',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginBottom: '6px',
        }}>
          {discipline === 'usdf' ? 'USDF Dressage' : discipline === 'pony-club' ? 'Pony Club' : 'Hunter/Jumper'} · with {horseName}
        </p>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: '28px',
          fontWeight: 400,
          color: '#FAF7F3',
          lineHeight: 1.1,
          marginBottom: '4px',
          textShadow: '0 1px 8px rgba(0,0,0,0.30)',
        }}>
          {getGreeting()},<br />{displayName}.
        </h1>
        {activeMilestone && (
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '12px',
            color: 'rgba(250,247,243,0.75)',
            marginTop: '6px',
          }}>
            Focus: {activeMilestone.name} · {activeMilestone.ridesConsistent}/{activeMilestone.ridesRequired} rides
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Weekly ride frequency bar ────────────────────────────────────────────────

function WeekBar() {
  const maxDuration = Math.max(...mockWeek.filter(d => d.ridden).map(d => d.duration || 0));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '36px' }}>
      {mockWeek.map((day, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '100%',
            height: day.ridden ? `${Math.round((day.duration! / maxDuration) * 28) + 6}px` : '4px',
            background: day.isToday
              ? '#8C5A3C'
              : day.ridden
              ? '#C9A96E'
              : '#EDE7DF',
            borderRadius: '3px',
            transition: 'height 0.3s ease',
            alignSelf: 'flex-end',
          }} />
          <span style={{
            fontSize: '9px',
            color: day.isToday ? '#8C5A3C' : '#B5A898',
            fontFamily: "'DM Mono', monospace",
            fontWeight: day.isToday ? 600 : 400,
          }}>
            {day.day}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const navigate = useNavigate();
  const { openCadence } = useCadence();
  const [showProfileSetup, setShowProfileSetup] = useState(!isProfileComplete());

  const latestRide = mockRides[0];
  const activeMilestone = mockGoal.milestones.find(m => m.state === 'working');
  const latestBiometrics = biometricsTrend[biometricsTrend.length - 1];
  const ridesThisWeek = mockWeek.filter(d => d.ridden).length;

  const signalConfig = {
    improving:    { color: '#7D9B76', symbol: '↑', label: 'Improving' },
    consistent:   { color: '#C9A96E', symbol: '→', label: 'Consistent' },
    'needs-work': { color: '#C4714A', symbol: '↓', label: 'Needs work' },
  };

  const metricTiles = [
    { label: 'Lower Leg',  value: Math.round(latestBiometrics.lowerLeg * 100),  color: '#8C5A3C' },
    { label: 'Reins',      value: Math.round(latestBiometrics.reins * 100),      color: '#C9A96E' },
    { label: 'Core',       value: Math.round(latestBiometrics.core * 100),       color: '#7D9B76' },
    { label: 'Posture',    value: Math.round(latestBiometrics.upperBody * 100),  color: '#6B7FA3' },
  ];

  return (
    <div style={{ background: '#FAF7F3', minHeight: '100%' }}>

      {/* Hero */}
      <HeroPlaceholder />

      <div style={{ padding: '4px 20px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ── Next step CTA ── */}
        {activeMilestone && (
          <button
            onClick={() => navigate('/rides')}
            style={{
              width: '100%', textAlign: 'left',
              background: '#8C5A3C',
              borderRadius: '18px',
              padding: '16px 18px',
              border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(140,90,60,0.25)',
            }}
          >
            <p style={{
              fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'rgba(250,247,243,0.6)',
              fontFamily: "'DM Sans', sans-serif", marginBottom: '5px',
            }}>
              Today's Focus
            </p>
            <p style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: '18px', fontWeight: 400,
              color: '#FAF7F3', lineHeight: 1.25, marginBottom: '4px',
            }}>
              {activeMilestone.name}
            </p>
            <p style={{
              fontSize: '12px', color: 'rgba(201,169,110,0.85)',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {activeMilestone.performanceTasks[0]} · {activeMilestone.ridesConsistent}/{activeMilestone.ridesRequired} rides consistent →
            </p>
          </button>
        )}

        {/* ── Cadence insight ── */}
        <CadenceInsightCard text={cadenceInsights.home} />

        {/* ── Your Position snapshot ── */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#B5A898',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              Your Position
            </p>
            <button
              onClick={() => navigate('/insights')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#8C5A3C', fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}
            >
              View trends →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {metricTiles.map(tile => (
              <div key={tile.label} style={{
                background: '#FFFFFF',
                borderRadius: '14px',
                padding: '10px 8px',
                textAlign: 'center',
                boxShadow: '0 1px 6px rgba(26,20,14,0.05)',
              }}>
                <p style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '17px', fontWeight: 500,
                  color: tile.color, marginBottom: '3px',
                }}>
                  {tile.value}
                </p>
                <p style={{ fontSize: '9px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>
                  {tile.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Most recent ride ── */}
        {latestRide && (
          <section>
            <p style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#B5A898',
              fontFamily: "'DM Sans', sans-serif", marginBottom: '10px',
            }}>
              Last Ride
            </p>
            <button
              onClick={() => navigate(`/rides/${latestRide.id}`)}
              style={{
                width: '100%', textAlign: 'left',
                background: '#FFFFFF', borderRadius: '16px', padding: '14px 16px',
                border: 'none', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(26,20,14,0.05)',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: signalConfig[latestRide.signal].color,
              }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 500, color: '#1A140E', fontFamily: "'DM Sans', sans-serif", marginBottom: '2px' }}>
                  {latestRide.focusMilestone}
                </p>
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: '10.5px', color: '#B5A898' }}>
                  {new Date(latestRide.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {latestRide.duration}min · {signalConfig[latestRide.signal].label}
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M9 6l6 6-6 6" stroke="#D4C9BC" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          </section>
        )}

        {/* ── This week ── */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#B5A898',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              This Week
            </p>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#8C5A3C', fontWeight: 500 }}>
              {ridesThisWeek} / 7
            </span>
          </div>
          <div style={{
            background: '#FFFFFF', borderRadius: '14px', padding: '12px 14px',
            boxShadow: '0 1px 6px rgba(26,20,14,0.05)',
          }}>
            <WeekBar />
          </div>
        </section>

        {/* ── Upcoming competition ── */}
        {mockRider.upcomingCompetition && (
          <section>
            <p style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#B5A898',
              fontFamily: "'DM Sans', sans-serif", marginBottom: '10px',
            }}>
              Upcoming
            </p>
            <div style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '14px 16px',
              boxShadow: '0 2px 8px rgba(26,20,14,0.05)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 500, color: '#1A140E', fontFamily: "'DM Sans', sans-serif", marginBottom: '2px' }}>
                  {mockRider.upcomingCompetition.name}
                </p>
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: '10.5px', color: '#B5A898' }}>
                  {mockRider.upcomingCompetition.level} · {mockRider.upcomingCompetition.tests.join(', ')}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: '20px', fontWeight: 500, color: '#8C5A3C', lineHeight: 1 }}>
                  {mockRider.upcomingCompetition.daysAway}
                </p>
                <p style={{ fontSize: '9px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>days</p>
              </div>
            </div>
          </section>
        )}

        {/* ── Ask Cadence ── */}
        <button
          onClick={openCadence}
          style={{
            width: '100%', textAlign: 'left',
            background: '#F1F4FA', borderRadius: '16px', padding: '14px 16px',
            border: '1px solid rgba(107,127,163,0.15)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '12px',
            boxShadow: '0 1px 6px rgba(26,20,14,0.04)',
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: '10px',
            background: '#6B7FA3',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#EEF2F8' }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#1A140E', fontFamily: "'DM Sans', sans-serif", marginBottom: '1px' }}>
              Ask Cadence
            </p>
            <p style={{ fontSize: '11px', color: '#6B7FA3', fontFamily: "'DM Sans', sans-serif" }}>
              Your intelligent riding advisor
            </p>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M9 6l6 6-6 6" stroke="#6B7FA3" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>

      </div>

      {/* Profile setup modal — first visit */}
      {showProfileSetup && (
        <ProfileSetupModal onComplete={() => setShowProfileSetup(false)} />
      )}
    </div>
  );
}
