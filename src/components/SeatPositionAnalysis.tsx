import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Shield } from "lucide-react";
import {
  type SeatAnalysisData, type SeatMetric, type SeatView, type InsightStatus, type InsightConfidence,
  statusConfig, confidenceConfig,
} from "@/lib/videoAnalysis";

// ─── Horsera Colors ──────────────────────────────────────────────────────────

const COLORS = {
  parchment: '#FAF7F3',
  cognac: '#8C5A3C',
  champagne: '#C9A96E',
  green: '#7D9B76',
  attention: '#C4714A',
  dark: '#2D2318',
  darkBody: '#3A3028',
  bone: '#F5EFE8',
  muted: '#B5A898',
  cadence: '#6B7FA3',
} as const;

function statusColor(status: InsightStatus): string {
  if (status === 'good') return COLORS.green;
  if (status === 'moderate') return COLORS.champagne;
  return COLORS.attention;
}

function metricToStatus(metric: SeatMetric): InsightStatus {
  const dist = Math.abs(metric.valueDegrees) - metric.idealMax;
  if (dist <= 0) return "good";
  if (dist <= 3) return "moderate";
  return "needs-attention";
}

function overallScore(metrics: SeatAnalysisData["metrics"]): number {
  // Compute 0-100 score based on how close all metrics are to ideal
  const items = [metrics.pelvicBalance, metrics.hipDrop, metrics.upperBodyLean, metrics.seatStability];
  let total = 0;
  for (const m of items) {
    const dist = Math.abs(m.valueDegrees) - m.idealMax;
    if (dist <= 0) total += 100;
    else if (dist <= 3) total += 70;
    else if (dist <= 6) total += 40;
    else total += 15;
  }
  return Math.round(total / items.length);
}

// ─── Arc Gauge Component ─────────────────────────────────────────────────────

