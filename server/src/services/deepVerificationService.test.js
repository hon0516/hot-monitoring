import { describe, expect, it } from 'vitest';
import {
  calculateVerificationScoresForTest,
  finalizeVerificationDecisionForTest
} from './deepVerificationService.js';
import { verificationConfig, getSourceAuthority, matchOfficialSource } from '../config/verificationConfig.js';

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

  it('keeps a blocked content type out of the trusted flow despite high scores', () => {
    const sources = [
      source({ publisherDomain: 'example.com' }),
      source({ publisherDomain: 'another.org', sourceType: 'bing' })
    ];
    const claims = [{ statement: 'Codex 教程合集', status: 'supported', importance: 'core' }];
    const ruleScores = calculateVerificationScoresForTest({
      sources,
      verifiedClaims: claims,
      understanding: { relevanceScore: 96 }
    });
    const decision = finalizeVerificationDecisionForTest({
      ruleScores,
      adjudication: { relevanceScore: 96, evidenceScore: 95, corroborationScore: 95, contradictionScore: 0 },
      // tutorial 属于 blockedContentTypes
      understanding: { directlyRelevant: true, contentType: 'tutorial', riskFlags: [] },
      verifiedClaims: claims
    });

    expect(verificationConfig.blockedContentTypes).toContain('tutorial');
    expect(decision.verificationStatus).not.toBe('trusted');
  });

  it('keeps missing body content out of the trusted flow', () => {
    const sources = [
      source({ publisherDomain: 'example.com', fetchStatus: 'metadata_only' }),
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
      adjudication: { relevanceScore: 96, evidenceScore: 95, corroborationScore: 95, contradictionScore: 0 },
      understanding: { directlyRelevant: true, contentType: 'news', riskFlags: ['body_unavailable'] },
      verifiedClaims: claims
    });

    expect(ruleScores.hasBodyGate).toBe(false);
    expect(decision.verificationStatus).toBe('needs_review');
  });
});

describe('verificationConfig.getSourceAuthority', () => {
  it('returns the official score when the source is official', () => {
    expect(getSourceAuthority('sogou', { isOfficial: true })).toBe(verificationConfig.sourceAuthority.official);
  });

  it('falls back to the default score for unknown sources', () => {
    expect(getSourceAuthority('unknown-source')).toBe(verificationConfig.sourceAuthority.default);
  });

  it('uses the per-source authority for known sources', () => {
    expect(getSourceAuthority('google-news')).toBe(verificationConfig.sourceAuthority['google-news']);
  });
});

describe('verificationConfig.matchOfficialSource', () => {
  it('matches an official GitHub organization path', () => {
    const result = matchOfficialSource({ url: 'https://github.com/openai/openai-node' });

    expect(result.isOfficial).toBe(true);
    expect(result.officialEntity).toBe('OpenAI');
  });

  it('does not treat arbitrary GitHub repositories as official', () => {
    const result = matchOfficialSource({ url: 'https://github.com/random-user/openai-example' });

    expect(result.isOfficial).toBe(false);
  });
});
