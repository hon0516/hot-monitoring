import { describe, expect, it } from 'vitest';
import { buildDedupeFields, meetsNotificationThreshold, normalizeTitle, normalizeUrl } from './normalize.js';

describe('normalize utils', () => {
  it('removes tracking params from url', () => {
    expect(normalizeUrl('https://www.example.com/news?id=1&utm_source=x#top')).toBe('example.com/news?id=1');
  });

  it('normalizes punctuation-heavy titles', () => {
    expect(normalizeTitle('GPT-5 发布了？！')).toBe('gpt 5 发布了');
  });

  it('prefers canonical url for dedupe key', () => {
    expect(buildDedupeFields({ title: 'Hello', url: 'https://example.com/a?utm_source=x' }).dedupeKey).toBe('example.com/a');
  });

  it('checks notification threshold correctly', () => {
    expect(
      meetsNotificationThreshold(
        { aiIsReal: true, aiRelevance: 80, aiImportance: 'urgent' },
        { relevanceThreshold: 70, importanceThreshold: 'high' }
      )
    ).toBe(true);
  });

  it('requires trusted audit status and trust score for audited notifications', () => {
    expect(
      meetsNotificationThreshold(
        {
          auditStatus: 'needs_review',
          trustScore: 88,
          aiIsReal: true,
          aiRelevance: 90,
          aiImportance: 'urgent'
        },
        { relevanceThreshold: 70, importanceThreshold: 'high' }
      )
    ).toBe(false);

    expect(
      meetsNotificationThreshold(
        {
          auditStatus: 'trusted',
          trustScore: 82,
          aiIsReal: true,
          aiRelevance: 90,
          aiImportance: 'urgent'
        },
        { relevanceThreshold: 70, importanceThreshold: 'high' }
      )
    ).toBe(true);
  });
});
