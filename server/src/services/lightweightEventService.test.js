import { describe, expect, it } from 'vitest';
import { calculateRelevanceDecision } from './lightweightEventService.js';

describe('lightweight relevance decision', () => {
  it('accepts real content at relevance 50 when the keyword is mentioned', () => {
    const decision = calculateRelevanceDecision({
      analysis: {
        isReal: true,
        relevance: 50,
        relevanceReason: '内容直接讨论关键词',
        keywordMentioned: true,
        importance: 'medium',
        summary: '此内容与关键词直接相关'
      },
      preMatchResult: { matched: true, matchedTerms: ['AI编程'] }
    });

    expect(decision.accepted).toBe(true);
    expect(decision.keywordMentioned).toBe(true);
    expect(decision.relevanceScore).toBe(50);
  });

  it('accepts unmentioned content only when relevance reaches 65', () => {
    const decision = calculateRelevanceDecision({
      analysis: {
        isReal: true,
        relevance: 65,
        relevanceReason: '虽未直接提及但实质相关',
        keywordMentioned: false,
        importance: 'low',
        summary: '间接相关'
      }
    });

    expect(decision.accepted).toBe(true);
    expect(decision.keywordMentioned).toBe(false);
  });

  it('rejects fake or spam content even if relevance is high', () => {
    const decision = calculateRelevanceDecision({
      analysis: {
        isReal: false,
        relevance: 90,
        relevanceReason: '疑似营销软文',
        keywordMentioned: true,
        importance: 'low',
        summary: '软文'
      }
    });

    expect(decision.accepted).toBe(false);
    expect(decision.rejectionFlags).toContain('not_real');
  });

  it('rejects unmentioned content below the 65 bypass threshold', () => {
    const decision = calculateRelevanceDecision({
      analysis: {
        isReal: true,
        relevance: 64,
        relevanceReason: '同领域但未直接提及',
        keywordMentioned: false,
        importance: 'low',
        summary: '间接相关'
      }
    });

    expect(decision.accepted).toBe(false);
    expect(decision.rejectionFlags).toContain('keyword_not_mentioned_low_relevance');
  });
});
