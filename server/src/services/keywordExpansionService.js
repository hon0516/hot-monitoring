import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { expandKeyword, normalizeAiProvider, requestStructuredAnalysis } from './aiService.js';

const MAX_KEYWORD_VARIANTS = 15;
const LEGACY_FALLBACK_SUFFIXES = ['最新', '发布', '更新', '热点', '进展', '应用'];

const EXPANSION_PROMPT = `
你是一个搜索查询扩展专家。给定一个监控关键词，生成该关键词的变体和相关检索词，用于文本匹配。

规则：
1. 包含原始关键词的各种写法（大小写、空格、连字符变体）
2. 包含关键词的核心组成词（拆分后的各个有意义的词）
3. 包含常见别称、缩写、中英文对照
4. 不要加入泛化词（比如关键词是"Claude Sonnet 4.6"，不要加"AI模型"这种泛化词）
5. 总数控制在 5-15 个

由于当前接口要求 JSON object，请输出：
{
  "keywords": ["Claude Sonnet 4.6", "Claude Sonnet", "Sonnet 4.6", "claude-sonnet-4.6", "Claude 4.6", "Anthropic Sonnet"]
}
只输出 JSON，不要有其他内容。
`;

function normalizeKeywordKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？、；：“”‘’（）【】《》—]+/g, '')
    .trim();
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueKeywords(originalKeyword, candidates, limit = MAX_KEYWORD_VARIANTS) {
  const original = compactWhitespace(originalKeyword);
  const seen = new Set();
  const result = [];

  for (const candidate of [original, ...candidates]) {
    const value = compactWhitespace(candidate);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
}

function fallbackKeywords(keyword) {
  const original = compactWhitespace(keyword);
  return uniqueKeywords(original, expandKeyword(original));
}

function isLegacyFallbackExpansion(keyword, expandedKeywords) {
  const original = compactWhitespace(keyword);
  if (!original || !Array.isArray(expandedKeywords)) {
    return false;
  }

  return expandedKeywords.some((item) =>
    LEGACY_FALLBACK_SUFFIXES.some((suffix) => compactWhitespace(item) === `${original} ${suffix}`)
  );
}

function providerModel(settings) {
  const provider = normalizeAiProvider(settings?.aiProvider);
  if (provider === 'tencent-tokenhub') return env.tencentTokenHubModel;
  if (provider === 'openrouter') return env.openRouterModel;
  return '';
}

function parseExpandedKeywords(value) {
  if (Array.isArray(value?.keywords)) return value.keywords;
  if (Array.isArray(value?.variants)) return value.variants;
  if (Array.isArray(value)) return value;
  return [];
}

export function normalizeExpansionKey(value) {
  return normalizeKeywordKey(value);
}

export async function resolveKeywordExpansion({
  keyword,
  settings,
  prismaClient = prisma,
  requestFn = requestStructuredAnalysis
}) {
  const originalKeyword = compactWhitespace(keyword);
  const normalizedKeyword = normalizeKeywordKey(originalKeyword);
  if (!normalizedKeyword) {
    return {
      keyword: originalKeyword,
      expandedKeywords: [],
      source: 'rule_fallback',
      cached: false
    };
  }

  const cached = await prismaClient.keywordExpansion.findUnique({
    where: { normalizedKeyword }
  });
  if (cached) {
    const cachedKeywords = JSON.parse(cached.expandedKeywordsJson);
    if (isLegacyFallbackExpansion(cached.originalKeyword, cachedKeywords)) {
      const refreshedKeywords = fallbackKeywords(cached.originalKeyword);
      const refreshed = await prismaClient.keywordExpansion.update({
        where: { normalizedKeyword },
        data: {
          expandedKeywordsJson: JSON.stringify(refreshedKeywords),
          source: 'rule_fallback',
          lastUsedAt: new Date()
        }
      });
      return {
        keyword: refreshed.originalKeyword,
        expandedKeywords: refreshedKeywords,
        source: refreshed.source,
        cached: false
      };
    }

    await prismaClient.keywordExpansion.update({
      where: { normalizedKeyword },
      data: { lastUsedAt: new Date() }
    });
    return {
      keyword: cached.originalKeyword,
      expandedKeywords: cachedKeywords,
      source: cached.source,
      cached: true
    };
  }

  let expandedKeywords = [];
  let source = 'ai';
  const provider = normalizeAiProvider(settings?.aiProvider);
  const model = providerModel(settings);

  try {
    const result = await requestFn({
      settings,
      prompt: EXPANSION_PROMPT,
      payload: {
        keyword: originalKeyword,
        scope: settings?.scope || ''
      },
      maxTokens: 500
    });
    const parsedKeywords = parseExpandedKeywords(result.value);
    if (!parsedKeywords.length) {
      throw new Error('Failed to parse keyword expansion response');
    }
    expandedKeywords = uniqueKeywords(originalKeyword, [
      ...expandKeyword(originalKeyword).slice(1),
      ...parsedKeywords
    ]);
  } catch (error) {
    source = 'rule_fallback';
    expandedKeywords = fallbackKeywords(originalKeyword);
  }

  const record = await prismaClient.keywordExpansion.upsert({
    where: { normalizedKeyword },
    update: {
      expandedKeywordsJson: JSON.stringify(expandedKeywords),
      provider,
      model,
      source,
      lastUsedAt: new Date()
    },
    create: {
      normalizedKeyword,
      originalKeyword,
      expandedKeywordsJson: JSON.stringify(expandedKeywords),
      provider,
      model,
      source,
      lastUsedAt: new Date()
    }
  });

  return {
    keyword: record.originalKeyword,
    expandedKeywords,
    source,
    cached: false
  };
}

export async function resolveKeywordExpansions({ keywords, settings, prismaClient = prisma }) {
  const expansions = [];
  for (const keyword of keywords) {
    expansions.push(
      await resolveKeywordExpansion({
        keyword: keyword.term || keyword,
        settings,
        prismaClient
      })
    );
  }
  return expansions;
}

export function expansionListForKeyword(keyword, expansions = []) {
  const normalizedKeyword = normalizeKeywordKey(keyword);
  const match = expansions.find((item) => normalizeKeywordKey(item.keyword) === normalizedKeyword);
  return match?.expandedKeywords?.length ? match.expandedKeywords : fallbackKeywords(keyword);
}

export const keywordExpansionTestUtils = {
  fallbackKeywords,
  uniqueKeywords
};