const ArcGauge = ({ metric, size = 52 }: { metric: SeatMetric; size?: number }) => {
  const r = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const startAngle = -150;
  const endAngle = -30;
  const totalArc = endAngle - startAngle;
  const maxRange = 20;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcPoint = (angle: number) => ({
    x: cx + r * Math.cos(toRad(angle)),
    y: cy + r * Math.sin(toRad(angle)),
  });

  // Background arc
  const bgStart = arcPoint(startAngle);
  const bgEnd = arcPoint(endAngle);
  const bgPath = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 0 1 ${bgEnd.x} ${bgEnd.y}`;

  // Ideal range (green zone)
  const idealStartFrac = Math.max(0, metric.idealMin / maxRange);
  const idealEndFrac = Math.min(1, metric.idealMax / maxRange);
  const idealStartAngle = startAngle + idealStartFrac * totalArc;
  const idealEndAngle = startAngle + idealEndFrac * totalArc;
  const idealStart = arcPoint(idealStartAngle);
  const idealEnd = arcPoint(idealEndAngle);
  const idealPath = `M ${idealStart.x} ${idealStart.y} A ${r} ${r} 0 0 1 ${idealEnd.x} ${idealEnd.y}`;

  // Value marker position
  const valueFrac = Math.min(1, Math.max(0, Math.abs(metric.valueDegrees) / maxRange));
  const needleAngle = startAngle + valueFrac * totalArc;
  const markerPos = arcPoint(needleAngle);

  const status = metricToStatus(metric);
  const color = statusColor(status);

  return (
    <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
      {/* Background arc */}
      <path d={bgPath} fill="none" stroke="#EDE7DF" strokeWidth={5} strokeLinecap="round" />
      {/* Ideal range band */}
      <path d={idealPath} fill="none" stroke={`${COLORS.green}60`} strokeWidth={5} strokeLinecap="round" />
      {/* Colored arc up to value */}
      {(() => {
        const valStart = arcPoint(startAngle);
        const valEnd = arcPoint(needleAngle);
        const largeArc = (needleAngle - startAngle) > 180 ? 1 : 0;
        const valPath = `M ${valStart.x} ${valStart.y} A ${r} ${r} 0 ${largeArc} 1 ${valEnd.x} ${valEnd.y}`;
        return <path d={valPath} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" opacity={0.8} />;
      })()}
      {/* Marker dot */}
      <circle cx={markerPos.x} cy={markerPos.y} r={4} fill="white" stroke={color} strokeWidth={2} />
    </svg>
  );
};

// ─── Mannequin SVG ───────────────────────────────────────────────────────────

interface JointPositions {
  [key: string]: { x: number; y: number };
}

function getJoints(view: SeatView): JointPositions {
  if (view === "back") return {
    head: { x: 100, y: 28 },
    neck: { x: 100, y: 52 },
    shoulderL: { x: 65, y: 68 },
    shoulderR: { x: 135, y: 68 },
    elbowL: { x: 52, y: 108 },
    elbowR: { x: 148, y: 108 },
    handL: { x: 60, y: 140 },
    handR: { x: 140, y: 140 },
    hipL: { x: 78, y: 152 },
    hipR: { x: 122, y: 152 },
    pelvis: { x: 100, y: 152 },
    kneeL: { x: 72, y: 205 },
    kneeR: { x: 128, y: 205 },
    ankleL: { x: 70, y: 258 },
    ankleR: { x: 130, y: 258 },
  };
  if (view === "left") return {
    head: { x: 108, y: 24 },
    neck: { x: 102, y: 50 },
    shoulderL: { x: 96, y: 68 },
    shoulderR: { x: 96, y: 68 },
    elbowL: { x: 78, y: 108 },
    elbowR: { x: 78, y: 108 },
    handL: { x: 84, y: 140 },
    handR: { x: 84, y: 140 },
    hipL: { x: 108, y: 152 },
    hipR: { x: 108, y: 152 },
    pelvis: { x: 108, y: 152 },
    kneeL: { x: 82, y: 205 },
    kneeR: { x: 82, y: 205 },
    ankleL: { x: 92, y: 258 },
    ankleR: { x: 92, y: 258 },
  };
  // right view
  return {
    head: { x: 92, y: 24 },
    neck: { x: 98, y: 50 },
    shoulderL: { x: 104, y: 68 },
    shoulderR: { x: 104, y: 68 },
    elbowL: { x: 122, y: 108 },
    elbowR: { x: 122, y: 108 },
    handL: { x: 116, y: 140 },
    handR: { x: 116, y: 140 },
    hipL: { x: 92, y: 152 },
    hipR: { x: 92, y: 152 },
    pelvis: { x: 92, y: 152 },
    kneeL: { x: 118, y: 205 },
    kneeR: { x: 118, y: 205 },
    ankleL: { x: 108, y: 258 },
    ankleR: { x: 108, y: 258 },
  };
}

const RiderMannequin = ({
  view,
  metrics,
}: {
  view: SeatView;
  metrics: SeatAnalysisData["metrics"];
}) => {
  const j = getJoints(view);
  const w = 200;
  const h = 290;
  const isBack = view === "back";

  // Segment colors mapped to metrics
  const torsoColor = statusColor(metricToStatus(metrics.upperBodyLean));
  const hipColor = statusColor(metricToStatus(metrics.hipDrop));
  const pelvisColor = statusColor(metricToStatus(metrics.pelvicBalance));
  const bodyColor = COLORS.darkBody;
  const jointDotColor = "#F5EFE8";

  // Thick body segment helper
  const bodySegment = (
    x1: number, y1: number, x2: number, y2: number,
    color: string, width: number = 8
  ) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color} strokeWidth={width} strokeLinecap="round" />
  );

  // Joint dot helper
  const dot = (x: number, y: number, r: number = 5) => (
    <circle cx={x} cy={y} r={r} fill={jointDotColor} stroke="#D4CEC5" strokeWidth={1.5} />
  );

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', margin: '0 auto' }}>
      {/* Balance reference line */}
      <line x1={j.head.x} y1={j.head.y} x2={j.pelvis.x} y2={j.pelvis.y + 10}
        stroke={`${torsoColor}30`} strokeWidth={1} strokeDasharray="4 3" />

      {/* Body segments — thick dark strokes for mannequin look */}
      {/* Torso */}
      {bodySegment(j.neck.x, j.neck.y, j.pelvis.x, j.pelvis.y, bodyColor, 12)}
      {/* Colored overlay on torso */}
      {bodySegment(j.neck.x, j.neck.y, j.pelvis.x, j.pelvis.y, `${torsoColor}40`, 12)}

      {/* Shoulders */}
      {bodySegment(j.shoulderL.x, j.shoulderL.y, j.shoulderR.x, j.shoulderR.y, bodyColor, 8)}

      {/* Upper arms */}
      {bodySegment(j.shoulderL.x, j.shoulderL.y, j.elbowL.x, j.elbowL.y, bodyColor, 7)}
      {isBack && bodySegment(j.shoulderR.x, j.shoulderR.y, j.elbowR.x, j.elbowR.y, bodyColor, 7)}

      {/* Forearms */}
      {bodySegment(j.elbowL.x, j.elbowL.y, j.handL.x, j.handL.y, bodyColor, 6)}
      {isBack && bodySegment(j.elbowR.x, j.elbowR.y, j.handR.x, j.handR.y, bodyColor, 6)}

      {/* Hips bar */}
      {bodySegment(j.hipL.x, j.hipL.y, j.hipR.x, j.hipR.y, bodyColor, 10)}
      {bodySegment(j.hipL.x, j.hipL.y, j.hipR.x, j.hipR.y, `${hipColor}40`, 10)}

      {/* Pelvis highlight */}
      <ellipse cx={j.pelvis.x} cy={j.pelvis.y}
        rx={isBack ? 26 : 18} ry={10}
        fill={`${pelvisColor}20`} stroke={`${pelvisColor}50`} strokeWidth={1.5} />

      {/* Upper legs */}
      {bodySegment(j.hipL.x, j.hipL.y, j.kneeL.x, j.kneeL.y, bodyColor, 8)}
      {isBack && bodySegment(j.hipR.x, j.hipR.y, j.kneeR.x, j.kneeR.y, bodyColor, 8)}

      {/* Lower legs */}
      {bodySegment(j.kneeL.x, j.kneeL.y, j.ankleL.x, j.ankleL.y, bodyColor, 7)}
      {isBack && bodySegment(j.kneeR.x, j.kneeR.y, j.ankleR.x, j.ankleR.y, bodyColor, 7)}

      {/* Feet */}
      {bodySegment(j.ankleL.x, j.ankleL.y, j.ankleL.x + (view === 'right' ? -8 : 8), j.ankleL.y + 10, bodyColor, 6)}
      {isBack && bodySegment(j.ankleR.x, j.ankleR.y, j.ankleR.x - 8, j.ankleR.y + 10, bodyColor, 6)}

      {/* Skeleton overlay lines (colored by metric region) */}
      <line x1={j.neck.x} y1={j.neck.y} x2={j.pelvis.x} y2={j.pelvis.y}
        stroke={torsoColor} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      <line x1={j.hipL.x} y1={j.hipL.y} x2={j.hipR.x} y2={j.hipR.y}
        stroke={hipColor} strokeWidth={2} strokeLinecap="round" opacity={0.8} />

      {/* Joint dots */}
      {dot(j.shoulderL.x, j.shoulderL.y)}
      {isBack && dot(j.shoulderR.x, j.shoulderR.y)}
      {dot(j.elbowL.x, j.elbowL.y)}
      {isBack && dot(j.elbowR.x, j.elbowR.y)}
      {dot(j.handL.x, j.handL.y, 4)}
      {isBack && dot(j.handR.x, j.handR.y, 4)}
      {dot(j.hipL.x, j.hipL.y)}
      {isBack && dot(j.hipR.x, j.hipR.y)}
      {dot(j.kneeL.x, j.kneeL.y)}
      {isBack && dot(j.kneeR.x, j.kneeR.y)}
      {dot(j.ankleL.x, j.ankleL.y, 4)}
      {isBack && dot(j.ankleR.x, j.ankleR.y, 4)}

      {/* Head — larger dark circle */}
      <circle cx={j.head.x} cy={j.head.y} r={16}
        fill={COLORS.dark} stroke="#D4CEC5" strokeWidth={1.5} />
      {/* Neck */}
      {bodySegment(j.head.x, j.head.y + 14, j.neck.x, j.neck.y, bodyColor, 8)}
    </svg>
  );
};

// ─── Metric Card ─────────────────────────────────────────────────────────────

const MetricCard = ({ metric, side }: { metric: SeatMetric; side: "left" | "right" }) => {
  const status = metricToStatus(metric);
  const color = statusColor(status);

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '8px 10px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      textAlign: side === 'right' ? 'right' : 'left',
      minWidth: '80px',
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        color: COLORS.dark,
        fontFamily: "'DM Sans', sans-serif",
        marginBottom: '2px',
      }}>{metric.label}</div>
      <div style={{
        fontSize: '11px',
        color: COLORS.muted,
        fontFamily: "'DM Sans', sans-serif",
      }}>
        You: <span style={{ color, fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{metric.valueDegrees}°</span>
      </div>
      <div style={{
        fontSize: '10px',
        color: '#C8BFAF',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        Ideal: {metric.idealMin}–{metric.idealMax}°
      </div>
    </div>
  );
};

// ─── Gradient Score Bar ──────────────────────────────────────────────────────

const ScoreBar = ({ score }: { score: number }) => {
  const pct = Math.max(5, Math.min(95, score));

  return (
    <div style={{ padding: '16px 0 8px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '8px',
      }}>
        <span style={{
          background: 'white',
          borderRadius: '20px',
          padding: '4px 14px',
          fontSize: '12px',
          fontWeight: 600,
          color: COLORS.dark,
          fontFamily: "'DM Sans', sans-serif",
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>You</span>
      </div>
      <div style={{ position: 'relative', height: '12px', borderRadius: '6px', overflow: 'visible' }}>
        <div style={{
          height: '12px',
          borderRadius: '6px',
          background: 'linear-gradient(90deg, #C4714A 0%, #E8A84C 30%, #C9A96E 50%, #A5B87A 70%, #7D9B76 100%)',
        }} />
        {/* "You" marker dot */}
        <div style={{
          position: 'absolute',
          top: '-2px',
          left: `${pct}%`,
          transform: 'translateX(-50%)',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: '#3A3028',
          border: '2.5px solid white',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        }} />
        {/* Score tooltip */}
        <div style={{
          position: 'absolute',
          top: '20px',
          left: `${pct}%`,
          transform: 'translateX(-50%)',
          background: 'white',
          borderRadius: '8px',
          padding: '2px 8px',
          fontSize: '11px',
          fontWeight: 600,
          color: COLORS.dark,
          fontFamily: "'DM Mono', monospace",
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          whiteSpace: 'nowrap',
        }}>
          {score}%
        </div>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '20px',
        fontSize: '10px',
        color: COLORS.muted,
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <span>Needs work</span>
        <span>Ideal Position</span>
      </div>
    </div>
  );
};

// ─── Summary Insight Card ────────────────────────────────────────────────────

const InsightCard = ({ title, description, status }: { title: string; description: string; status: InsightStatus }) => {
  const color = statusColor(status);
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'white',
      borderRadius: '14px',
      padding: '14px 16px',
      marginBottom: '8px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{
          width: '20px', height: '20px', borderRadius: '50%',
          border: `2px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, marginTop: '1px',
        }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: COLORS.dark,
            fontFamily: "'DM Sans', sans-serif",
          }}>{title}</div>
          <div style={{
            fontSize: '13px',
            color: '#6B6055',
            fontFamily: "'DM Sans', sans-serif",
            lineHeight: 1.5,
            marginTop: '4px',
          }}>{description}</div>
        </div>
      </div>

      {/* Exercise sections */}
      <div style={{ marginTop: '12px', borderTop: '1px solid #F0EBE4', paddingTop: '10px' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: COLORS.dark, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
            <span style={{ fontSize: '14px' }}>🏃</span> Exercises
          </span>
          {expanded ? <ChevronUp size={14} color={COLORS.muted} /> : <ChevronRight size={14} color={COLORS.muted} />}
        </button>
        {expanded && (
          <div style={{ paddingTop: '6px', paddingLeft: '24px' }}>
            <div style={{
              fontSize: '12px', color: '#8A7E72', fontFamily: "'DM Sans', sans-serif",
              padding: '6px 0', borderBottom: '1px solid #F5F0EA',
            }}>Shoulder and Back Stretch</div>
            <div style={{
              fontSize: '12px', color: '#8A7E72', fontFamily: "'DM Sans', sans-serif",
              padding: '6px 0', borderBottom: '1px solid #F5F0EA',
            }}>Cat-Cow</div>
            <div style={{
              fontSize: '12px', color: '#8A7E72', fontFamily: "'DM Sans', sans-serif",
              padding: '6px 0',
            }}>Pelvic Tilt Hold</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Part by Part Carousel ───────────────────────────────────────────────────

const PartByPartCarousel = ({ metrics }: { metrics: SeatAnalysisData["metrics"] }) => {
  const parts = [
    { ...metrics.pelvicBalance, key: 'pelvic' },
    { ...metrics.upperBodyLean, key: 'upper' },
    { ...metrics.hipDrop, key: 'hip' },
    { ...metrics.seatStability, key: 'seat' },
  ];
  const [current, setCurrent] = useState(0);

  const part = parts[current];
  const partStatus = metricToStatus(part);
  const partScore = partStatus === 'good' ? 80 : partStatus === 'moderate' ? 55 : 25;

  return (
    <div style={{
      background: '#F5F0EA',
      borderRadius: '16px',
      padding: '16px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        marginBottom: '12px',
      }}>
        <span style={{ fontSize: '14px' }}>📊</span>
        <span style={{
          fontSize: '13px', fontWeight: 600, color: COLORS.dark,
          fontFamily: "'DM Sans', sans-serif",
        }}>Part by Part</span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <button onClick={() => setCurrent(Math.max(0, current - 1))}
          style={{
            width: 32, height: 32, borderRadius: '50%', background: 'white',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            opacity: current === 0 ? 0.4 : 1,
          }}
          disabled={current === 0}
        >
          <ChevronLeft size={16} color={COLORS.dark} />
        </button>

        <span style={{
          fontSize: '18px', fontWeight: 700, color: COLORS.dark,
          fontFamily: "'Playfair Display', serif",
        }}>{part.label}</span>

        <button onClick={() => setCurrent(Math.min(parts.length - 1, current + 1))}
          style={{
            width: 32, height: 32, borderRadius: '50%', background: 'white',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            opacity: current === parts.length - 1 ? 0.4 : 1,
          }}
          disabled={current === parts.length - 1}
        >
          <ChevronRight size={16} color={COLORS.dark} />
        </button>
      </div>

      {/* Mini info */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginBottom: '8px',
        fontSize: '11px', color: COLORS.muted, fontFamily: "'DM Sans', sans-serif",
      }}>
        <span>Ideal: {part.idealMin}–{part.idealMax}°</span>
      </div>

      {/* Score bar */}
      <div style={{ position: 'relative', height: '10px', borderRadius: '5px', overflow: 'visible' }}>
        <div style={{
          height: '10px',
          borderRadius: '5px',
          background: 'linear-gradient(90deg, #C4714A 0%, #E8A84C 30%, #C9A96E 50%, #A5B87A 70%, #7D9B76 100%)',
        }} />
        {/* Ideal range marker */}
        <div style={{
          position: 'absolute',
          top: '-1px',
          left: `${Math.min(95, (part.idealMax / 20) * 100)}%`,
          width: '2px',
          height: '12px',
          background: '#555',
          opacity: 0.4,
        }} />
        {/* Value marker */}
        <div style={{
          position: 'absolute',
          top: '-3px',
          left: `${Math.min(95, Math.max(5, (Math.abs(part.valueDegrees) / 20) * 100))}%`,
          transform: 'translateX(-50%)',
          width: '16px', height: '16px', borderRadius: '50%',
          background: '#3A3028',
          border: '2.5px solid white',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        }} />
      </div>

      {/* Value label */}
      <div style={{
        textAlign: 'center', marginTop: '12px',
        fontSize: '12px', fontFamily: "'DM Sans', sans-serif",
      }}>
        <span style={{ color: COLORS.muted }}>You: </span>
        <span style={{
          fontWeight: 600,
          color: statusColor(partStatus),
          fontFamily: "'DM Mono', monospace",
        }}>{part.valueDegrees}°</span>
      </div>

      {/* Pagination dots */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: '4px', marginTop: '10px',
      }}>
        {parts.map((_, i) => (
          <div key={i} style={{
            width: i === current ? 8 : 5,
            height: 5,
            borderRadius: '3px',
            background: i === current ? COLORS.dark : '#D4CEC5',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }} onClick={() => setCurrent(i)} />
        ))}
      </div>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

interface SeatPositionAnalysisProps {
  seatAnalysis: SeatAnalysisData;
  extractedFrames: string[];
  onJumpToTimestamp: (seconds: number) => void;
}

const SeatPositionAnalysis = ({
  seatAnalysis,
  extractedFrames,
  onJumpToTimestamp,
}: SeatPositionAnalysisProps) => {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<SeatView>("left");

  const computedOverallScore = overallScore(seatAnalysis.metrics);
  const computedStatus = computedOverallScore >= 70 ? 'good' : computedOverallScore >= 45 ? 'moderate' : 'needs-attention';
  const stConfig = statusConfig[computedStatus as InsightStatus] || statusConfig["moderate"];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {/* Collapsed Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '14px 16px',
          border: '1px solid #EDE7DF',
          cursor: 'pointer',
          display: 'block',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px',
            }}>
              <span style={{ fontSize: '14px' }}>🪑</span>
              <span style={{
                fontSize: '13px', fontWeight: 600, color: COLORS.dark,
                fontFamily: "'DM Sans', sans-serif",
              }}>Seat Position Analysis</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const,
                padding: '2px 8px', borderRadius: '10px',
                background: `${statusColor(computedStatus as InsightStatus)}15`,
                color: statusColor(computedStatus as InsightStatus),
                fontFamily: "'DM Sans', sans-serif",
              }}>{stConfig.label}</span>
              <span style={{
                fontSize: '10px', color: COLORS.muted,
                fontFamily: "'DM Mono', monospace",
              }}>{computedOverallScore}%</span>
            </div>
          </div>
          {expanded ? <ChevronUp size={16} color={COLORS.muted} /> : <ChevronDown size={16} color={COLORS.muted} />}
        </div>
      </button>

      {/* Expanded Panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              background: '#F5F0EA',
              borderRadius: '0 0 16px 16px',
              marginTop: '-8px',
              paddingTop: '16px',
              padding: '16px',
            }}>
              {/* View Switcher */}
              <div style={{
                display: 'flex',
                borderRadius: '14px',
                background: '#EDE7DF',
                padding: '3px',
                gap: '2px',
                marginBottom: '16px',
              }}>
                {(["left", "back", "right"] as SeatView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      flex: 1,
                      borderRadius: '11px',
                      padding: '8px 0',
                      fontSize: '13px',
                      fontWeight: 600,
                      fontFamily: "'DM Sans', sans-serif",
                      border: 'none',
                      cursor: 'pointer',
                      background: view === v ? COLORS.dark : 'transparent',
                      color: view === v ? '#FAF7F3' : '#8A7E72',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {v === "left" ? "Left" : v === "back" ? "Back" : "Right"}
                  </button>
                ))}
              </div>

              {/* Mannequin + Metric Cards */}
              <div style={{
                background: 'white',
                borderRadius: '16px',
                padding: '16px 8px',
                marginBottom: '12px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}>
                  {/* Left metrics */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '30px', width: '90px' }}>
                    {view === "back" ? (
                      <>
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.pelvicBalance,
                          label: 'Shoulder Drop',
                        }} side="left" />
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.seatStability,
                          label: 'Knee Drop',
                        }} side="left" />
                      </>
                    ) : view === "left" ? (
                      <>
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.upperBodyLean,
                          label: 'Upper arm',
                        }} side="left" />
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.seatStability,
                          label: 'Forearm',
                        }} side="left" />
                      </>
                    ) : (
                      <>
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.pelvicBalance,
                          label: 'Head',
                        }} side="left" />
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.upperBodyLean,
                          label: 'Upper body',
                        }} side="left" />
                      </>
                    )}
                  </div>

                  {/* Mannequin */}
                  <div style={{ flex: '0 0 auto' }}>
                    <RiderMannequin view={view} metrics={seatAnalysis.metrics} />
                  </div>

                  {/* Right metrics */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '30px', width: '90px' }}>
                    {view === "back" ? (
                      <>
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.hipDrop,
                          label: 'Head Tilt',
                        }} side="right" />
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.upperBodyLean,
                          label: 'Hip Drop',
                        }} side="right" />
                      </>
                    ) : view === "left" ? (
                      <>
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.pelvicBalance,
                          label: 'Head',
                        }} side="right" />
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.hipDrop,
                          label: 'Lower leg',
                        }} side="right" />
                      </>
                    ) : (
                      <>
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.hipDrop,
                          label: 'Upper arm',
                        }} side="right" />
                        <MetricCard metric={{
                          ...seatAnalysis.metrics.seatStability,
                          label: 'Forearm',
                        }} side="right" />
                      </>
                    )}
                  </div>
                </div>

                {/* Overall Score Bar */}
                <ScoreBar score={computedOverallScore} />
              </div>

              {/* Summary Section */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{
                  fontSize: '16px', fontWeight: 700, color: COLORS.dark,
                  fontFamily: "'Playfair Display', serif",
                  marginBottom: '10px',
                }}>Summary</div>
                <div style={{
                  fontSize: '13px', color: '#6B6055',
                  fontFamily: "'DM Sans', sans-serif",
                  lineHeight: 1.55,
                  marginBottom: '12px',
                }}>{seatAnalysis.summary}</div>

                {/* Insight cards */}
                <InsightCard
                  title="Upper Body Lean"
                  description={seatAnalysis.whyItMatters}
                  status={metricToStatus(seatAnalysis.metrics.upperBodyLean)}
                />
                <InsightCard
                  title="Hip Balance"
                  description="Your hips may be slightly uneven, which can affect your horse's straightness."
                  status={metricToStatus(seatAnalysis.metrics.hipDrop)}
                />
              </div>

              {/* Try This */}
              <div style={{
                background: `${COLORS.green}12`,
                borderRadius: '14px',
                padding: '14px 16px',
                marginBottom: '12px',
                border: `1px solid ${COLORS.green}25`,
              }}>
                <div style={{
                  fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const,
                  letterSpacing: '0.5px', color: COLORS.green,
                  fontFamily: "'DM Sans', sans-serif",
                  marginBottom: '4px',
                }}>Try this</div>
                <div style={{
                  fontSize: '13px', fontWeight: 500, color: COLORS.dark,
                  fontFamily: "'DM Sans', sans-serif",
                  lineHeight: 1.5,
                }}>{seatAnalysis.tryThis}</div>
              </div>

              {/* Part by Part */}
              <PartByPartCarousel metrics={seatAnalysis.metrics} />

              {/* Confidence note */}
              {seatAnalysis.confidence === "low" && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 12px', borderRadius: '10px',
                  background: '#F0EBE4', marginTop: '10px',
                }}>
                  <Shield size={12} color={COLORS.muted} />
                  <span style={{
                    fontSize: '10px', color: COLORS.muted, fontStyle: 'italic',
                    fontFamily: "'DM Sans', sans-serif",
                  }}>Lower confidence — colors are softened. Results improve with clearer video angles.</span>
                </div>
              )}

              {/* Disclaimer */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                marginTop: '10px',
              }}>
                <Shield size={10} color={COLORS.muted} />
                <span style={{
                  fontSize: '9px', color: COLORS.muted, fontStyle: 'italic',
                  fontFamily: "'DM Sans', sans-serif",
                }}>Assistive · AI Vision · Reuses existing pose data</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default SeatPositionAnalysis;
