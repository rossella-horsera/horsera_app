// ─── Video Analysis Data Models ──────────────────────────────────────────────

import { safeStorage } from './safeStorage';

export type VideoSourceType = "upload" | "external";
export type ExternalPlatform = "youtube" | "vimeo" | "loom" | "google-drive" | "icloud" | "other";

export interface VideoAsset {
  id: string;
  rideId: string;
  url: string;
  nativeUri?: string;
  duration: number;
  createdAt: string;
  fileName?: string;
  sourceType: VideoSourceType;
  uploadOrigin?: "file-input" | "photo-library";
  externalUrl?: string;
  externalPlatform?: ExternalPlatform;
  thumbnailUrl?: string;
  focusStartSeconds?: number;
  focusEndSeconds?: number;
}

export interface FrameSample {
  index: number;
  timestampSeconds: number;
  poseMetrics?: {
    headTiltDegrees?: number;
    shoulderAsymmetry?: number;
    hipAsymmetry?: number;
    lowerLegAngle?: number;
    coreEngagement?: number;
  };
}

export type InsightCategory = "head" | "balance" | "leg" | "alignment" | "core" | "rhythm" | "upper_body" | "hand_arm" | "aids_quality" | "seat_balance" | "head_position" | "leg_position" | "core_engagement" | "rhythm_timing";
export type InsightPattern = "consistent" | "intermittent" | "late-session" | "early-session" | "transitions-only";
export type InsightSeverity = "low" | "medium" | "high";
export type InsightConfidence = "low" | "medium";
export type InsightStatus = "good" | "moderate" | "needs-attention";

export interface RecommendedExercise {
  title: string;
  description: string;
  onSaddle: boolean;
  catalogId?: string;
}

export interface AggregatedInsight {
  id: string;
  category: InsightCategory;
  pattern: InsightPattern;
  insightText: string;
  severity: InsightSeverity;
  confidence: InsightConfidence;
  status: InsightStatus;
  relatedSkills: string[];
  frameIndices: number[];
  recommendedExercise?: RecommendedExercise;
  // Visual-first structured fields
  whatText: string;
  whyItMatters: string;
  tryThis: string;
  evidenceTimestamp: number; // seconds into video
}

export interface VideoMoment {
  id: string;
  videoId: string;
  timestampSeconds: number;
  skillTag: string;
  note?: string;
}

export interface NextRideAction {
  id: string;
  text: string;
  linkedInsightId: string;
  linkedSkill: string;
  addedToThread: boolean;
}

export interface FocusSegment {
  startSeconds: number;
  endSeconds: number;
}

export interface RideSnapshot {
  walkMinutes: number;
  trotMinutes: number;
  canterMinutes: number;
  transitions: number;
  seatStability: "Low" | "Moderate" | "High";
  primaryFocus: string;
}

// ─── Seat Analysis Types ─────────────────────────────────────────────────────

export type SeatView = "left" | "back" | "right";

export interface SeatMetric {
  label: string;
  valueDegrees: number;
  idealMin: number;
  idealMax: number;
  status: InsightStatus;
}

export interface SeatAnalysisData {
  overallStatus: InsightStatus;
  confidence: InsightConfidence;
  metrics: {
    pelvicBalance: SeatMetric;
    hipDrop: SeatMetric;
    upperBodyLean: SeatMetric;
    seatStability: SeatMetric;
  };
  summary: string;
  whyItMatters: string;
  tryThis: string;
  evidenceFrameIndices: number[];
  evidenceTimestamps: number[];
}

