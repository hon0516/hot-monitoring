import { env, configState } from '../config/env.js';
import { stripHtml } from '../sources/sourceClient.js';

const ANALYSIS_PROMPT = `
你是关键词感知的热点审核器。基于 keyword、preMatch、title、snippet 和 ruleAudit，判断内容是否真实、是否直接相关。

要求：
1. 只输出一个 JSON 对象。
2. 不要输出解释、Markdown、推理过程。
3. 重点区分：真实存在、直接相关、值得作为热点展示。
4. 同领域但没有直接提及 keyword 或等价说法，relevance 必须低于 60。
5. 教程、合集、搜索结果页、营销内容即使包含 keyword，也默认 low 或 medium。
6. summary 必须用中文，格式固定为：此内容与【keyword】的关联：...
7. relevanceReason 用一句话解释相关性打分理由，不要写推理过程。
8. relevance 是 0-100 整数；importance 只能是 low、medium、high、urgent。

返回：
{
  "isReal": true,
  "confidence": 72,
  "relevance": 78,
  "relevanceReason": "标题直接提及关键词并讨论其产品更新。",
  "keywordMentioned": true,
  "importance": "medium",
  "riskFlags": ["low_evidence"],
  "summary": "此内容与【AI编程】的关联：..."
}
`;

const MAX_ANALYSIS_TITLE_CHARS = 160;
const MAX_ANALYSIS_SNIPPET_CHARS = 320;
const MAX_ANALYSIS_OUTPUT_TOKENS = 120;
const MAX_KEYWORD_VARIANTS = 12;

const keywordExpansionCache = new Map();

