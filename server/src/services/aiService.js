import { env, configState } from '../config/env.js';

const ANALYSIS_PROMPT = `
你是热点真假分析器。你的任务是基于输入字段，判断这条内容是否像“真实热点”，并给出结构化结论。

严格要求：
1. 只输出一个 JSON 对象，不要输出解释、前后缀、Markdown、思考过程。
2. 不要输出 reasoning、分析步骤、知识截止说明。
3. 以输入中的 currentTime 为唯一当前时间依据，不要提“未来时间”“超出知识范围”“未发生”，除非输入文本自己明确这样写。
4. 没有足够证据时，优先给中性判断，不要把缺少信息直接等同于假新闻。
5. summary 必须填写，20-60 个字，优先说明这条内容和 keyword / scope 的关联，不要只复述标题。
6. 如果标题或摘要里直接出现了 keyword，对 summary 的表述要明确这是“直接提及”。
7. evidence 必须填写 2-4 条，每条 10-36 个字，写成具体信号，不要空数组。
8. relevance 是 0-100 整数；importance 只能是 low、medium、high、urgent。

判断参考：
- isReal=true：来自较可靠来源、叙述具体、时间线自洽、像真实事件或真实讨论。
- isReal=false：明显夸张、营销标题、表述失真、来源可疑、缺少基本事实支撑、像搜索噪音或误匹配。
- relevance：和 scope、keyword 的相关程度，而不是新闻热度本身。
- importance：对当前 scope 的业务价值，不是标题夸张程度。

输出格式：
{
  "isReal": true,
  "relevance": 78,
  "importance": "medium",
  "summary": "一句中文关联说明，20到60字。",
  "evidence": ["依据1", "依据2"]
}
`;

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
    max_tokens: maxTokens ?? 220
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

export async function analyzeHotspot({ settings, scope, keyword, item }) {
  const provider = normalizeAiProvider(settings?.aiProvider);
  const currentTime = new Date();
  const payload = {
    scope,
    keyword,
    currentTime: currentTime.toISOString(),
    currentTimeLabel: formatAnalysisDate(currentTime),
    title: item.title,
    snippet: item.snippet,
    url: item.url,
    sourceType: item.sourceType,
    publishedAt: item.sourcePublishedAt,
    publishedAtLabel: formatAnalysisDate(item.sourcePublishedAt)
  };

  let responsePayload = await requestAnalysis({
    provider,
    payload
  });
  let parsed = parseAnalysisResponse(responsePayload);

  if (!parsed) {
    return null;
  }

  return {
    provider,
    isReal: normalizeIsReal(parsed.isReal),
    relevance: normalizeRelevance(parsed.relevance),
    importance: normalizeImportance(parsed.importance),
    summary: normalizeSummary(parsed.summary, item, keyword),
    evidence: normalizeEvidence(parsed.evidence, item, currentTime)
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

function normalizeSummary(value, item, keyword) {
  const summary = String(value || '').trim();
  const fallback = String(item?.snippet || item?.title || '信息不足，需结合原文进一步确认。').trim();
  const base = summary || fallback;

  if (!keyword) {
    return base.slice(0, 120);
  }

  if (base.startsWith('此内容与【') || base.startsWith('【直接提及】此内容与【')) {
    return base.slice(0, 120);
  }

  const directMention = hasDirectKeywordMention(keyword, item);
  const prefix = directMention ? '【直接提及】' : '';
  return `${prefix}此内容与【${keyword}】的关联：${stripTrailingPunctuation(base)}`.slice(0, 120);
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