export interface VideoAnalysisResult {
  videoId: string;
  rideId: string;
  analysisMode: "full" | "focus-segment";
  focusSegment?: FocusSegment;
  sampledFrames: FrameSample[];
  insights: AggregatedInsight[];
  nextRideActions: NextRideAction[];
  analyzedAt: string;
  disclaimer: string;
  sourceType: VideoSourceType;
  overallSummary?: string;
  snapshot?: RideSnapshot;
  seatAnalysis?: SeatAnalysisData;
  detectedGaits?: string[];
  goalRelevance?: string;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

export function severityToStatus(severity: InsightSeverity): InsightStatus {
  switch (severity) {
    case "low": return "good";
    case "medium": return "moderate";
    case "high": return "needs-attention";
  }
}

export const statusConfig: Record<InsightStatus, { label: string; bgClass: string; textClass: string }> = {
  "good": { label: "Good", bgClass: "bg-primary/10", textClass: "text-primary" },
  "moderate": { label: "Moderate", bgClass: "bg-warmth/15", textClass: "text-warmth" },
  "needs-attention": { label: "Needs Attention", bgClass: "bg-destructive/10", textClass: "text-destructive" },
};

export const confidenceConfig: Record<InsightConfidence, { label: string; dots: number }> = {
  low: { label: "Low confidence", dots: 1 },
  medium: { label: "Medium confidence", dots: 2 },
};

// ─── Insight Category Config ─────────────────────────────────────────────────

export const insightCategoryConfig: Record<string, { label: string; icon: string; color: string }> = {
  head: { label: "Head Position", icon: "🧠", color: "text-blue-500" },
  head_position: { label: "Head Position", icon: "🧠", color: "text-blue-500" },
  balance: { label: "Balance", icon: "⚖️", color: "text-primary" },
  seat_balance: { label: "Seat & Balance", icon: "⚖️", color: "text-primary" },
  leg: { label: "Lower Leg", icon: "🦵", color: "text-violet-500" },
  leg_position: { label: "Leg Position", icon: "🦵", color: "text-violet-500" },
  alignment: { label: "Alignment", icon: "📐", color: "text-warmth" },
  upper_body: { label: "Upper Body", icon: "📐", color: "text-warmth" },
  core: { label: "Core Stability", icon: "💪", color: "text-rose-500" },
  core_engagement: { label: "Core Engagement", icon: "💪", color: "text-rose-500" },
  rhythm: { label: "Rhythm", icon: "🎵", color: "text-indigo-500" },
  rhythm_timing: { label: "Rhythm & Timing", icon: "🎵", color: "text-indigo-500" },
  hand_arm: { label: "Hand & Arm", icon: "✋", color: "text-emerald-500" },
  aids_quality: { label: "Aids Quality", icon: "🤝", color: "text-amber-500" },
};

export const patternLabels: Record<InsightPattern, string> = {
  consistent: "Throughout the ride",
  intermittent: "In several moments",
  "late-session": "More in the second half",
  "early-session": "Mainly early on",
  "transitions-only": "During transitions",
};

export const severityConfig: Record<InsightSeverity, { label: string; bgClass: string; textClass: string }> = {
  low: { label: "Minor", bgClass: "bg-muted", textClass: "text-muted-foreground" },
  medium: { label: "Moderate", bgClass: "bg-warmth/15", textClass: "text-warmth" },
  high: { label: "Key Focus", bgClass: "bg-destructive/10", textClass: "text-destructive" },
};

// ─── Platform Detection ──────────────────────────────────────────────────────

export function detectPlatform(url: string): ExternalPlatform {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("vimeo.com")) return "vimeo";
  if (lower.includes("loom.com")) return "loom";
  if (lower.includes("drive.google.com")) return "google-drive";
  if (lower.includes("icloud.com")) return "icloud";
  return "other";
}

export function getEmbedUrl(url: string, platform: ExternalPlatform): string | null {
  try {
    if (platform === "youtube") {
      const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
      if (match) return `https://www.youtube.com/embed/${match[1]}`;
    }
    if (platform === "vimeo") {
      const match = url.match(/vimeo\.com\/(\d+)/);
      if (match) return `https://player.vimeo.com/video/${match[1]}`;
    }
    if (platform === "loom") {
      const match = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
      if (match) return `https://www.loom.com/embed/${match[1]}`;
    }
  } catch { /* ignore */ }
  return null;
}