function trimText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function uniqueCompactList(items, limit = MAX_KEYWORD_VARIANTS) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const value = String(item || '').replace(/\s+/g, ' ').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function splitKeywordParts(keyword) {
  return String(keyword || '')
    .split(/[\s\-_\/\\·|,，、]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function addAiProgrammingAliases(keyword, variants) {
  const normalized = normalizeKeyword(keyword);
  if (!normalized.includes('ai') || !/(编程|代码|coding|programming|coder|code)/iu.test(keyword)) {
    return;
  }

  variants.push('AI 编程', 'AI编程', 'AI coding', 'AI programming', 'AI code generation', 'AI coding agent');
}

export function expandKeyword(keyword) {
  const normalizedKeyword = String(keyword || '').trim();
  if (!normalizedKeyword) {
    return [];
  }

  const cacheKey = normalizedKeyword.toLowerCase();
  if (keywordExpansionCache.has(cacheKey)) {
    return keywordExpansionCache.get(cacheKey);
  }

  const variants = [normalizedKeyword];
  const parts = splitKeywordParts(normalizedKeyword);
  variants.push(...parts);

  for (let index = 0; index < parts.length - 1; index += 1) {
    variants.push(`${parts[index]} ${parts[index + 1]}`);
    variants.push(`${parts[index]}-${parts[index + 1]}`);
  }

  if (/^[a-z0-9\s\-_./]+$/iu.test(normalizedKeyword)) {
    variants.push(normalizedKeyword.replace(/[-_./]+/g, ' '));
    variants.push(normalizedKeyword.replace(/\s+/g, '-'));
  }

  addAiProgrammingAliases(normalizedKeyword, variants);

  const expanded = uniqueCompactList(variants);
  keywordExpansionCache.set(cacheKey, expanded);
  return expanded;
}

export function preMatchKeyword(text, expandedKeywords = []) {
  const rawText = String(text || '').toLowerCase();
  const comparableText = normalizeKeyword(text);
  const matchedTerms = [];

  for (const keyword of expandedKeywords) {
    const rawKeyword = String(keyword || '').trim().toLowerCase();
    const comparableKeyword = normalizeKeyword(keyword);
    if (!rawKeyword || !comparableKeyword) {
      continue;
    }

    if (rawText.includes(rawKeyword) || comparableText.includes(comparableKeyword)) {
      matchedTerms.push(keyword);
    }
  }

  return {
    matched: matchedTerms.length > 0,
    matchedTerms: uniqueCompactList(matchedTerms, 6)
  };
}

function compactRuleAudit(evidencePackage) {
  if (!evidencePackage) {
    return null;
  }

  return {
    auditVersion: evidencePackage.auditVersion,
    sourceType: evidencePackage.sourceType,
    hostname: evidencePackage.hostname,
    sourceQualityScore: evidencePackage.sourceQualityScore,
    ruleTrustScore: evidencePackage.ruleTrustScore,
    ruleRelevanceScore: evidencePackage.ruleRelevanceScore,
    contentType: evidencePackage.contentType,
    keywordMatchType: evidencePackage.keywordMatchType,
    riskFlags: Array.isArray(evidencePackage.riskFlags) ? evidencePackage.riskFlags.slice(0, 4) : [],
    positiveSignals: Array.isArray(evidencePackage.positiveSignals) ? evidencePackage.positiveSignals.slice(0, 4) : [],
    ruleEvidence: Array.isArray(evidencePackage.ruleEvidence)
      ? evidencePackage.ruleEvidence.map((item) => trimText(item, 48)).slice(0, 3)
      : []
  };
}

function buildAnalysisPayload({ scope, keyword, item, evidencePackage, preMatch, currentTime }) {
  return {
    scope,
    keyword,
    currentTime: currentTime.toISOString(),
    title: trimText(item?.title, MAX_ANALYSIS_TITLE_CHARS),
    snippet: trimText(stripHtml(item?.snippet || ''), MAX_ANALYSIS_SNIPPET_CHARS),
    sourceType: item?.sourceType || '',
    publishedAt: item?.sourcePublishedAt || null,
    preMatch: {
      matched: Boolean(preMatch?.matched),
      matchedTerms: Array.isArray(preMatch?.matchedTerms) ? preMatch.matchedTerms.slice(0, 6) : []
    },
    ruleAudit: compactRuleAudit(evidencePackage)
  };
}

const AI_PROVIDERS = {
  'tencent-tokenhub': {
    label: '腾讯 TokenHub',
    hasKey: () => configState.hasTencentTokenHubKey,
    endpoint: () => `${String(env.tencentTokenHubBaseUrl || '').replace(/\/+$/, '')}/chat/completions`,
    apiKey: () => env.tencentTokenHubApiKey,
    model: () => env.tencentTokenHubModel,
    supportsJsonResponseFormat: true,
    disableThinking: true
  },
  openrouter: {
    label: 'OpenRouter',
    hasKey: () => configState.hasOpenRouterKey,
    endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: () => env.openRouterApiKey,
    model: () => env.openRouterModel,
    supportsJsonResponseFormat: true
  }
};

export function normalizeAiProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['tencent-tokenhub', 'openrouter'].includes(normalized)) {
    return normalized;
  }
  return 'openrouter';
}

export function getAiProviderRuntimeStatus(provider) {
  const normalized = normalizeAiProvider(provider);
  const config = AI_PROVIDERS[normalized];

  return {
    provider: normalized,
    label: config.label,
    available: config.hasKey()
  };
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function requestAnalysis({ provider, payload, prompt = ANALYSIS_PROMPT, maxTokens }) {
  const config = AI_PROVIDERS[provider];

  if (!config) {
    throw new Error(`不支持的 AI 提供方: ${provider}`);
  }

  if (!config.hasKey()) {
    throw new Error(`${config.label} 未配置接口密钥`);
  }

  const body = {
    model: config.model(),
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify(payload)
      }
    ],
    max_tokens: maxTokens ?? MAX_ANALYSIS_OUTPUT_TOKENS
  };

  if (config.supportsJsonResponseFormat) {
    body.response_format = {
      type: 'json_object'
    };
  }

  if (config.disableThinking) {
    body.thinking = {
      type: 'disabled'
    };
  }

  body.temperature = 0.1;

  let response;
  let lastError;
  const maxAttempts = 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.aiAnalysisTimeoutMs);

    try {
      response = await fetch(config.endpoint(), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error?.name !== 'AbortError' || attempt >= maxAttempts) {
        break;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastError) {
    if (lastError?.name === 'AbortError') {
      const retrySuffix = maxAttempts > 1 ? `，已重试 ${maxAttempts} 次` : '';
      throw new Error(`${config.label} 分析超时: ${env.aiAnalysisTimeoutMs}ms${retrySuffix}`);
    }
    throw lastError;
  }

  if (!response.ok) {
    let details = '';
    try {
      const text = String(await response.text() || '').trim();
      if (text) {
        details = text.slice(0, 240);
      }
    } catch {
      details = '';
    }

    const suffix = details ? ` - ${details}` : '';
    throw new Error(`${config.label} 分析失败: ${response.status}${suffix}`);
  }

  return response.json();
}

