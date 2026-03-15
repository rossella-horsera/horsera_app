import { useState } from 'react';
import { biometricsTrend, mockGoal, cadenceInsights, mockRides } from '../data/mock';
import { computeRidingQualities } from '../lib/poseAnalysis';
import type { BiometricsSnapshot } from '../data/mock';
import CadenceInsightCard from '../components/ui/CadenceInsightCard';
import { getRides } from '../lib/storage';

type TabId = 'trends' | 'milestones' | 'patterns';

const METRIC_CONFIG = [
  { key: 'lowerLeg',   label: 'Lower Leg',   color: '#8C5A3C' },
  { key: 'reins',      label: 'Reins',        color: '#C9A96E' },
  { key: 'core',       label: 'Core',         color: '#7D9B76' },
  { key: 'upperBody',  label: 'Upper Body',   color: '#6B7FA3' },
  { key: 'pelvis',     label: 'Pelvis',       color: '#B5A898' },
] as const;

type MetricKey = typeof METRIC_CONFIG[number]['key'];

function SparkLine({ data, color }: { data: number[]; color: string }) {
  const w = 80, h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.01;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {data.length > 0 && (() => {
        const last = data[data.length - 1];
        const x = w;
        const y = h - ((last - min) / range) * (h - 4) - 2;
        return <circle cx={x} cy={y} r="2.5" fill={color} />;
      })()}
    </svg>
  );
}

