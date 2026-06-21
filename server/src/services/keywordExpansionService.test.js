import { describe, expect, it, vi } from 'vitest';
import { resolveKeywordExpansion } from './keywordExpansionService.js';

function createFakePrisma(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    records,
    keywordExpansion: {
      findUnique: vi.fn(async ({ where }) => records.get(where.normalizedKeyword) || null),
      update: vi.fn(async ({ where, data }) => {
        const current = records.get(where.normalizedKeyword);
        const next = { ...current, ...data };
        records.set(where.normalizedKeyword, next);
        return next;
      }),
      upsert: vi.fn(async ({ where, update, create }) => {
        const current = records.get(where.normalizedKeyword);
        const next = current ? { ...current, ...update } : { id: records.size + 1, ...create };
        records.set(where.normalizedKeyword, next);
        return next;
      })
    }
  };
}

describe('keyword expansion cache', () => {
  it('persists AI-expanded keywords and keeps the original keyword', async () => {
    const prisma = createFakePrisma();
    const requestFn = vi.fn(async () => ({
      value: {
        keywords: ['AI编程', 'AI coding', 'AI programming', 'AI-assisted coding', 'coding agent']
      }
    }));

    const result = await resolveKeywordExpansion({
      keyword: 'AI编程',
      settings: { aiProvider: 'openrouter', scope: 'AI 编程' },
      prismaClient: prisma,
      requestFn
    });

    expect(result.cached).toBe(false);
    expect(result.source).toBe('ai');
    expect(result.expandedKeywords[0]).toBe('AI编程');
    expect(result.expandedKeywords).toContain('AI coding');
    expect(prisma.keywordExpansion.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns cached expansions without calling AI again', async () => {
    const prisma = createFakePrisma({
      'claudesonnet46': {
        id: 1,
        normalizedKeyword: 'claudesonnet46',
        originalKeyword: 'Claude Sonnet 4.6',
        expandedKeywordsJson: JSON.stringify(['Claude Sonnet 4.6', 'claude-sonnet-4.6']),
        source: 'ai'
      }
    });
    const requestFn = vi.fn();

    const result = await resolveKeywordExpansion({
      keyword: 'Claude Sonnet 4.6',
      settings: { aiProvider: 'openrouter' },
      prismaClient: prisma,
      requestFn
    });

    expect(result.cached).toBe(true);
    expect(result.expandedKeywords).toEqual(['Claude Sonnet 4.6', 'claude-sonnet-4.6']);
    expect(requestFn).not.toHaveBeenCalled();
    expect(prisma.keywordExpansion.update).toHaveBeenCalledTimes(1);
  });

  it('falls back to local rule expansion and caches the fallback', async () => {
    const prisma = createFakePrisma();
    const requestFn = vi.fn(async () => {
      throw new Error('AI unavailable');
    });

    const result = await resolveKeywordExpansion({
      keyword: 'OpenAI',
      settings: { aiProvider: 'openrouter' },
      prismaClient: prisma,
      requestFn
    });

    expect(result.source).toBe('rule_fallback');
    expect(result.expandedKeywords[0]).toBe('OpenAI');
    expect(result.expandedKeywords).toEqual(['OpenAI']);
    expect(prisma.keywordExpansion.upsert).toHaveBeenCalledTimes(1);
  });
});
