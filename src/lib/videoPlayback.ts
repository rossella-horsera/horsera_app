import type { TimestampedFrame } from '../hooks/useVideoAnalysis';
import type { PoseFrame } from './poseAnalysis';

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, q));
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * clamped)));
  return sortedValues[idx] ?? sortedValues[sortedValues.length - 1] ?? 0;
}

export function hasPoseFrame(frame: TimestampedFrame): frame is TimestampedFrame & { frame: PoseFrame } {
  return Array.isArray(frame.frame) && frame.frame.length > 0 && (frame.detected ?? true);
}

export function inferSampleIntervalSec(frames: TimestampedFrame[]): number {
  const explicit = frames.find((frame) => typeof frame.sampleIntervalSec === 'number' && frame.sampleIntervalSec > 0)?.sampleIntervalSec;
  if (typeof explicit === 'number' && explicit > 0) {
    return explicit;
  }

  const deltas: number[] = [];
  for (let idx = 1; idx < frames.length; idx += 1) {
    const delta = frames[idx].time - frames[idx - 1].time;
    if (delta > 1e-4) {
      deltas.push(delta);
    }
  }

  if (deltas.length === 0) {
    return 1;
  }

  deltas.sort((a, b) => a - b);
  return quantile(deltas, 0.25) || deltas[0] || 1;
}

function findFirstIndexAtOrAfter(frames: TimestampedFrame[], time: number): number {
  let low = 0;
  let high = frames.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function interpolatePoseFrame(left: PoseFrame, right: PoseFrame, ratio: number): PoseFrame {
  const t = Math.min(1, Math.max(0, ratio));
  const nextFrame = right.length > 0 ? right : left;

  return left.map((kp, idx) => {
    const next = nextFrame[idx] ?? kp;
    return {
      x: kp.x + (next.x - kp.x) * t,
      y: kp.y + (next.y - kp.y) * t,
      score: kp.score + (next.score - kp.score) * t,
    };
  });
}

function hasExplicitMissingGap(
  previous: TimestampedFrame | null,
  next: TimestampedFrame | null,
): boolean {
  if (!previous || !next) {
    return false;
  }
  if (typeof previous.sampleIndex === 'number' && typeof next.sampleIndex === 'number') {
    return (next.sampleIndex - previous.sampleIndex) > 1;
  }
  return false;
}

export function resolvePoseFrameAtTime(frames: TimestampedFrame[], time: number): PoseFrame | null {
  const validFrames = frames.filter(hasPoseFrame);
  if (validFrames.length === 0) {
    return null;
  }

  const interval = inferSampleIntervalSec(frames);
  const holdThreshold = interval * 0.5;
  const interpolationGapThreshold = (interval * 2) + 1e-6;
  const insertIdx = findFirstIndexAtOrAfter(validFrames, time);
  const previous = insertIdx > 0 ? validFrames[insertIdx - 1] : null;
  const next = insertIdx < validFrames.length ? validFrames[insertIdx] : null;
  const explicitMissingGap = hasExplicitMissingGap(previous, next);

  if (previous && Math.abs(previous.time - time) <= 1e-6) {
    return previous.frame;
  }
  if (next && Math.abs(next.time - time) <= 1e-6) {
    return next.frame;
  }

  if (previous && next && previous.time < time && time < next.time) {
    const gap = next.time - previous.time;
    if (explicitMissingGap) {
      return null;
    }
    if (gap <= interpolationGapThreshold) {
      const ratio = (time - previous.time) / Math.max(gap, 1e-6);
      return interpolatePoseFrame(previous.frame, next.frame, ratio);
    }
  }

  const previousDistance = previous ? Math.abs(time - previous.time) : Number.POSITIVE_INFINITY;
  const nextDistance = next ? Math.abs(next.time - time) : Number.POSITIVE_INFINITY;
  const previousIsNear = previousDistance <= holdThreshold;
  const nextIsNear = nextDistance <= holdThreshold;

  if (previousIsNear && nextIsNear) {
    return previousDistance <= nextDistance ? previous!.frame : next!.frame;
  }
  if (previousIsNear) {
    return previous!.frame;
  }
  if (nextIsNear) {
    return next!.frame;
  }

  return null;
}