export const platformLabels: Record<ExternalPlatform, { label: string; icon: string; supportsEmbed: boolean; supportsFrameSampling: boolean }> = {
  youtube: { label: "YouTube", icon: "▶️", supportsEmbed: true, supportsFrameSampling: false },
  vimeo: { label: "Vimeo", icon: "🎬", supportsEmbed: true, supportsFrameSampling: false },
  loom: { label: "Loom", icon: "🔴", supportsEmbed: true, supportsFrameSampling: false },
  "google-drive": { label: "Google Drive", icon: "📁", supportsEmbed: false, supportsFrameSampling: false },
  icloud: { label: "iCloud", icon: "☁️", supportsEmbed: false, supportsFrameSampling: false },
  other: { label: "External Link", icon: "🔗", supportsEmbed: false, supportsFrameSampling: false },
};

// ─── Local Persistence ───────────────────────────────────────────────────────

const STORAGE_KEYS = {
  videoAssets: "horsera-video-assets",
  analyses: "horsera-video-analyses",
  moments: "horsera-video-moments",
  savedFrames: "horsera-saved-frames",
} as const;

export function saveVideoAsset(asset: VideoAsset): void {
  const existing = getVideoAssets();
  existing[asset.rideId] = asset;
  safeStorage.setItem(STORAGE_KEYS.videoAssets, JSON.stringify(existing));
}

export function getVideoAssets(): Record<string, VideoAsset> {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.videoAssets);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function getVideoAssetForRide(rideId: string): VideoAsset | null {
  return getVideoAssets()[rideId] || null;
}

export function saveAnalysis(analysis: VideoAnalysisResult): void {
  const existing = getAllAnalyses();
  existing[analysis.rideId] = analysis;
  safeStorage.setItem(STORAGE_KEYS.analyses, JSON.stringify(existing));
}

export function getAnalysisForRide(rideId: string): VideoAnalysisResult | null {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.analyses);
    const all = raw ? JSON.parse(raw) : {};
    return all[rideId] || null;
  } catch { return null; }
}

function getAllAnalyses(): Record<string, VideoAnalysisResult> {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.analyses);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveMoments(videoId: string, moments: VideoMoment[]): void {
  const existing = getAllMoments();
  existing[videoId] = moments;
  safeStorage.setItem(STORAGE_KEYS.moments, JSON.stringify(existing));
}

export function getMomentsForVideo(videoId: string): VideoMoment[] {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.moments);
    const all = raw ? JSON.parse(raw) : {};
    return all[videoId] || [];
  } catch { return []; }
}

function getAllMoments(): Record<string, VideoMoment[]> {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.moments);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export interface SavedFrame {
  id: string;
  videoId: string;
  timestampSeconds: number;
  dataUrl: string;
  insightRef?: string;
  savedAt: string;
}

export function saveFrame(frame: SavedFrame): void {
  const existing = getSavedFrames(frame.videoId);
  existing.push(frame);
  const all = getAllSavedFrames();
  all[frame.videoId] = existing;
  safeStorage.setItem(STORAGE_KEYS.savedFrames, JSON.stringify(all));
}

export function getSavedFrames(videoId: string): SavedFrame[] {
  const all = getAllSavedFrames();
  return all[videoId] || [];
}

