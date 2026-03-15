import { useParams, useNavigate } from 'react-router-dom';
import CadenceInsightCard from '../components/ui/CadenceInsightCard';
import VideoAnalysis from '../components/ui/VideoAnalysis';
import { useVideoAnalysis } from '../hooks/useVideoAnalysis';
import { generateInsights } from '../lib/poseAnalysis';
import { mockRides, mockGoal } from '../data/mock';
import { getHorseName } from '../lib/userProfile';

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

export default function RideDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ride = mockRides.find(r => r.id === id) || mockRides[0];
  const signal = signalConfig[ride.signal];
  const milestone = mockGoal.milestones.find(m => m.id === ride.milestoneId);

  // Previous ride biometrics — used by the analysis hook to compute trend arrows
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

      <div style={{ padding: '16px 20px 0', paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))' }}>
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
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#B5A898', marginBottom: '20px' }}>
          {ride.horse || getHorseName('Horse')} \u00b7 {ride.duration} min \u00b7 {ride.type}
        </div>
      </div>

      <div style={{ padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        <div style={{
          background: '#FFFFFF', borderRadius: '16px', padding: '16px',
          borderLeft: '4px solid #8C5A3C', boxShadow: '0 2px 10px rgba(26,20,14,0.06)',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#8C5A3C', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px' }}>
            Focus Milestone
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
              My Reflection
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
                Trainer Feedback
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif" }}>
                Your Position
              </div>
              <div style={{ fontSize: '10px', color: '#6B7FA3', background: '#F1F4FA', padding: '3px 8px', borderRadius: '8px', fontFamily: "'DM Sans', sans-serif" }}>
                AI-assisted \u00b7 Sample Data
              </div>
            </div>

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
          </div>
        )}

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

      </div>
    </div>
  );
}