function TrendChart({
  data,
  activeMetrics,
}: {
  data: typeof biometricsTrend;
  activeMetrics: Set<MetricKey>;
}) {
  const W = 320, H = 140;
  const padL = 28, padR = 8, padT = 8, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const yTicks = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  const xPos = (i: number) => padL + (i / (data.length - 1)) * chartW;
  const yPos = (v: number) => padT + chartH - ((v - 0.5) / 0.5) * chartH;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ overflow: 'visible', display: 'block' }}
    >
      {yTicks.map(t => (
        <g key={t}>
          <line
            x1={padL} y1={yPos(t)} x2={W - padR} y2={yPos(t)}
            stroke="#EDE7DF" strokeWidth="0.8"
          />
          <text
            x={padL - 4} y={yPos(t) + 4}
            fontSize="8" fill="#B5A898" textAnchor="end"
            fontFamily="'DM Mono', monospace"
          >
            {Math.round(t * 100)}
          </text>
        </g>
      ))}

      {data.map((d, i) => (
        <text
          key={i}
          x={xPos(i)} y={H - 4}
          fontSize="7.5" fill="#B5A898" textAnchor="middle"
          fontFamily="'DM Sans', sans-serif"
        >
          {d.date.replace('Feb ', 'F').replace('Mar ', 'M')}
        </text>
      ))}

      {METRIC_CONFIG.map(({ key, color }) => {
        if (!activeMetrics.has(key)) return null;
        const pts = data.map((d, i) =>
          `${xPos(i)},${yPos((d as unknown as Record<string, number>)[key])}`
        ).join(' ');
        return (
          <g key={key}>
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {data.map((d, i) => (
              <circle
                key={i}
                cx={xPos(i)}
                cy={yPos((d as unknown as Record<string, number>)[key])}
                r="2"
                fill={color}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function MetricSummaryRow({ metricKey, label, color, data }: {
  metricKey: MetricKey;
  label: string;
  color: string;
  data: typeof biometricsTrend;
}) {
  const values = data.map(d => (d as unknown as Record<string, number>)[metricKey]);
  const latest = values[values.length - 1];
  const first = values[0];
  const delta = latest - first;
  const latestPct = Math.round(latest * 100);
  const deltaPct = Math.round(delta * 100);
  const trend = delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat';

  const trendColor = trend === 'up' ? '#7D9B76' : trend === 'down' ? '#C4714A' : '#C9A96E';
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #F0EBE4' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '12.5px', color: '#1A140E', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
          {label}
        </div>
        <div style={{ fontSize: '10px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>
          {latestPct}% · <span style={{ color: trendColor }}>{trendSymbol} {Math.abs(deltaPct)}pts since Feb</span>
        </div>
      </div>
      <SparkLine data={values} color={color} />
    </div>
  );
}

function PatternsTab() {
  const signalCounts = { improving: 0, consistent: 0, 'needs-work': 0 };
  mockRides.forEach(r => signalCounts[r.signal]++);
  const total = mockRides.length;

  const patterns = [
    {
      icon: '🔁',
      title: 'Right-rein drift',
      detail: 'Your lower leg tends to drift forward on the right rein — visible in 4 of your last 5 rides.',
      color: '#C4714A',
      tag: 'Persistent',
    },
    {
      icon: '⏱',
      title: 'Warm-up pattern',
      detail: 'Rein steadiness consistently improves in the second half of every ride.',
      color: '#C9A96E',
      tag: 'Consistent',
    },
    {
      icon: '✓',
      title: 'Core is solid',
      detail: 'Core stability scores have been above 85% for 6 consecutive rides. This is mastered.',
      color: '#7D9B76',
      tag: 'Mastered',
    },
    {
      icon: '📈',
      title: '4-week trajectory',
      detail: 'All 5 biometric areas have improved over the past 4 weeks. Lower leg shows the most growth (+17pts).',
      color: '#8C5A3C',
      tag: 'Positive',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '12px' }}>
          Ride Signals — Last {total} Rides
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { label: 'Improving', count: signalCounts.improving, color: '#7D9B76', symbol: '↑' },
            { label: 'Consistent', count: signalCounts.consistent, color: '#C9A96E', symbol: '→' },
            { label: 'Needs work', count: signalCounts['needs-work'], color: '#C4714A', symbol: '↓' },
          ].map(({ label, count, color, symbol }) => (
            <div key={label} style={{ flex: 1, textAlign: 'center', background: '#FAF7F3', borderRadius: '10px', padding: '10px 4px' }}>
              <div style={{ fontSize: '20px', color, marginBottom: '2px' }}>{symbol}</div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#1A140E', fontFamily: "'DM Mono', monospace" }}>{count}</div>
              <div style={{ fontSize: '9px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {patterns.map((p, i) => (
        <div key={i} style={{
          background: '#FFFFFF', borderRadius: '16px', padding: '14px 16px',
          boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
          borderLeft: `3px solid ${p.color}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
            <span style={{ fontSize: '14px' }}>{p.icon}</span>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1A140E', fontFamily: "'DM Sans', sans-serif" }}>
              {p.title}
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: '9px', fontWeight: 600,
              color: p.color, background: `${p.color}18`,
              padding: '2px 7px', borderRadius: '6px',
              fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.06em',
            }}>
              {p.tag}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#7A6B5D', lineHeight: 1.55, fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
            {p.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

function trendToBiometrics(d: typeof biometricsTrend[0]): BiometricsSnapshot {
  return {
    lowerLegStability: d.lowerLeg,
    reinSteadiness: d.reins,
    reinSymmetry: d.reins * 0.85,
    coreStability: d.core,
    upperBodyAlignment: d.upperBody,
    pelvisStability: d.pelvis,
  };
}

const GLOSSARY_POSITION = [
  { term: 'Lower Leg Stability', def: 'Ankle drift relative to hip-line and stirrup pressure consistency.' },
  { term: 'Rein Steadiness', def: 'Hand movement amplitude and smoothness of contact.' },
  { term: 'Rein Symmetry', def: 'Left/right balance and lateral drift patterns.' },
  { term: 'Core Stability', def: 'Torso angle consistency and absorption of horse movement.' },
  { term: 'Upper Body Alignment', def: 'Shoulder-hip-heel line and forward/backward lean.' },
  { term: 'Pelvis Stability', def: 'Lateral tilt, rotational consistency, sitting trot absorption.' },
];

const GLOSSARY_QUALITY = [
  { term: 'Rhythm', def: 'Consistency of tempo across all gaits.' },
  { term: 'Relaxation', def: 'Freedom from tension in body and contact.' },
  { term: 'Contact', def: 'Steady, elastic connection through the reins.' },
  { term: 'Impulsion', def: 'Energy and thrust from the hindquarters.' },
  { term: 'Straightness', def: 'Alignment of forehand to hindquarters.' },
  { term: 'Balance', def: 'Self-carriage and distribution of weight.' },
];

const QUALITY_COLORS = ['#C9A96E', '#7D9B76', '#8C5A3C', '#C4714A', '#6B7FA3', '#B5A898'];

export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('trends');
  const [activeMetrics, setActiveMetrics] = useState<Set<MetricKey>>(
    new Set(['lowerLeg', 'reins', 'core'])
  );
  const [showGlossary, setShowGlossary] = useState(false);

  // Check if any real ride data exists (#60 empty state)
  const storedRides = getRides();
  const hasRideData = storedRides.length > 0 || mockRides.length > 0;

  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const latest = biometricsTrend[biometricsTrend.length - 1];
  const overallScore = Math.round(
    ((latest.lowerLeg + latest.reins + latest.core + latest.upperBody + latest.pelvis) / 5) * 100
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: 'trends', label: 'Trends' },
    { id: 'milestones', label: 'Milestones' },
    { id: 'patterns', label: 'Patterns' },
  ];

  // #60 — no data empty state
  if (!hasRideData) {
    return (
      <div style={{
        background: '#FAF7F3', minHeight: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>🎯</div>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: '22px', fontWeight: 400, color: '#1A140E',
          textAlign: 'center', marginBottom: '10px',
        }}>
          Insights
        </h1>
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '14px', color: '#7A6B5D',
          textAlign: 'center', lineHeight: 1.6, maxWidth: '260px',
        }}>
          Ride insights appear after your first analysis.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: '#FAF7F3', minHeight: '100%' }}>

      <div style={{ padding: '20px 20px 0' }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '26px', fontWeight: 400, color: '#1A140E', marginBottom: '4px' }}>
          Insights
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px' }}>
          <p style={{ fontSize: '12px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
            4-week position overview
          </p>
          <button
            onClick={() => setShowGlossary(g => !g)}
            style={{
              background: showGlossary ? '#8C5A3C' : '#F0EBE4',
              border: 'none', borderRadius: '8px', padding: '3px 9px',
              cursor: 'pointer', fontSize: '10px', fontWeight: 600,
              color: showGlossary ? '#FAF7F3' : '#8C5A3C',
              fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.15s',
            }}
          >
            ℹ️ Glossary
          </button>
        </div>

        {showGlossary && (
          <div style={{
            background: '#FFFFFF', borderRadius: '16px', padding: '16px',
            boxShadow: '0 2px 10px rgba(26,20,14,0.05)', marginBottom: '8px',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '10px' }}>
              Your Position
            </div>
            <p style={{ fontSize: '11px', color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif", margin: '0 0 8px', lineHeight: 1.5 }}>
              How your body moves in the saddle. These 6 metrics capture your alignment, stability, and balance.
            </p>
            {GLOSSARY_POSITION.map(g => (
              <div key={g.term} style={{ padding: '4px 0', borderBottom: '1px solid #F0EBE4' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#1A140E', fontFamily: "'DM Sans', sans-serif" }}>{g.term}</span>
                <span style={{ fontSize: '10.5px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}> — {g.def}</span>
              </div>
            ))}
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginTop: '14px', marginBottom: '10px' }}>
              Riding Quality
            </div>
            <p style={{ fontSize: '11px', color: '#7A6B5D', fontFamily: "'DM Sans', sans-serif", margin: '0 0 8px', lineHeight: 1.5 }}>
              The classical training scales that describe the quality of your horse's way of going, directly influenced by your position.
            </p>
            {GLOSSARY_QUALITY.map(g => (
              <div key={g.term} style={{ padding: '4px 0', borderBottom: '1px solid #F0EBE4' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#1A140E', fontFamily: "'DM Sans', sans-serif" }}>{g.term}</span>
                <span style={{ fontSize: '10.5px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}> — {g.def}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: '#FFFFFF', borderRadius: '12px', padding: '8px 14px',
          boxShadow: '0 2px 8px rgba(26,20,14,0.06)', marginBottom: '16px',
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#7D9B76' }} />
          <span style={{ fontSize: '13px', color: '#1A140E', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
            Overall score
          </span>
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: '15px',
            fontWeight: 500, color: '#8C5A3C', marginLeft: '4px',
          }}>
            {overallScore}%
          </span>
          <span style={{ fontSize: '10px', color: '#7D9B76', fontFamily: "'DM Sans', sans-serif" }}>
            ↑ 4wk
          </span>
        </div>
      </div>

      <div style={{ padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        <CadenceInsightCard text={cadenceInsights.insights} />

        <div style={{
          display: 'flex', gap: '4px',
          background: '#F0EBE4', borderRadius: '12px', padding: '4px',
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '7px 4px',
                background: activeTab === tab.id ? '#FFFFFF' : 'transparent',
                border: 'none', borderRadius: '9px', cursor: 'pointer',
                fontSize: '12px', fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? '#8C5A3C' : '#B5A898',
                fontFamily: "'DM Sans', sans-serif",
                transition: 'all 0.15s ease',
                boxShadow: activeTab === tab.id ? '0 1px 4px rgba(26,20,14,0.08)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'trends' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2, marginTop: 4 }}>
              <span style={{ fontSize: 20 }}>🧍</span>
              <div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, color: '#1A140E' }}>Your Position</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#B5A898' }}>Movement Trends</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {METRIC_CONFIG.map(({ key, label, color }) => {
                const active = activeMetrics.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleMetric(key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '4px 10px', borderRadius: '20px', cursor: 'pointer',
                      border: `1.5px solid ${active ? color : '#EDE7DF'}`,
                      background: active ? `${color}18` : '#FFFFFF',
                      fontSize: '11px', fontFamily: "'DM Sans', sans-serif",
                      color: active ? color : '#B5A898',
                      fontWeight: active ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: active ? color : '#EDE7DF' }} />
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '12px' }}>
                Score Over Time (0–100%)
              </div>
              <TrendChart data={biometricsTrend} activeMetrics={activeMetrics} />
              <div style={{ fontSize: '9px', color: '#B5A898', fontFamily: "'DM Mono', monospace", marginTop: '8px', textAlign: 'right' }}>
                AI-assisted · Sample data
              </div>
            </div>

            <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#B5A898', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", marginBottom: '4px' }}>
                Latest Snapshot
              </div>
              {METRIC_CONFIG.map(({ key, label, color }) => (
                <MetricSummaryRow key={key} metricKey={key} label={label} color={color} data={biometricsTrend} />
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2, marginTop: 12 }}>
              <span style={{ fontSize: 20 }}>🎯</span>
              <div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, color: '#1A140E' }}>Riding Quality</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#B5A898' }}>The Scales Over Time</div>
              </div>
            </div>

            <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '14px 16px', boxShadow: '0 2px 10px rgba(26,20,14,0.05)' }}>
              {(() => {
                const latestBio = trendToBiometrics(latest);
                const firstBio = trendToBiometrics(biometricsTrend[0]);
                const latestQ = computeRidingQualities(latestBio);
                const firstQ = computeRidingQualities(firstBio);
                return latestQ.map((q, i) => {
                  const delta = q.score - firstQ[i].score;
                  const trend = delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat';
                  const trendColor = trend === 'up' ? '#7D9B76' : trend === 'down' ? '#C4714A' : '#C9A96E';
                  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
                  const pct = Math.round(q.score * 100);
                  return (
                    <div key={q.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < latestQ.length - 1 ? '1px solid #F0EBE4' : 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: QUALITY_COLORS[i], flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12.5px', color: '#1A140E', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
                          {q.name}
                        </div>
                        <div style={{ fontSize: '10px', color: '#B5A898', fontFamily: "'DM Sans', sans-serif" }}>
                          {pct}% · <span style={{ color: trendColor }}>{trendSymbol} {Math.abs(Math.round(delta * 100))}pts</span>
                        </div>
                      </div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '14px', fontWeight: 500, color: QUALITY_COLORS[i] }}>
                        {pct}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </>
        )}

        {activeTab === 'milestones' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {mockGoal.milestones.map(ms => {
              const stateColor = ms.state === 'mastered' ? '#7D9B76' : ms.state === 'working' ? '#C9A96E' : '#EDE7DF';
              const progress = ms.state === 'mastered' ? 1 : ms.ridesConsistent / ms.ridesRequired;
              return (
                <div key={ms.id} style={{
                  background: '#FFFFFF', borderRadius: '16px', padding: '14px 16px',
                  boxShadow: '0 2px 10px rgba(26,20,14,0.05)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600, color: '#1A140E' }}>
                      {ms.name}
                    </div>
                    <div style={{
                      fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em',
                      textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif",
                      color: stateColor, background: `${stateColor}18`,
                      padding: '2px 8px', borderRadius: '6px',
                    }}>
                      {ms.state === 'mastered' ? 'Mastered' : ms.state === 'working' ? 'In progress' : 'Not started'}
                    </div>
                  </div>

                  {ms.state !== 'untouched' && (
                    <>
                      <div style={{ height: '4px', background: '#F0EBE4', borderRadius: '2px', overflow: 'hidden', marginBottom: '6px' }}>
                        <div style={{ height: '100%', width: `${progress * 100}%`, background: stateColor, borderRadius: '2px', transition: 'width 0.5s' }} />
                      </div>
                      <div style={{ fontSize: '10px', color: '#B5A898', fontFamily: "'DM Mono', monospace" }}>
                        {ms.state === 'mastered' ? '5/5 rides consistent' : `${ms.ridesConsistent}/${ms.ridesRequired} rides consistent`}
                      </div>
                    </>
                  )}

                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {ms.biomechanicsFocus.slice(0, 2).map(f => (
                      <span key={f} style={{
                        fontSize: '9.5px', color: '#6B7FA3', background: '#EEF2F8',
                        padding: '2px 7px', borderRadius: '6px',
                        fontFamily: "'DM Sans', sans-serif",
                      }}>
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'patterns' && <PatternsTab />}

      </div>
    </div>
  );
}