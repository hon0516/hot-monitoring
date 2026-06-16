import { describe, expect, it } from 'vitest';
import { buildEvidencePackage, finalizeAudit, shouldStoreAuditedCandidate, shouldUseAiReview } from './auditService.js';

describe('audit service', () => {
  it('skips numeric and duration-like titles before AI review', () => {
    const audit = buildEvidencePackage({
      item: {
        title: '00:17:22',
        snippet: '',
        url: 'https://www.bilibili.com/video/BV1abc',
        sourceType: 'bilibili'
      },
      keyword: 'AI编程',
      scope: 'AI 编程'
    });

    expect(audit.shouldSkip).toBe(true);
    expect(audit.riskFlags).toContain('numeric_or_duration_title');
  });

  it('downgrades search result collection pages', () => {
    const evidencePackage = buildEvidencePackage({
      item: {
        title: 'AI编程 AI 编程 的更多内容_CSDN技术社区',
        snippet: 'AI编程相关搜索结果和更多内容',
        url: 'https://www.sogou.com/link?query=ai',
        sourceType: 'sogou'
      },
      keyword: 'AI编程',
      scope: 'AI 编程'
    });
    const audit = finalizeAudit({ evidencePackage, analysis: null });

    expect(audit.auditStatus).toBe('noise');
    expect(audit.trustScore).toBeLessThan(50);
    expect(audit.auditFlags).toContain('search_noise');
    expect(audit.evidence[0]).toMatch(/^相关性理由：/u);
  });

  it('keeps direct but tutorial-like content out of high trust by default', () => {
    const evidencePackage = buildEvidencePackage({
      item: {
        title: '轻松学会!高手都在用的 AI编程 大法!',
        snippet: '零基础 AI 编程教程',
        url: 'https://www.bilibili.com/video/BV1abc',
        sourceType: 'bilibili',
        sourcePublishedAt: new Date().toISOString()
      },
      keyword: 'AI编程',
      scope: 'AI 编程'
    });
    const audit = finalizeAudit({
      evidencePackage,
      analysis: {
        isReal: true,
        auditStatus: 'trusted',
        confidence: 80,
        trustScore: 85,
        relevance: 90,
        importance: 'medium',
        contentType: 'tutorial',
        riskFlags: [],
        evidence: ['标题直接提及关键词', '发布时间较近']
      }
    });

    expect(audit.auditStatus).toBe('needs_review');
    expect(audit.auditFlags).toContain('tutorial_not_hotspot');
    expect(audit.auditFlags).toContain('marketing_language');
    expect(audit.evidence[0]).toContain('相关性理由');
  });

  it('puts AI relevance reason first when available', () => {
    const evidencePackage = buildEvidencePackage({
      item: {
        title: 'AI 编程工具发布重大更新',
        snippet: '官方发布 AI 编程工具更新。',
        url: 'https://example.com/news',
        sourceType: 'bing',
        sourcePublishedAt: new Date().toISOString()
      },
      keyword: 'AI编程',
      scope: 'AI 编程',
      preMatch: { matched: true, matchedTerms: ['AI编程'] }
    });
    const audit = finalizeAudit({
      evidencePackage,
      analysis: {
        isReal: true,
        confidence: 88,
        relevance: 92,
        relevanceReason: '标题和摘要均直接讨论 AI 编程工具更新。',
        keywordMentioned: true,
        importance: 'high',
        riskFlags: []
      }
    });

    expect(audit.evidence[0]).toBe('相关性理由：标题和摘要均直接讨论 AI 编程工具更新。');
  });

  it('does not spend AI review on strong trusted rule matches', () => {
    const preMatch = { matched: true, matchedTerms: ['AI编程'] };
    const evidencePackage = buildEvidencePackage({
      item: {
        title: 'OpenAI 发布新的 AI 编程 Agent 能力',
        snippet: 'OpenAI 官方宣布 AI 编程 Agent 更新，面向开发者开放。',
        url: 'https://openai.com/index/coding-agent',
        sourceType: 'google-news',
        sourcePublishedAt: new Date().toISOString()
      },
      keyword: 'AI编程',
      scope: 'AI 编程',
      preMatch
    });

    expect(evidencePackage.ruleTrustScore).toBeGreaterThanOrEqual(82);
    expect(shouldUseAiReview(evidencePackage, preMatch)).toBe(false);
  });

  it('uses AI review for boundary candidates only', () => {
    const preMatch = { matched: true, matchedTerms: ['AI coding'] };
    const evidencePackage = buildEvidencePackage({
      item: {
        title: 'Developer shares AI coding workflow update',
        snippet: 'A developer discusses a new AI coding workflow and recent tool changes.',
        url: 'https://x.com/example/status/1',
        sourceType: 'twitter',
        sourcePublishedAt: new Date().toISOString()
      },
      keyword: 'AI编程',
      scope: 'AI 编程',
      preMatch
    });

    expect(evidencePackage.ruleTrustScore).toBeGreaterThanOrEqual(55);
    expect(evidencePackage.ruleTrustScore).toBeLessThanOrEqual(78);
    expect(shouldUseAiReview(evidencePackage, preMatch)).toBe(true);
  });

  it('filters low relevance items before storage', () => {
    const audit = {
      auditStatus: 'needs_review',
      relevanceScore: 42
    };

    expect(shouldStoreAuditedCandidate({ analysis: null, audit, preMatch: { matched: false } })).toBe(false);
  });
});
