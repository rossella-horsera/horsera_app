import { describe, expect, it } from 'vitest';
import { mergeKeyframeChunks, splitKeyframesIntoChunks, type StoredKeyframe } from '../lib/storage';

function makeFrame(index: number): StoredKeyframe {
  return {
    time: index * 0.5,
    frame: [
      { x: index, y: index + 1, score: 0.9 },
    ],
  };
}

describe('storage keyframe chunking', () => {
  it('splits frames into stable 100-frame chunks and merges them back without loss', () => {
    const originalFrames = Array.from({ length: 205 }, (_, index) => makeFrame(index));

    const chunks = splitKeyframesIntoChunks(originalFrames);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(5);
    expect(mergeKeyframeChunks(chunks)).toEqual(originalFrames);
  });
});
