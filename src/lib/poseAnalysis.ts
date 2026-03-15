// Horsera — Pose Analysis Library
// Converts MoveNet keypoint frames into biomechanics metrics.
//
// Model: MoveNet Thunder (COCO 17-point keypoints, indices 0–16)
// All x/y values are normalized 0–1 relative to frame dimensions.

import type { BiometricsSnapshot } from '../data/mock';

// ─────────────────────────────────────────────────────────
// KEYPOINT INDICES (MoveNet / COCO 17-point)
// ─────────────────────────────────────────────────────────

export const KP = {
  nose:           0,
  leftEye:        1,  rightEye:        2,
  leftEar:        3,  rightEar:        4,
  leftShoulder:   5,  rightShoulder:   6,
  leftElbow:      7,  rightElbow:      8,
  leftWrist:      9,  rightWrist:     10,
  leftHip:       11,  rightHip:       12,
  leftKnee:      13,  rightKnee:      14,
  leftAnkle:     15,  rightAnkle:     16,
} as const;

// Skeleton connections for visualization
export const SKELETON_CONNECTIONS: [number, number][] = [
  [KP.leftShoulder,  KP.rightShoulder],
  [KP.leftShoulder,  KP.leftElbow],
  [KP.leftElbow,     KP.leftWrist],
  [KP.rightShoulder, KP.rightElbow],
  [KP.rightElbow,    KP.rightWrist],
  [KP.leftShoulder,  KP.leftHip],
  [KP.rightShoulder, KP.rightHip],
  [KP.leftHip,       KP.rightHip],
  [KP.leftHip,       KP.leftKnee],
  [KP.leftKnee,      KP.leftAnkle],
  [KP.rightHip,      KP.rightKnee],
  [KP.rightKnee,     KP.rightAnkle],
];

// Body region → biomechanics metric (for coloring joints in visualization)
export const JOINT_REGIONS: Record<number, keyof BiometricsSnapshot> = {
  [KP.leftAnkle]:     'lowerLegStability',
  [KP.rightAnkle]:    'lowerLegStability',
  [KP.leftKnee]:      'lowerLegStability',
  [KP.rightKnee]:     'lowerLegStability',
  [KP.leftWrist]:     'reinSteadiness',
  [KP.rightWrist]:    'reinSteadiness',
  [KP.leftElbow]:     'reinSymmetry',
  [KP.rightElbow]:    'reinSymmetry',
  [KP.leftShoulder]:  'upperBodyAlignment',
  [KP.rightShoulder]: 'upperBodyAlignment',
  [KP.leftHip]:       'pelvisStability',
  [KP.rightHip]:      'pelvisStability',
};

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface KeypointXY {
  x: number;     // normalized 0–1
  y: number;     // normalized 0–1
  score: number; // confidence 0–1
}

export type PoseFrame = KeypointXY[];

export interface MovementInsight {
  metric: string;
  quality: string;
  icon: string;
  iconColor: string;
  text: string;
  trend: string;
  trendColor: string;
}

// ─────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

/** Map a raw deviation value to a 0–1 score. Lower deviation = higher score. */
function stabilityScore(deviation: number, maxBad: number): number {
  return Math.max(0, Math.min(1, 1 - deviation / maxBad));
}

/** Filter to frames where core landmarks are confidently detected */
function validFrames(frames: PoseFrame[], minScore = 0.3): PoseFrame[] {
  return frames.filter(kps =>
    [KP.leftShoulder, KP.rightShoulder, KP.leftHip, KP.rightHip]
      .every(i => kps[i]?.score >= minScore)
  );
}

// ─────────────────────────────────────────────────────────
// METRIC COMPUTATIONS
// ─────────────────────────────────────────────────────────

/**
 * Compute all six biomechanics metrics from an array of pose frames.
 * Returns normalized 0–1 scores (1 = optimal, 0 = needs significant work).
 */
