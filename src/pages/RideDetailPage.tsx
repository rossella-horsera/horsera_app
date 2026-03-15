import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CadenceInsightCard from '../components/ui/CadenceInsightCard';
import VideoAnalysis from '../components/ui/VideoAnalysis';
import { useVideoAnalysis } from '../hooks/useVideoAnalysis';
import { generateInsights } from '../lib/poseAnalysis';
import { mockRides, mockGoal } from '../data/mock';
import { getHorseName } from '../lib/userProfile';
import { useCadence } from '../context/CadenceContext';

const signalConfig = {
  improving:    { color: '#7D9B76', symbol: '\u2191', label: 'Improving' },
  consistent:   { color: '#C9A96E', symbol: '\u2192', label: 'Consistent' },
  'needs-work': { color: '#C4714A', symbol: '\u2193', label: 'Needs work' },
};

const biometricsDisplay = [
  { key: 'lowerLegStability',  label: 'Lower Leg Stability',  group: 'Leg' },
  { key: 'reinSteadiness',     label: 'Rein Steadiness',      group: 'Hands' },
  { key: 'reinSymmetry',       label: 'Rein Symmetry',        group: 'Hands' },
  { key: 'coreStability',      label: 'Core Stability',       group: 'Core' },
  { key: 'upperBodyAlignment', label: 'Upper Body Alignment', group: 'Posture' },
  { key: 'pelvisStability',    label: 'Pelvis Stability',     group: 'Core' },
] as const;

const ridingQualityDisplay = [
  { key: 'rhythm',      label: 'Rhythm' },
  { key: 'relaxation',  label: 'Relaxation' },
  { key: 'contact',     label: 'Contact' },
  { key: 'impulsion',   label: 'Impulsion' },
  { key: 'straightness',label: 'Straightness' },
  { key: 'balance',     label: 'Balance' },
] as const;

