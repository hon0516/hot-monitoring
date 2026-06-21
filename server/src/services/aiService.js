import { env, configState } from '../config/env.js';
import { stripHtml } from '../sources/sourceClient.js';

const MAX_ANALYSIS_OUTPUT_TOKENS = 120;
const MAX_KEYWORD_VARIANTS = 15;
const VALID_IMPORTANCE = new Set(['low', 'medium', 'high', 'urgent']);

const keywordExpansionCache = new Map();

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

export function expandKeyword(keyword) {
  const normalizedKeyword = String(keyword || '').trim();
  if (!normalizedKeyword) {
    return [];
  }

  const cacheKey = normalizedKeyword.toLowerCase();
  if (keywordExpansionCache.has(cacheKey)) {
    return keywordExpansionCache.get(cacheKey);
  }

  const expanded = uniqueCompactList([normalizedKeyword, ...extractCoreTerms(normalizedKeyword)]);
  keywordExpansionCache.set(cacheKey, expanded);
  return expanded;
}

export function extractCoreTerms(keyword) {
  const original = String(keyword || '').trim();
  const parts = original.split(/[\s\-_\/\\·]+/u).filter((part) => part.length >= 2);
  const terms = [];

  if (parts.length > 1) {
    terms.push(...parts);
    for (let index = 0; index < parts.length - 1; index += 1) {
      terms.push(`${parts[index]} ${parts[index + 1]}`);
    }
  }

  return uniqueCompactList(terms).filter((term) => term.toLowerCase() !== original.toLowerCase());
}

export function preMatchKeyword(text, expandedKeywords = []) {
  const rawText = String(text || '').toLowerCase();
  const matchedTerms = [];

  for (const keyword of expandedKeywords) {
    const rawKeyword = String(keyword || '').trim().toLowerCase();
    if (!rawKeyword) {
      continue;
    }

    if (rawText.includes(rawKeyword)) {
      matchedTerms.push(keyword);
    }
  }

  return {
    matched: matchedTerms.length > 0,
    matchedTerms
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

async function requestAnalysis({ provider, payload, prompt, maxTokens, temperature = 0.1 }) {
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
        content: typeof payload === 'string' ? payload : JSON.stringify(payload)
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

  body.temperature = temperature;

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

export async function requestStructuredAnalysis({ settings, prompt, payload, maxTokens = 1200, temperature = 0.1 }) {
  const provider = normalizeAiProvider(settings?.aiProvider);
  const responsePayload = await requestAnalysis({
    provider,
    payload,
    prompt,
    maxTokens,
    temperature
  });

  return {
    provider,
    value: parseAnalysisResponse(responsePayload)
  };
}

function formatShanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function buildAnalysisPrompt(keyword, preMatchResult = { matched: false, matchedTerms: [] }, options = {}) {
  const matchHint = preMatchResult.matched
    ? `\n注意：文本预匹配发现内容中包含以下关键词变体：${preMatchResult.matchedTerms.join('、')}`
    : `\n注意：文本预匹配发现内容中未直接提及关键词"${keyword}"的任何变体，请特别严格审核相关性。`;
  const scopeHint = options.scope ? `\n监控语境：${options.scope}` : '';
  const currentDate = options.currentDate || formatShanghaiDate();

  return `你是一个热点内容精准匹配专家。你的任务是判断一段内容是否与指定的监控关键词【${keyword}】直接相关。

当前日期：${currentDate}。不要把早于或等于当前日期的内容误判为未来内容。${scopeHint}
${matchHint}

分析要点：
1. 判断是否为真实有价值的信息（排除标题党、假新闻、营销软文）
2. 判断内容是否【直接】涉及关键词"${keyword}"。注意：
   - 仅仅属于同一领域但未提及关键词的内容，相关性应低于 40 分
   - 内容必须直接讨论、提及或与"${keyword}"有实质关联才能获得 60 分以上
   - 只是间接沾边（如同类产品、同领域但不同主题）应给 30-50 分
3. 判断内容中是否直接提及了"${keyword}"或其等价表述（keywordMentioned）
4. 评估热点的重要程度（对关注"${keyword}"的人来说有多重要）
5. 用一句话说明此内容与"${keyword}"的关系（不是介绍内容本身，而是说"此内容与关键词的关联是什么"）
6. 用一句话解释你的相关性打分理由
7. 关键词可能是新模型、新产品、新版本或小众项目，不要仅凭你已有知识认为它应当是另一个实体而判假；如果文本直接围绕"${keyword}"展开，且不是明显诈骗/纯广告/乱码，应优先按相关内容处理。
8. 如果内容是教程、实测、对比、发布、封禁、更新、源码解析等，并且直接围绕"${keyword}"，即使带有营销话术，也可以认为是有价值信息。

请以 JSON 格式输出：
{
  "isReal": true/false,
  "relevance": 0-100,
  "relevanceReason": "相关性打分理由...",
  "keywordMentioned": true/false,
  "importance": "low/medium/high/urgent",
  "summary": "此内容与【${keyword}】的关联：..."
}

只输出 JSON，不要有其他内容。`;
}

function clampRelevance(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 0;
}

function fallbackSummary(content) {
  return `${String(content || '').slice(0, 50)}...`;
}

function normalizeAnalysisResult(value) {
  return {
    isReal: Boolean(value?.isReal),
    relevance: clampRelevance(value?.relevance),
    relevanceReason: String(value?.relevanceReason || '').slice(0, 200),
    keywordMentioned: Boolean(value?.keywordMentioned),
    importance: VALID_IMPORTANCE.has(value?.importance) ? value.importance : 'low',
    summary: String(value?.summary || '').slice(0, 150)
  };
}

export async function analyzeContent(content, keyword, preMatchResult, settings = {}) {
  const matchResult = preMatchResult ?? { matched: false, matchedTerms: [] };
  const providerStatus = getAiProviderRuntimeStatus(settings?.aiProvider);

  if (!providerStatus.available) {
    return {
      isReal: true,
      relevance: matchResult.matched ? 50 : 20,
      relevanceReason: '未配置 AI 服务，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: fallbackSummary(content),
      aiCalled: false,
      aiFailed: false,
      aiError: ''
    };
  }

  try {
    const result = await requestStructuredAnalysis({
      settings,
      prompt: buildAnalysisPrompt(keyword, matchResult, { scope: settings?.scope }),
      payload: String(content || '').slice(0, 2000),
      temperature: 0.2,
      maxTokens: 500
    });

    if (!result.value) {
      throw new Error('Failed to parse AI response');
    }

    const analysis = normalizeAnalysisResult(result.value);
    return {
      ...analysis,
      aiCalled: true,
      aiFailed: false,
      aiError: ''
    };
  } catch (error) {
    console.error('AI analysis failed:', error);
    return {
      isReal: true,
      relevance: matchResult.matched ? 30 : 10,
      relevanceReason: 'AI 分析失败，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: fallbackSummary(content),
      aiCalled: true,
      aiFailed: true,
      aiError: error.message || 'AI 分析失败'
    };
  }
}

function parseAnalysisResponse(responsePayload) {
  const choice = responsePayload?.choices?.[0];
  const content = String(choice?.message?.content || '').trim();
  if (!content) {
    return null;
  }

  return safeJsonParse(content);
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