export async function requestStructuredAnalysis({ settings, prompt, payload, maxTokens = 1200 }) {
  const provider = normalizeAiProvider(settings?.aiProvider);
  const responsePayload = await requestAnalysis({
    provider,
    payload,
    prompt,
    maxTokens
  });

  return {
    provider,
    value: parseAnalysisResponse(responsePayload)
  };
}

export async function analyzeHotspot({ settings, scope, keyword, item, evidencePackage, preMatch, prompt = ANALYSIS_PROMPT }) {
  const provider = normalizeAiProvider(settings?.aiProvider);
  const currentTime = new Date();
  const payload = buildAnalysisPayload({
    scope,
    keyword,
    item,
    evidencePackage,
    preMatch,
    currentTime
  });

  let responsePayload = await requestAnalysis({
    provider,
    payload,
    prompt
  });
  let parsed = parseAnalysisResponse(responsePayload);

  if (!parsed) {
    return null;
  }

  return {
    provider,
    isReal: normalizeIsReal(parsed.isReal),
    confidence: normalizeRelevance(parsed.confidence),
    relevance: normalizeRelevance(parsed.relevance),
    relevanceReason: normalizeReason(parsed.relevanceReason),
    keywordMentioned: normalizeKeywordMentioned(parsed.keywordMentioned, preMatch),
    importance: normalizeImportance(parsed.importance),
    riskFlags: normalizeRiskFlags(parsed.riskFlags),
    summary: buildHotspotSummary({ value: parsed.summary, item, keyword }),
    evidence: normalizeEvidence(parsed.relevanceReason || parsed.evidence, item, currentTime)
  };
}

function parseAnalysisResponse(responsePayload) {
  const choice = responsePayload?.choices?.[0];
  const content = String(choice?.message?.content || '').trim();
  if (!content) {
    return null;
  }

  return safeJsonParse(content);
}

function normalizeIsReal(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }

  return null;
}

function normalizeRelevance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 50;
  }

  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function normalizeImportance(value) {
  return ['low', 'medium', 'high', 'urgent'].includes(value) ? value : 'medium';
}

function normalizeKeywordMentioned(value, preMatch) {
  if (typeof value === 'boolean') {
    return value;
  }

  return Boolean(preMatch?.matched);
}

function normalizeRiskFlags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6);
}

function normalizeReason(value) {
  return stripHtml(value || '').trim().slice(0, 160);
}

function normalizeSummary(value, item, keyword) {
  return buildHotspotSummary({ value, item, keyword });
}

function summarizeFallbackText(item) {
  const fallback = stripHtml(item?.snippet || item?.title || '信息不足，需结合原文进一步确认。').trim();
  return fallback || '信息不足，需结合原文进一步确认。';
}