export function computeBiometricsFromFrames(frames: PoseFrame[]): BiometricsSnapshot {
  const valid = validFrames(frames);

  if (valid.length < 5) {
    // Insufficient data — return mid-range defaults
    return {
      lowerLegStability:  0.50,
      reinSteadiness:     0.50,
      reinSymmetry:       0.50,
      coreStability:      0.50,
      upperBodyAlignment: 0.50,
      pelvisStability:    0.50,
    };
  }

  // ── Lower Leg Stability ──────────────────────────────────
  // Ankle X position relative to hip midpoint — removes global camera motion.
  // High stdev in this relative position = leg swinging/drifting.
  const ankleFrames = valid.filter(kps =>
    Math.max(kps[KP.leftAnkle]?.score ?? 0, kps[KP.rightAnkle]?.score ?? 0) >= 0.25
  );
  const relAnkleX = ankleFrames.map(kps => {
    const hipMidX = (kps[KP.leftHip].x + kps[KP.rightHip].x) / 2;
    // Use whichever ankle has higher confidence
    const ankle = (kps[KP.leftAnkle]?.score ?? 0) >= (kps[KP.rightAnkle]?.score ?? 0)
      ? kps[KP.leftAnkle] : kps[KP.rightAnkle];
    return ankle.x - hipMidX;
  });
  const lowerLegStability = ankleFrames.length >= 5
    ? stabilityScore(stddev(relAnkleX), 0.08)  // >8% frame width = very unstable
    : 0.55;

  // ── Rein Steadiness ──────────────────────────────────────
  // Wrist position relative to same-side shoulder. Measures independent hand motion.
  const leftWristFrames = valid.filter(kps =>
    (kps[KP.leftWrist]?.score ?? 0) >= 0.3 && (kps[KP.leftShoulder]?.score ?? 0) >= 0.3
  );
  const relWristX = leftWristFrames.map(kps => kps[KP.leftWrist].x - kps[KP.leftShoulder].x);
  const relWristY = leftWristFrames.map(kps => kps[KP.leftWrist].y - kps[KP.leftShoulder].y);
  const wristMotion = leftWristFrames.length >= 5
    ? (stddev(relWristX) + stddev(relWristY)) / 2
    : 0.04;
  const reinSteadiness = stabilityScore(wristMotion, 0.06);

  // ── Rein Symmetry ──────────────────────────────────────
  // Difference in wrist height (relative to shoulder) between left and right hands.
  // An asymmetric rider carries one elbow higher.
  const symFrames = valid.filter(kps =>
    (kps[KP.leftWrist]?.score ?? 0) >= 0.3 &&
    (kps[KP.rightWrist]?.score ?? 0) >= 0.3
  );
  const asymmetry = symFrames.map(kps => {
    const leftRelY  = kps[KP.leftWrist].y  - kps[KP.leftShoulder].y;
    const rightRelY = kps[KP.rightWrist].y - kps[KP.rightShoulder].y;
    return Math.abs(leftRelY - rightRelY);
  });
  const reinSymmetry = symFrames.length >= 5
    ? stabilityScore(asymmetry.reduce((a, b) => a + b, 0) / asymmetry.length, 0.08)
    : 0.55;

  // ── Core Stability ──────────────────────────────────────
  // Standard deviation of the torso angle (shoulder midpoint to hip midpoint, from vertical).
  // A stable core holds this angle consistent through all gaits.
  const torsoAngles = valid.map(kps => {
    const sMidX = (kps[KP.leftShoulder].x + kps[KP.rightShoulder].x) / 2;
    const hMidX = (kps[KP.leftHip].x   + kps[KP.rightHip].x)   / 2;
    const sMidY = (kps[KP.leftShoulder].y + kps[KP.rightShoulder].y) / 2;
    const hMidY = (kps[KP.leftHip].y   + kps[KP.rightHip].y)   / 2;
    return Math.atan2(sMidX - hMidX, hMidY - sMidY) * (180 / Math.PI);
  });
  const coreStability = stabilityScore(stddev(torsoAngles), 8); // >8° variance = unstable

  // ── Upper Body Alignment ──────────────────────────────────
  // Mean lean angle. Ideal rider sits upright (~0°). Persistent lean = alignment issue.
  const meanLean = torsoAngles.reduce((a, b) => a + b, 0) / torsoAngles.length;
  const upperBodyAlignment = stabilityScore(Math.abs(meanLean), 15); // >15° lean = poor

  // ── Pelvis Stability ──────────────────────────────────────
  // Vertical bounce of the hip midpoint, normalized by torso height.
  // Some movement is correct (follow the horse), excess = bracing or bouncing.
  const hipYNorm = valid.map(kps => {
    const hipMidY = (kps[KP.leftHip].y   + kps[KP.rightHip].y)   / 2;
    const sMidY   = (kps[KP.leftShoulder].y + kps[KP.rightShoulder].y) / 2;
    const torsoH  = Math.abs(hipMidY - sMidY) || 0.1;
    return hipMidY / torsoH;
  });
  const pelvisStability = stabilityScore(stddev(hipYNorm), 0.15);

  const round2 = (v: number) => Math.round(v * 100) / 100;

  return {
    lowerLegStability:  round2(lowerLegStability),
    reinSteadiness:     round2(reinSteadiness),
    reinSymmetry:       round2(reinSymmetry),
    coreStability:      round2(coreStability),
    upperBodyAlignment: round2(upperBodyAlignment),
    pelvisStability:    round2(pelvisStability),
  };
}

