import { describe, expect, it } from 'vitest';
import { calculateHeatScore, getHeatLabel } from './heat.js';

describe('heat utils', () => {
  const now = new Date('2026-06-10T02:00:00.000Z');

  it('keeps the heat score within 0-100', () => {
    expect(
      calculateHeatScore(
        {
          aiImportance: 'urgent',
          aiRelevance: 100,
          trustScore: 100,
          sourceQualityScore: 100,
          sourcePublishedAt: now,
          engagementJson: JSON.stringify({ views: 10000000, likes: 100000 })
        },
        { now }
      )
    ).toBe(100);
  });

  it('marks strong fresh hotspots as explosive', () => {
    const score = calculateHeatScore(
      {
        aiImportance: 'high',
        aiRelevance: 92,
        trustScore: 94,
        sourceQualityScore: 78,
        sourcePublishedAt: '2026-06-10T01:00:00.000Z'
      },
      { now }
    );

    expect(score).toBeGreaterThanOrEqual(80);
    expect(getHeatLabel(score)).toBe('爆');
  });

  it('uses plain-language labels for each score range', () => {
    expect(getHeatLabel(20)).toBe('冷');
    expect(getHeatLabel(45)).toBe('温');
    expect(getHeatLabel(65)).toBe('热');
    expect(getHeatLabel(85)).toBe('爆');
  });
});