export default function RideDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openCadence } = useCadence();
  const [metricsTab, setMetricsTab] = useState<'position' | 'quality'>('position');

  const ride = mockRides.find(r => r.id === id) || mockRides[0];
  const signal = signalConfig[ride.signal];
  const milestone = mockGoal.milestones.find(m => m.id === ride.milestoneId);

  const prevRide = mockRides.find(r => r.id !== ride.id && r.biometrics);
  const { status, progress, result, error, analyzeVideo } = useVideoAnalysis(prevRide?.biometrics);

  const d = new Date(ride.date);
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const scoreToLabel = (v: number) => {
    if (v >= 0.85) return { label: 'Excellent', color: '#7D9B76' };
    if (v >= 0.70) return { label: 'Good', color: '#8C5A3C' };
    if (v >= 0.55) return { label: 'Working', color: '#C9A96E' };
    return { label: 'Needs focus', color: '#C4714A' };
  };

  return (
    <div style={{ background: '#FAF7F3', minHeight: '100%' }}>

      {/* ── Back nav + header ── */}
      <div style={{ padding: '16px 20px 0' }}>
        <button
          onClick={() => navigate('/rides')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            color: '#8C5A3C', fontSize: '13px', fontWeight: 500,
            fontFamily: "'DM Sans', sans-serif", padding: 0, marginBottom: '16px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#8C5A3C" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          All Rides
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '24px', fontWeight: 400, color: '#1A140E', lineHeight: 1.2 }}>
            {dateStr}
          </h1>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '20px', color: signal.color }}>{signal.symbol}</div>
            <div style={{ fontSize: '9px', color: '#B5A898', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Sans', sans-serif" }}>
              {signal.label}
            </div>
          </div>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#B5A898', marginBottom: '16px' }}>
          {ride.horse || getHorseName('Horse')} \u00b7 {ride.duration} min \u00b7 {ride.type}
        </div>
      </div>

      {/* ── Video analysis — first, at the top ── */}
      <div style={{ padding: '0 20px', marginBottom: '8px' }}>
        {ride.videoUploaded ? (
          <VideoAnalysis
            hasVideo={ride.videoUploaded}
            analysisResult={result}
            analysisStatus={status}
            analysisProgress={progress}
            analysisError={error}
            onVideoSelected={analyzeVideo}
            mockBiometrics={ride.biometrics}
            mockInsights={ride.videoUploaded && ride.biometrics
              ? generateInsights(ride.biometrics, prevRide?.biometrics)
              : undefined}
          />
        ) : (
          /* Upload CTA for rides without video */
          <div
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'video/mp4,video/quicktime,.mp4,.mov';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) analyzeVideo(file);
              };
              input.click();
            }}
            style={{
              background: '#FFFFFF', borderRadius: '16px', padding: '20px',
              boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
              border: '1.5px dashed #EDE7DF', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 16,
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: '12px',
              background: 'rgba(140,90,60,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 4v12M6 10l6-6 6 6" stroke="#8C5A3C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 18h16" stroke="#8C5A3C" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13.5px', fontWeight: 600, color: '#1A140E', marginBottom: 2 }}>
                Add video to this ride
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11.5px', color: '#B5A898', lineHeight: 1.4 }}>
                Cadence analyses your position — private, on-device
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* ── Session focus ── */}
        <div style={{
          background: '#FFFFFF', borderRadius: '16px', padding: '16px',
          borderLeft: '4px solid #8C5A3C', boxShadow: '0 2px 10px rgba(26,20,14,0.06)',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#8C5A3C', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px' }}>
            Session focus
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: '17px', color: '#1A140E', marginBottom: '4px' }}>
            {ride.focusMilestone}
          </div>
          {milestone && (
            <div style={{ fontSize: '11px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>
              {milestone.ridingQuality} \u00b7 {milestone.performanceTasks[0]}
            </div>
          )}
        </div>

        {ride.reflection && (
          <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '8px' }}>
              Your reflection
            </div>
            <p style={{ fontSize: '13.5px', color: '#7A6B5D', lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>
              "{ride.reflection}"
            </p>
          </div>
        )}

        {ride.trainerFeedback && (
          <div style={{
            background: '#FFFFFF', borderRadius: '16px', padding: '16px',
            boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
            borderLeft: '3px solid #C9A96E',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: '8px' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#C9A96E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: '10px' }}>S</span>
              </div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#C9A96E', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif" }}>
                Trainer feedback
              </div>
              <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>
                Sarah M.
              </div>
            </div>
            <p style={{ fontSize: '13.5px', color: '#7A6B5D', lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>
              "{ride.trainerFeedback}"
            </p>
          </div>
        )}

        {ride.cadenceInsight && (
          <CadenceInsightCard text={ride.cadenceInsight} />
        )}

        {ride.biometrics && (
          <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>

            {/* ── Gait icons row ── */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #F0EBE4' }}>
              {[
                {
                  label: 'Walk',
                  svg: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="4" r="2" stroke="#7A6B5D" strokeWidth="1.4"/>
                      <path d="M12 6v5M10 9l-2 4M14 9l2 4M10 16l-1 4M14 16l1 4" stroke="#7A6B5D" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  ),
                },
                {
                  label: 'Trot',
                  svg: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="4" r="2" stroke="#7A6B5D" strokeWidth="1.4"/>
                      <path d="M12 6v5M9 8l-3 4M15 8l3 4M10 16l-2 4M14 16l2 4" stroke="#7A6B5D" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  ),
                },
                {
                  label: 'Canter',
                  svg: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="13" cy="4" r="2" stroke="#7A6B5D" strokeWidth="1.4"/>
                      <path d="M13 6l-1 5M10 8l-4 3M14 9l3 2M10 16l-2 4M13 15l2 5" stroke="#7A6B5D" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  ),
                },
              ].map(({ label, svg }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  {svg}
                  <span style={{ fontSize: '9px', fontFamily: "'DM Sans', sans-serif", color: '#B5A898', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
                </div>
              ))}
            </div>

            {/* ── Position / Riding Quality toggle ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{
                display: 'inline-flex', background: '#F0EBE4', borderRadius: '10px', padding: '3px',
              }}>
                {(['position', 'quality'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setMetricsTab(tab)}
                    style={{
                      padding: '5px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                      fontSize: '11px', fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                      background: metricsTab === tab ? '#8C5A3C' : 'transparent',
                      color: metricsTab === tab ? '#FAF7F3' : '#7A6B5D',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tab === 'position' ? 'Your Position' : 'Riding Quality'}
                  </button>
                ))}
              </div>
              <div style={{
                fontSize: '10px', color: '#6B7FA3',
                background: 'rgba(107,127,163,0.10)',
                padding: '3px 8px', borderRadius: '8px',
                fontFamily: "'DM Sans', sans-serif",
                borderLeft: '2px solid rgba(107,127,163,0.4)',
              }}>
                Position read by Cadence
              </div>
            </div>

            {metricsTab === 'position' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {biometricsDisplay.map(({ key, label }) => {
                  const value = ride.biometrics![key];
                  const { color, label: scoreLabel } = scoreToLabel(value);
                  return (
                    <div key={key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12.5px', color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
                        <span style={{ fontSize: '11px', color, fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>{scoreLabel}</span>
                      </div>
                      <div style={{ height: '5px', background: '#F0EBE4', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${value * 100}%`,
                          background: color, borderRadius: '3px',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {metricsTab === 'quality' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {ridingQualityDisplay.map(({ key, label }) => {
                  const rq = (result?.biometrics as Record<string, number> | null | undefined);
                  const value = rq?.[key] ?? (ride.biometrics ? Object.values(ride.biometrics).reduce((a, b) => a + b, 0) / Object.values(ride.biometrics).length * 0.9 : 0.65);
                  const { color, label: scoreLabel } = scoreToLabel(value);
                  return (
                    <div key={key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12.5px', color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
                        <span style={{ fontSize: '11px', color, fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>{scoreLabel}</span>
                      </div>
                      <div style={{ height: '5px', background: '#F0EBE4', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${value * 100}%`,
                          background: color, borderRadius: '3px',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Ask Cadence about this ride ── */}
        <button
          onClick={openCadence}
          style={{
            width: '100%', padding: '14px 20px',
            background: 'transparent',
            border: '1.5px solid rgba(107,127,163,0.35)',
            borderRadius: '14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontFamily: "'DM Sans', sans-serif",
            marginTop: '4px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect x="2" y="10" width="3.2" height="8" rx="1.6" fill="rgba(107,127,163,0.6)" />
            <rect x="7" y="6" width="3.2" height="16" rx="1.6" fill="rgba(107,127,163,0.8)" />
            <rect x="12" y="3" width="3.6" height="22" rx="1.8" fill="#6B7FA3" />
            <rect x="17.4" y="7" width="3.2" height="14" rx="1.6" fill="rgba(107,127,163,0.75)" />
            <rect x="22.8" y="11" width="3.2" height="6" rx="1.6" fill="rgba(107,127,163,0.5)" />
          </svg>
          <span style={{ fontSize: '13.5px', fontWeight: 500, color: '#6B7FA3' }}>
            Ask Cadence about this ride
          </span>
        </button>

      </div>
    </div>
  );
}