// ─────────────────────────────────────────────────────────
// BEST MOMENT DETECTION
// ─────────────────────────────────────────────────────────

/**
 * Per-frame posture quality 0–1.
 * Used to find the window where the rider looks best across all metrics.
 * Combines landmark visibility with torso alignment (most reliable single-frame signal).
 */
export function frameQualityScore(kps: PoseFrame): number {
  if (!kps || kps.length < 17) return 0;

  // Visibility of the 7 key landmarks
  const keyIdx = [
    KP.leftShoulder, KP.rightShoulder,
    KP.leftHip,      KP.rightHip,
    KP.leftElbow,    KP.rightElbow,
    KP.leftKnee,
  ];
  const vis = keyIdx.filter(i => (kps[i]?.score ?? 0) >= 0.25).length / keyIdx.length;

  // Torso alignment: how close to vertical (ideal dressage position)
  const sMidX = (kps[KP.leftShoulder].x + kps[KP.rightShoulder].x) / 2;
  const hMidX = (kps[KP.leftHip].x   + kps[KP.rightHip].x)   / 2;
  const sMidY = (kps[KP.leftShoulder].y + kps[KP.rightShoulder].y) / 2;
  const hMidY = (kps[KP.leftHip].y   + kps[KP.rightHip].y)   / 2;
  const leanDeg = Math.abs(Math.atan2(sMidX - hMidX, hMidY - sMidY) * 180 / Math.PI);
  const align = Math.max(0, 1 - leanDeg / 30);

  return vis * 0.65 + align * 0.35;
}

/**
 * Find the timestamp of the best 15-second window in the ride.
 * Returns the center of that window, used as the start of the clip.
 * Skips the first 10% (warm-up) and last 5% (cool-down) of the ride.
 */
export function findBestMomentTimestamp(
  frames: PoseFrame[],
  timestamps: number[],
  windowSec = 15,
): number {
  if (frames.length < 2 || timestamps.length < 2) return timestamps[0] ?? 0;

  const sampleRate = (timestamps[timestamps.length - 1] - timestamps[0]) / (timestamps.length - 1);
  const windowFrames = Math.max(1, Math.round(windowSec / sampleRate));
  const startIdx = Math.floor(timestamps.length * 0.10);
  const endIdx   = Math.floor(timestamps.length * 0.95) - windowFrames;

  let bestScore = -1;
  let bestIdx   = startIdx;

  for (let i = startIdx; i <= Math.max(startIdx, endIdx); i++) {
    const window = frames.slice(i, i + windowFrames);
    const score  = window.reduce((s, f) => s + frameQualityScore(f), 0) / window.length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx   = i;
    }
  }

  // Return center of best window
  const centerIdx = Math.min(bestIdx + Math.floor(windowFrames / 2), timestamps.length - 1);
  return timestamps[centerIdx] ?? timestamps[bestIdx] ?? 0;
}

