import { describe, expect, it } from 'vitest';
import {
  calculateVerificationScoresForTest,
  finalizeVerificationDecisionForTest
} from './deepVerificationService.js';

function source(overrides = {}) {
  return {
    sourceType: 'google-news',
    publisherDomain: 'example.com',
    fetchStatus: 'fetched',
    sourcePublishedAt: new Date(),
    sourceAuthor: 'Reporter',
    isOfficial: false,
    isSyndicated: false,
    ...overrides
  };
}

describe('deep verification scoring', () => {
  it('requires corroboration before assigning trusted status', () => {
    const sources = [source()];
    const claims = [{ statement: 'Codex 发布新能力', status: 'supported', importance: 'core' }];
    const ruleScores = calculateVerificationScoresForTest({
      sources,
      verifiedClaims: claims,
      understanding: { relevanceScore: 95 }
    });
    const decision = finalizeVerificationDecisionForTest({
      ruleScores,
      adjudication: { relevanceScore: 95, importance: 'high' },
      understanding: { directlyRelevant: true, contentType: 'news', riskFlags: [] },
      verifiedClaims: claims
    });

    expect(decision.verificationStatus).toBe('needs_review');
  });

  it('allows two independent supporting sources to become trusted', () => {
    const sources = [
      source({ publisherDomain: 'example.com' }),
      source({ publisherDomain: 'another.org', sourceType: 'bing' })
    ];
    const claims = [{ statement: 'Codex 发布新能力', status: 'supported', importance: 'core' }];
    const ruleScores = calculateVerificationScoresForTest({
      sources,
      verifiedClaims: claims,
      understanding: { relevanceScore: 96 }
    });
    const decision = finalizeVerificationDecisionForTest({
      ruleScores,
      adjudication: {
        relevanceScore: 96,
        evidenceScore: 95,
        corroborationScore: 95,
        contradictionScore: 0,
        importance: 'high'
      },
      understanding: { directlyRelevant: true, contentType: 'news', riskFlags: [] },
      verifiedClaims: claims
    });

    expect(decision.trustScore).toBeGreaterThanOrEqual(80);
    expect(decision.verificationStatus).toBe('trusted');
  });

  it('blocks a contradicted core claim from the trusted flow', () => {
    const sources = [
      source({ publisherDomain: 'example.com' }),
      source({ publisherDomain: 'another.org' })
    ];
    const claims = [{ statement: 'Codex 发布新能力', status: 'contradicted', importance: 'core' }];
    const ruleScores = calculateVerificationScoresForTest({
      sources,
      verifiedClaims: claims,
      understanding: { relevanceScore: 95 }
    });
    const decision = finalizeVerificationDecisionForTest({
      ruleScores,
      adjudication: { relevanceScore: 95, contradictionScore: 90 },
      understanding: { directlyRelevant: true, contentType: 'news', riskFlags: [] },
      verifiedClaims: claims
    });

    expect(decision.verificationStatus).toBe('contradicted');
  });
});