function getAllSavedFrames(): Record<string, SavedFrame[]> {
  try {
    const raw = safeStorage.getItem(STORAGE_KEYS.savedFrames);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// ─── Mock Analysis Generator ─────────────────────────────────────────────────

export function generateMockAnalysis(videoId: string, rideId: string, duration: number, focusSegment?: FocusSegment, sourceType: VideoSourceType = "upload"): VideoAnalysisResult {
  const frameCount = focusSegment ? 15 : 12;
  const start = focusSegment?.startSeconds ?? 0;
  const end = focusSegment?.endSeconds ?? (duration || 150);
  const interval = (end - start) / frameCount;

  const sampledFrames: FrameSample[] = Array.from({ length: frameCount }, (_, i) => ({
    index: i,
    timestampSeconds: Math.round(start + i * interval),
    poseMetrics: {
      headTiltDegrees: 3 + Math.random() * 8 * (i > frameCount * 0.6 ? 1.4 : 1),
      shoulderAsymmetry: Math.random() * 6 - 3,
      hipAsymmetry: Math.random() * 4 - 2,
      lowerLegAngle: 8 + Math.random() * 12,
      coreEngagement: 0.4 + Math.random() * 0.4 * (i > frameCount * 0.5 ? 0.7 : 1),
    },
  }));

  const totalMin = Math.round(duration / 60);
  const walkMin = Math.max(1, Math.round(totalMin * 0.3));
  const trotMin = Math.max(1, Math.round(totalMin * 0.45));
  const canterMin = Math.max(0, totalMin - walkMin - trotMin);

  const snapshot: RideSnapshot = {
    walkMinutes: walkMin,
    trotMinutes: trotMin,
    canterMinutes: canterMin,
    transitions: 6 + Math.floor(Math.random() * 8),
    seatStability: "Moderate",
    primaryFocus: "Seat & Balance",
  };

  const insights: AggregatedInsight[] = [
    {
      id: "ins-1",
      category: "core",
      pattern: "late-session",
      insightText: "Across this trot work, core engagement appeared to decrease after the first minute. The sampled frames suggest your upper body began collapsing forward in the latter half of the session.",
      whatText: "Core engagement appears to drop in the second half of your ride.",
      whyItMatters: "A fatigued core shifts weight forward, making it harder for your horse to balance.",
      tryThis: "Add a 5-minute core warm-up before mounting to build endurance.",
      evidenceTimestamp: Math.round(start + interval * 8),
      severity: "high",
      confidence: "medium",
      status: "needs-attention",
      relatedSkills: ["Core engagement"],
      frameIndices: [7, 8, 9, 10, 11],
    },
    {
      id: "ins-2",
      category: "head",
      pattern: "consistent",
      insightText: "A slight forward head tilt appeared across most sampled frames. This is common when riders focus downward during transitions and can affect overall balance.",
      whatText: "Head tends to tilt forward, especially during transitions.",
      whyItMatters: "Looking down shifts your centre of gravity and may affect your horse's rhythm.",
      tryThis: "Pick a focal point at ear height across the arena and ride toward it.",
      evidenceTimestamp: Math.round(start + interval * 3),
      severity: "medium",
      confidence: "low",
      status: "moderate",
      relatedSkills: ["Core engagement", "Half-halt timing"],
      frameIndices: [1, 3, 5, 7, 9],
    },
    {
      id: "ins-3",
      category: "leg",
      pattern: "transitions-only",
      insightText: "Lower leg position shifted forward during what appear to be transition moments. This appeared most in frames that coincide with gait changes.",
      whatText: "Lower leg may drift forward during gait transitions.",
      whyItMatters: "A forward leg weakens your aids and can unbalance your seat.",
      tryThis: "Before each transition, think 'heel under hip' as a quick body check.",
      evidenceTimestamp: Math.round(start + interval * 6),
      severity: "medium",
      confidence: "medium",
      status: "moderate",
      relatedSkills: ["Half-halt timing", "Rhythm control"],
      frameIndices: [3, 6, 9],
    },
    {
      id: "ins-4",
      category: "rhythm",
      pattern: "intermittent",
      insightText: "Posture variability increased in several moments, suggesting rhythm breaks. These appear to correlate with the moments where core engagement dropped.",
      whatText: "Rhythm appears to break in several moments, possibly linked to core fatigue.",
      whyItMatters: "Rhythm consistency helps your horse maintain self-carriage.",
      tryThis: "Count strides aloud during trot sets to anchor your rhythm.",
      evidenceTimestamp: Math.round(start + interval * 4),
      severity: "low",
      confidence: "low",
      status: "good",
      relatedSkills: ["Rhythm control"],
      frameIndices: [4, 7, 10],
    },
  ];

  const nextRideActions: NextRideAction[] = [
    {
      id: "nra-1",
      text: "Add 5-minute core prep before mounting — your late-session collapse suggests fatigue, not technique",
      linkedInsightId: "ins-1",
      linkedSkill: "Core engagement",
      addedToThread: false,
    },
    {
      id: "nra-2",
      text: "Practice 'eyes up' cue during transitions — pick a focal point at ear height across the arena",
      linkedInsightId: "ins-2",
      linkedSkill: "Half-halt timing",
      addedToThread: false,
    },
    {
      id: "nra-3",
      text: "Shorten canter sets to 2 reps and assess leg position before adding a 3rd",
      linkedInsightId: "ins-3",
      linkedSkill: "Rhythm control",
      addedToThread: false,
    },
  ];

  const seatAnalysis: SeatAnalysisData = {
    overallStatus: "moderate",
    confidence: "medium",
    metrics: {
      pelvicBalance: { label: "Pelvic Balance", valueDegrees: 3, idealMin: 0, idealMax: 4, status: "good" },
      hipDrop: { label: "Hip Drop", valueDegrees: 5, idealMin: 0, idealMax: 3, status: "moderate" },
      upperBodyLean: { label: "Upper Body Lean", valueDegrees: 7, idealMin: 0, idealMax: 5, status: "moderate" },
      seatStability: { label: "Seat Stability", valueDegrees: 4, idealMin: 0, idealMax: 5, status: "good" },
    },
    summary: "Your seat appears generally centered, with a slight forward shift during transitions.",
    whyItMatters: "Forward weight may reduce the horse's ability to lift through the back.",
    tryThis: "Think 'sit tall and heavy through your seat bones' into the canter.",
    evidenceFrameIndices: [2, 5, 9],
    evidenceTimestamps: [
      Math.round(start + interval * 2),
      Math.round(start + interval * 5),
      Math.round(start + interval * 9),
    ],
  };

  return {
    videoId,
    rideId,
    analysisMode: focusSegment ? "focus-segment" : "full",
    focusSegment,
    sampledFrames,
    insights,
    nextRideActions,
    analyzedAt: new Date().toISOString(),
    disclaimer: "Sampled analysis · Assistive / Beta · Not a replacement for trainer judgment",
    sourceType,
    snapshot,
    seatAnalysis,
  };
}

// ─── Frame Extraction ────────────────────────────────────────────────────────

export async function extractFramesFromVideo(
  videoElement: HTMLVideoElement,
  count: number = 12,
  focusSegment?: FocusSegment
): Promise<string[]> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const start = focusSegment?.startSeconds ?? 0;
  const end = focusSegment?.endSeconds ?? videoElement.duration;
  const interval = (end - start) / (count + 1);

  const scale = Math.min(1, 720 / videoElement.videoWidth);
  canvas.width = Math.round(videoElement.videoWidth * scale);
  canvas.height = Math.round(videoElement.videoHeight * scale);

  const frames: string[] = [];

  for (let i = 1; i <= count; i++) {
    const targetTime = start + i * interval;
    await seekTo(videoElement, targetTime);
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    frames.push(dataUrl);
  }

  return frames;
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    video.currentTime = time;
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
  });
}

