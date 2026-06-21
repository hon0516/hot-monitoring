import { describe, expect, it } from 'vitest';
import { calculateEngagementHeat, calculateHeatScore, getHeatLabel } from './heat.js';

describe('heat utils', () => {
  it('uses the normalized 0-100 heat formula', () => {
    expect(
      calculateHeatScore(
        {
          engagementJson: JSON.stringify({ views: 1000000, likes: 10, reposts: 4 })
        }
      )
    ).toBe(13);
  });

  it('weights likes above shares and uses views as a log-scaled signal', () => {
    const liked = calculateEngagementHeat({ likes: 100, reposts: 0, views: 0 });
    const shared = calculateEngagementHeat({ likes: 0, reposts: 100, views: 0 });
    const viewed = calculateEngagementHeat({ likes: 0, reposts: 0, views: 100 });

    expect(liked).toBeGreaterThan(shared);
    expect(shared).toBeGreaterThan(viewed);
    expect(viewed).toBe(4);
  });

  it('clamps very high engagement to 100', () => {
    expect(calculateHeatScore({ engagementJson: JSON.stringify({ likes: 5000, reposts: 500, views: 10000000 }) })).toBe(100);
  });

  it('supports common engagement aliases', () => {
    expect(calculateHeatScore({ engagementJson: JSON.stringify({ points: 20, retweets: 10, reads: 10000 }) }))
      .toBe(calculateHeatScore({ engagementJson: JSON.stringify({ likes: 20, reposts: 10, views: 10000 }) }));
  });

  it('falls back to replies, quotes, followers, and freshness when primary metrics are missing', () => {
    expect(
      calculateHeatScore({
        engagementJson: JSON.stringify({ authorFollowers: 10000, replies: 10, quotes: 2 }),
        sourcePublishedAt: '2000-01-01T00:00:00.000Z'
      })
    ).toBe(19);
  });

  it('uses plain-language labels for each score range', () => {
    expect(getHeatLabel(20)).toBe('冷');
    expect(getHeatLabel(45)).toBe('温');
    expect(getHeatLabel(65)).toBe('热');
    expect(getHeatLabel(85)).toBe('爆');
  });
});
