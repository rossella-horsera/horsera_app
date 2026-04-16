import { describe, expect, it } from 'vitest';
import type { TimestampedFrame } from '../hooks/useVideoAnalysis';
import { inferSampleIntervalSec, resolvePoseFrameAtTime } from '../lib/videoPlayback';

function poseFrame(x: number) {
  return [
    { x, y: 0.5, score: 0.9 },
  ];
}

function makeFrame(time: number, x: number | null, sampleIntervalSec = 0.25): TimestampedFrame {
  return {
    time,
    frame: x === null ? null : poseFrame(x),
    detected: x !== null,
    sampleIntervalSec,
  };
}

describe('videoPlayback timing helpers', () => {
  it('interpolates across a single missing sample slot when the gap is small', () => {
    const frames = [
      makeFrame(0.0, 0.2),
      makeFrame(0.25, null),
      makeFrame(0.5, 0.8),
    ];

    const resolved = resolvePoseFrameAtTime(frames, 0.25);

    expect(resolved?.[0]?.x).toBeCloseTo(0.5, 6);
  });

  it('hides the overlay across large gaps instead of snapping to stale data', () => {
    const frames = [
      makeFrame(0.0, 0.2),
      makeFrame(1.0, 0.8),
    ];

    const resolved = resolvePoseFrameAtTime(frames, 0.5);

    expect(resolved).toBeNull();
  });

  it('holds a nearby frame briefly when only one side is available', () => {
    const frames = [
      makeFrame(1.0, 0.6, 0.4),
    ];

    expect(resolvePoseFrameAtTime(frames, 1.15)?.[0]?.x).toBeCloseTo(0.6, 6);
    expect(resolvePoseFrameAtTime(frames, 1.25)).toBeNull();
  });

  it('prefers a lower-quartile delta when inferring sample interval from sparse history', () => {
    const frames = [
      makeFrame(0.0, 0.2, 0),
      makeFrame(0.25, 0.3, 0),
      makeFrame(0.5, 0.4, 0),
      makeFrame(1.0, 0.6, 0),
    ];

    expect(inferSampleIntervalSec(frames)).toBeCloseTo(0.25, 6);
  });
});