// ─────────────────────────────────────────────────────────
// RIDING QUALITY SCORES (Layer 2 — derived from biometrics)
// ─────────────────────────────────────────────────────────

export interface RidingQualityScore {
  name:          string;
  score:         number;           // 0–1
  primaryMetric: keyof BiometricsSnapshot;
  driverLabel:   string;           // "Lower Leg Stability"
  qualityNote:   string;
}

/**
 * Derive Layer 2 riding quality scores from Layer 1 biomechanics.
 * Ordered by USDF Scales of Training: Rhythm → Relaxation → Contact → Impulsion → Straightness → Balance.
 */
export function computeRidingQualities(bio: BiometricsSnapshot): RidingQualityScore[] {
  const q = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
  return [
    {
      name: 'Rhythm',
      score: q(bio.lowerLegStability * 0.60 + bio.coreStability * 0.40),
      primaryMetric: 'lowerLegStability',
      driverLabel: 'Lower Leg Stability',
      qualityNote: 'Consistency of tempo across all gaits',
    },
    {
      name: 'Relaxation',
      score: q(bio.pelvisStability * 0.55 + bio.upperBodyAlignment * 0.45),
      primaryMetric: 'pelvisStability',
      driverLabel: 'Pelvis Stability',
      qualityNote: 'Freedom from tension in body and contact',
    },
    {
      name: 'Contact',
      score: q(bio.reinSteadiness * 0.65 + bio.reinSymmetry * 0.35),
      primaryMetric: 'reinSteadiness',
      driverLabel: 'Rein Steadiness',
      qualityNote: 'Consistent, elastic connection through the rein',
    },
    {
      name: 'Impulsion',
      score: q(bio.lowerLegStability * 0.55 + bio.coreStability * 0.45),
      primaryMetric: 'lowerLegStability',
      driverLabel: 'Lower Leg + Core',
      qualityNote: 'Forward energy and spring from the hindquarters',
    },
    {
      name: 'Straightness',
      score: q(bio.reinSymmetry * 0.55 + bio.upperBodyAlignment * 0.45),
      primaryMetric: 'reinSymmetry',
      driverLabel: 'Rein Symmetry',
      qualityNote: 'Left–right alignment of horse and rider',
    },
    {
      name: 'Balance',
      score: q(bio.coreStability * 0.45 + bio.pelvisStability * 0.35 + bio.upperBodyAlignment * 0.20),
      primaryMetric: 'coreStability',
      driverLabel: 'Core Stability',
      qualityNote: 'Equilibrium maintained through all movements',
    },
  ];
}

// ─────────────────────────────────────────────────────────
// INSIGHT GENERATION
// ─────────────────────────────────────────────────────────

/**
 * Generate four narrative Movement Insights from biometrics scores.
 * Each insight connects Layer 1 (biomechanics metric) → Layer 2 (riding quality impact).
 */