// ─── AI Analysis API ─────────────────────────────────────────────────────────

export interface AIAnalysisResponse {
  detectedGaits?: string[];
  goalRelevance?: string;
  insights: Array<{
    category: string;
    observation: string;
    severity: InsightSeverity;
    confidence: InsightConfidence;
    pattern: InsightPattern;
    relatedSkills: string[];
    recommendedExercise: {
      title: string;
      description: string;
      onSaddle: boolean;
    };
  }>;
  nextRideActions: Array<{
    text: string;
    linkedSkill: string;
    priority: string;
  }>;
  overallSummary: string;
}

export function mapAIResponseToAnalysis(
  aiResponse: AIAnalysisResponse,
  videoId: string,
  rideId: string,
  frameCount: number,
  focusSegment?: FocusSegment,
  sourceType: VideoSourceType = "upload"
): VideoAnalysisResult {
  const insights: AggregatedInsight[] = aiResponse.insights.map((ins, i) => {
    const status = severityToStatus(ins.severity);
    return {
      id: `ins-ai-${i}`,
      category: ins.category as InsightCategory,
      pattern: ins.pattern,
      insightText: ins.observation,
      severity: ins.severity,
      confidence: ins.confidence,
      status,
      relatedSkills: ins.relatedSkills,
      frameIndices: Array.from({ length: Math.min(5, frameCount) }, (_, j) => j * Math.floor(frameCount / 5)),
      recommendedExercise: {
        title: ins.recommendedExercise.title,
        description: ins.recommendedExercise.description,
        onSaddle: ins.recommendedExercise.onSaddle,
      },
      whatText: ins.observation.split(".")[0] + ".",
      whyItMatters: "This may affect your overall balance and connection with your horse.",
      tryThis: ins.recommendedExercise.title,
      evidenceTimestamp: i * Math.floor((focusSegment?.endSeconds ?? 150) / (aiResponse.insights.length + 1)),
    };
  });

  const nextRideActions: NextRideAction[] = aiResponse.nextRideActions.map((a, i) => ({
    id: `nra-ai-${i}`,
    text: a.text,
    linkedInsightId: insights[0]?.id || "",
    linkedSkill: a.linkedSkill,
    addedToThread: false,
  }));

  const sampledFrames: FrameSample[] = Array.from({ length: frameCount }, (_, i) => ({
    index: i,
    timestampSeconds: 0,
  }));

  const snapshot: RideSnapshot = {
    walkMinutes: 2,
    trotMinutes: 3,
    canterMinutes: 1,
    transitions: 8,
    seatStability: "Moderate",
    primaryFocus: insights[0] ? (insightCategoryConfig[insights[0].category]?.label || "General") : "General",
  };

  const seatAnalysis: SeatAnalysisData = {
    overallStatus: "moderate",
    confidence: "medium",
    metrics: {
      pelvicBalance: { label: "Pelvic Balance", valueDegrees: 4, idealMin: 0, idealMax: 4, status: "good" },
      hipDrop: { label: "Hip Drop", valueDegrees: 6, idealMin: 0, idealMax: 3, status: "moderate" },
      upperBodyLean: { label: "Upper Body Lean", valueDegrees: 5, idealMin: 0, idealMax: 5, status: "good" },
      seatStability: { label: "Seat Stability", valueDegrees: 8, idealMin: 0, idealMax: 5, status: "needs-attention" },
    },
    summary: "Seat position tends to shift forward slightly during trot transitions.",
    whyItMatters: "A shifting seat may make it harder for your horse to maintain self-carriage.",
    tryThis: "Focus on keeping your weight even through both seat bones during transitions.",
    evidenceFrameIndices: [1, 4, 8],
    evidenceTimestamps: [15, 45, 90],
  };

  return {
    videoId,
    rideId,
    analysisMode: focusSegment ? "focus-segment" : "full",
    focusSegment,
    sampledFrames,
    insights,
    nextRideActions,
    analyzedAt: new Date().toISOString(),
    disclaimer: "AI Vision Analysis · Assistive / Beta · Not a replacement for trainer judgment",
    sourceType,
    overallSummary: aiResponse.overallSummary,
    snapshot,
    seatAnalysis,
    detectedGaits: aiResponse.detectedGaits,
    goalRelevance: aiResponse.goalRelevance,
  };
}

// ─── Mock Video Assets (keyed by rideId) ─────────────────────────────────────

export const mockVideoAssets: Record<string, VideoAsset> = {
  e6: {
    id: "vid-1",
    rideId: "e6",
    url: "",
    duration: 152,
    createdAt: "Feb 7",
    fileName: "arena-session-feb7.mp4",
    sourceType: "upload",
  },
};