function buildFallbackRelationText(item, keyword) {
  const cleanTitle = stripHtml(item?.title || '').trim();
  const cleanSnippet = stripHtml(item?.snippet || '').trim();

  if (!keyword) {
    return summarizeFallbackText(item);
  }

  if (hasDirectKeywordMention(keyword, item)) {
    if (cleanTitle) {
      return `标题《${cleanTitle}》直接提及该关键词，需结合原文进一步确认具体关联`;
    }

    return `原始内容直接提及该关键词，需结合原文进一步确认具体关联`;
  }

  if (cleanTitle) {
    return `标题《${cleanTitle}》疑似与该关键词相关，需结合原文进一步确认具体关联`;
  }

  if (cleanSnippet) {
    return `原始内容提到相关线索，需结合原文进一步确认其与该关键词的具体关联`;
  }

  return '信息不足，需结合原文进一步确认其与该关键词的具体关联';
}

export function buildHotspotSummary({ value, item, keyword }) {
  const summary = stripHtml(value || '').trim();
  const base = summary || buildFallbackRelationText(item, keyword);

  if (!keyword) {
    return base.slice(0, 120);
  }

  if (base.startsWith('【直接提及】此内容与【')) {
    return base.replace(/^【直接提及】/u, '').slice(0, 120);
  }

  if (base.startsWith('此内容与【')) {
    return base.slice(0, 120);
  }

  return `此内容与【${keyword}】的关联：${stripTrailingPunctuation(base)}`.slice(0, 120);
}

function hasDirectKeywordMention(keyword, item) {
  const needle = normalizeKeyword(keyword);
  if (!needle) {
    return false;
  }

  const haystack = normalizeKeyword([item?.title, item?.snippet].filter(Boolean).join(' '));
  return haystack.includes(needle);
}

function normalizeKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？、；：“”‘’（）【】《》—]+/g, '');
}

function stripTrailingPunctuation(value) {
  return String(value || '').trim().replace(/[。；;，,！!？?、]+$/g, '');
}

export function normalizeSummaryForTest(value, item, keyword) {
  return buildHotspotSummary({ value, item, keyword });
}

function normalizeEvidence(value, item, now) {
  const normalized = sanitizeEvidenceText(value, { publishedAt: item?.sourcePublishedAt, now });
  if (normalized) {
    return normalized;
  }

  const fallback = [
    item?.sourceType ? `来源为 ${item.sourceType}，需结合原文判断。` : '来源信息有限，需结合原文判断。',
    item?.sourcePublishedAt ? `发布时间可解析，时间线基本自洽。` : '发布时间缺失，可信度需保守评估。'
  ];

  return fallback.join('\n').slice(0, 240);
}

export function sanitizeEvidenceText(value, { publishedAt, now = new Date() } = {}) {
  const lines = normalizeEvidenceLines(value);
  const publishedDate = toValidDate(publishedAt);
  const currentDate = toValidDate(now) || new Date();

  const sanitized = lines.filter((line) => !shouldDropFutureLine(line, publishedDate, currentDate)).slice(0, 4);

  if (sanitized.length) {
    return sanitized.join('\n').slice(0, 240);
  }

  if (lines.length && publishedDate && publishedDate.getTime() <= currentDate.getTime()) {
    return `发布时间为 ${formatAnalysisDate(publishedDate)}，与当前时间线一致。`;
  }

  return lines.slice(0, 4).join('\n').slice(0, 240);
}

function normalizeEvidenceLines(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(/\n+|(?<=[。；;])/u)
    .map((item) => item.replace(/^[-*•\d.\s]+/u, '').trim())
    .filter(Boolean);
}

function shouldDropFutureLine(line, publishedDate, currentDate) {
  if (!publishedDate || !currentDate) {
    return false;
  }

  if (publishedDate.getTime() > currentDate.getTime()) {
    return false;
  }

  return /(未来|未发生|超出当前时间范围|超出当前时间|超出知识训练范围|时间信息虚假|不切实际|当前时间范围|未来信息)/u.test(line);
}

function toValidDate(value) {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAnalysisDate(value) {
  const date = toValidDate(value);
  if (!date) {
    return '未知时间';
  }

  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