export function generateInsights(
  bio: BiometricsSnapshot,
  prev?: BiometricsSnapshot
): MovementInsight[] {
  const pct = (v: number) => Math.round(v * 100);

  const trendFor = (curr: number, previous?: number) => {
    if (previous === undefined) return { label: 'first ride', color: '#6B7FA3' };
    const delta = curr - previous;
    if (delta > 0.05)  return { label: 'improving',  color: '#7D9B76' };
    if (delta < -0.05) return { label: 'declining',  color: '#C4714A' };
    return                    { label: 'consistent', color: '#C9A96E' };
  };

  const llTrend  = trendFor(bio.lowerLegStability,  prev?.lowerLegStability);
  const rsTrend  = trendFor(bio.reinSteadiness,     prev?.reinSteadiness);
  const coreTrend = trendFor(bio.coreStability,     prev?.coreStability);
  const symTrend = trendFor(bio.reinSymmetry,       prev?.reinSymmetry);

  return [
    {
      metric:     'Lower Leg',
      quality:    'Rhythm',
      icon:       bio.lowerLegStability >= 0.70 ? '✓' : '↓',
      iconColor:  bio.lowerLegStability >= 0.70 ? '#7D9B76' : '#E05C5C',
      text:       bio.lowerLegStability >= 0.80
        ? `Lower leg stability at ${pct(bio.lowerLegStability)}% — well anchored through the gaits. Your leg is your foundation.`
        : bio.lowerLegStability >= 0.65
        ? `Lower leg stability at ${pct(bio.lowerLegStability)}% — some drift detected. Tends to affect rhythm on the weaker rein.`
        : `Lower leg stability at ${pct(bio.lowerLegStability)}% — significant drift reducing rhythm consistency. Prioritise stirrup-less work.`,
      trend:      llTrend.label,
      trendColor: llTrend.color,
    },
    {
      metric:     'Rein Steadiness',
      quality:    'Contact',
      icon:       bio.reinSteadiness >= 0.75 ? '↑' : '!',
      iconColor:  bio.reinSteadiness >= 0.75 ? '#7D9B76' : '#F5C542',
      text:       bio.reinSteadiness >= 0.80
        ? `Rein steadiness at ${pct(bio.reinSteadiness)}% — hands are quiet and elastic. The contact is working.`
        : bio.reinSteadiness >= 0.65
        ? `Rein steadiness at ${pct(bio.reinSteadiness)}% — some hand movement detected. Try the tunnel rein exercise before each trot set.`
        : `Rein steadiness at ${pct(bio.reinSteadiness)}% — hands are quite active. Check that arm tension isn't coming from the shoulder.`,
      trend:      rsTrend.label,
      trendColor: rsTrend.color,
    },
    {
      metric:     'Core',
      quality:    'Balance',
      icon:       bio.coreStability >= 0.80 ? '✓' : '→',
      iconColor:  bio.coreStability >= 0.80 ? '#7D9B76' : '#C9A96E',
      text:       bio.coreStability >= 0.85
        ? `Core stability at ${pct(bio.coreStability)}% — torso is steady through all transitions. This is your strongest area.`
        : bio.coreStability >= 0.70
        ? `Core stability at ${pct(bio.coreStability)}% — holding reasonably well. Some torso rotation on transitions.`
        : `Core stability at ${pct(bio.coreStability)}% — noticeably variable. Focus on engaging the deep core through gait changes.`,
      trend:      coreTrend.label,
      trendColor: coreTrend.color,
    },
    {
      metric:     'Symmetry',
      quality:    'Rein Balance',
      icon:       bio.reinSymmetry >= 0.75 ? '✓' : '!',
      iconColor:  bio.reinSymmetry >= 0.75 ? '#7D9B76' : '#F5C542',
      text:       bio.reinSymmetry >= 0.80
        ? `Left–right symmetry at ${pct(bio.reinSymmetry)}% — both hands working evenly. Rare and worth maintaining.`
        : bio.reinSymmetry >= 0.65
        ? `Rein symmetry at ${pct(bio.reinSymmetry)}% — slight asymmetry detected, likely one elbow higher. Worth monitoring over the next 3 rides.`
        : `Rein symmetry at ${pct(bio.reinSymmetry)}% — noticeable hand height difference. This affects the horse's straightness and contact.`,
      trend:      symTrend.label,
      trendColor: symTrend.color,
    },
  ];
}
