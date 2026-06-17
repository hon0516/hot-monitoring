import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './embeddingService.js';

describe('embeddingService.cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('ranks a closer vector higher than a farther one', () => {
    const reference = [1, 0, 0];
    const near = cosineSimilarity(reference, [0.9, 0.1, 0]);
    const far = cosineSimilarity(reference, [0.1, 0.9, 0]);
    expect(near).toBeGreaterThan(far);
  });

  it('returns null for mismatched lengths or empty input', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
    expect(cosineSimilarity([0, 0], [0, 0])).toBeNull();
  });
});
