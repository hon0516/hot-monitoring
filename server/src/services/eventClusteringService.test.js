import { describe, expect, it } from 'vitest';
import { buildEventFingerprint, findBestEventCluster, titleSimilarity } from './eventClusteringService.js';

describe('event clustering', () => {
  it('clusters reports describing the same product release', () => {
    const similarity = titleSimilarity(
      'OpenAI 发布 Codex 全新云端编程能力',
      'OpenAI launches new cloud coding capabilities for Codex'
    );

    expect(similarity).toBeGreaterThan(0.2);
  });

  it('keeps unrelated events separate', () => {
    const match = findBestEventCluster('苹果发布新款 MacBook', [
      { id: 1, title: 'OpenAI 更新 Codex 编程代理' },
      { id: 2, title: '英伟达公布季度财报' }
    ]);

    expect(match).toBeNull();
  });

  it('creates stable fingerprints for equivalent normalized titles', () => {
    expect(buildEventFingerprint('Codex 发布重大更新！')).toBe(
      buildEventFingerprint('Codex 发布重大更新')
    );
  });
});
