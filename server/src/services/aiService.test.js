import { describe, expect, it } from 'vitest';
import { buildAnalysisPrompt, expandKeyword, normalizeSummaryForTest, preMatchKeyword } from './aiService.js';

describe('ai summary normalization', () => {
  it('wraps plain summary with the required keyword template', () => {
    const summary = normalizeSummaryForTest(
      '报道提到阿里千问 3.6 登顶国内编程模型测评榜单。',
      {
        title: '全球权威大模型盲测榜单公布',
        snippet: '第一财经报道阿里千问 3.6 登顶中国最强编程模型'
      },
      'AI编程'
    );

    expect(summary).toBe('此内容与【AI编程】的关联：报道提到阿里千问 3.6 登顶国内编程模型测评榜单');
  });

  it('removes legacy direct-mention prefix while preserving the required template', () => {
    const summary = normalizeSummaryForTest(
      '【直接提及】此内容与【AI编程】的关联：标题直接提到 AI 编程并讨论工具效果。',
      {
        title: 'AI 编程工具争议再起',
        snippet: '文章直接讨论 AI 编程效果'
      },
      'AI编程'
    );

    expect(summary).toBe('此内容与【AI编程】的关联：标题直接提到 AI 编程并讨论工具效果。');
  });

  it('falls back to item snippet when the model summary is empty', () => {
    const summary = normalizeSummaryForTest(
      '',
      {
        title: 'AI 工具融资',
        snippet: '公司因 AI 编程助手业务增长完成新一轮融资。'
      },
      'AI编程'
    );

    expect(summary).toBe('此内容与【AI编程】的关联：标题《AI 工具融资》直接提及该关键词，需结合原文进一步确认具体关联');
  });

  it('strips html markup and entities from fallback snippets', () => {
    const summary = normalizeSummaryForTest(
      '',
      {
        title: 'Show HN: Cordium',
        snippet: 'Hello HN , Cordium is a FOSS <a href=\"https://example.com\">repo</a> that I&#x27;ve been working on.<p>It supports AI agent tasks.'
      },
      'Codex'
    );

    expect(summary).toBe('此内容与【Codex】的关联：标题《Show HN: Cordium》疑似与该关键词相关，需结合原文进一步确认具体关联');
  });
});

describe('keyword expansion and pre-match', () => {
  it('expands split keywords with core terms and adjacent combinations', () => {
    const expanded = expandKeyword('Claude Sonnet 4.6');

    expect(expanded).toContain('Claude Sonnet 4.6');
    expect(expanded).toContain('Claude');
    expect(expanded).toContain('Sonnet');
    expect(expanded).toContain('Claude Sonnet');
    expect(expanded).toContain('Sonnet 4.6');
    expect(expanded.length).toBeLessThanOrEqual(15);
  });

  it('matches keywords using case-insensitive substring matching', () => {
    const expanded = expandKeyword('Claude Sonnet 4.6');
    const result = preMatchKeyword('Anthropic released claude sonnet 4.6 for coding tasks', expanded);

    expect(result.matched).toBe(true);
    expect(result.matchedTerms).toContain('Claude Sonnet');
  });

  it('does not normalize spacing or hyphens during pre-match', () => {
    const result = preMatchKeyword('Anthropic released claude-sonnet-4.6 for coding tasks', ['Claude Sonnet 4.6']);

    expect(result.matched).toBe(false);
    expect(result.matchedTerms).toEqual([]);
  });

  it('does not match unrelated text', () => {
    const result = preMatchKeyword('今日天气晴朗，适合散步', expandKeyword('Claude Sonnet 4.6'));

    expect(result.matched).toBe(false);
    expect(result.matchedTerms).toEqual([]);
  });
});

describe('analysis prompt', () => {
  it('anchors the current date and avoids rejecting new entities by prior knowledge', () => {
    const prompt = buildAnalysisPrompt(
      'Fable 5',
      { matched: true, matchedTerms: ['Fable 5'] },
      { currentDate: '2026-06-18', scope: 'AI 编程' }
    );

    expect(prompt).toContain('当前日期：2026-06-18');
    expect(prompt).toContain('监控语境：AI 编程');
    expect(prompt).toContain('不要仅凭你已有知识');
  });
});
