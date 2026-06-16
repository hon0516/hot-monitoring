import { normalizeTitle, normalizeUrl, parseImportanceRank } from '../utils/normalize.js';
import { env } from '../config/env.js';

export const AUDIT_VERSION = 'trust-v1';

const SOURCE_QUALITY = {
  'google-news': 84,
  bing: 78,
  'hacker-news': 76,
  twitter: 58,
  weibo: 52,
  bilibili: 48,
  sogou: 36
};

const TRUSTED_DOMAINS = [
  'github.com',
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'googleblog.com',
  'microsoft.com',
  'developer.microsoft.com',
  'cloud.tencent.com',
  'infoq.cn',
  '36kr.com',
  'theverge.com',
  'techcrunch.com'
];

const SEARCH_NOISE_PATTERNS = [
  /精选视频/u,
  /更多内容/u,
  /相关搜索/u,
  /搜索结果/u,
  /大家还在搜/u,
  /资料大全/u,
  /网站导航/u,
  /排行榜/u
];

const COLLECTION_PATTERNS = [/合集/u, /专题/u, /第\s*\d+\s*[集期]/u, /#\s*\d+/u, /入门秘籍/u];
const MARKETING_PATTERNS = [/轻松学会/u, /高手都在用/u, /神器/u, /秘籍/u, /变身/u, /躺赚/u, /摸鱼/u, /猴子看完也能/u];
const TIME_OR_NUMBER_PATTERNS = [/^\d{1,2}:?\d{2}(?::?\d{2})?$/u, /^\d+[:：]\d+$/u, /^\d{4,}$/u];

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？、；：“”‘’（）【】《》—]+/g, '');
}

function getHostname(url) {
  if (!url) return '';

  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    const normalized = normalizeUrl(url);
    return String(normalized || '').split('/')[0].replace(/^www\./, '').toLowerCase();
  }
}

function parseEngagement(engagementJson) {
  if (!engagementJson) return {};
  if (typeof engagementJson === 'object') return engagementJson;

  try {
    return JSON.parse(engagementJson);
  } catch {
    return {};
  }
}

function getKeywordMatchType({ keyword, scope, item }) {
  const title = normalizeComparableText(item?.title);
  const snippet = normalizeComparableText(item?.snippet);
  const keywordText = normalizeComparableText(keyword);
  const scopeText = normalizeComparableText(scope);

  if (keywordText && title.includes(keywordText)) return 'title';
  if (keywordText && snippet.includes(keywordText)) return 'snippet';
  if (scopeText && title.includes(scopeText)) return 'scope-title';
  if (scopeText && snippet.includes(scopeText)) return 'scope-snippet';
  return 'query';
}

function inferContentType(title, snippet) {
  const text = `${title} ${snippet}`;
  if (SEARCH_NOISE_PATTERNS.some((pattern) => pattern.test(text))) return 'search_noise';
  if (COLLECTION_PATTERNS.some((pattern) => pattern.test(text))) return 'collection';
  if (/教程|入门|指南|怎么|如何|course|tutorial/iu.test(text)) return 'tutorial';
  if (/发布|上线|宣布|融资|开源|更新|推出|released|launch|announc/iu.test(text)) return 'event';
  return 'discussion';
}

function hasTrustedDomain(hostname) {
  return TRUSTED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function hasRecentPublishedAt(value) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= 14 * 24 * 60 * 60 * 1000;
}

function buildRuleSignals({ item, keyword, scope, preMatch }) {
  const title = String(item?.title || '').trim();
  const snippet = String(item?.snippet || '').trim();
  const hostname = getHostname(item?.url);
  const normalizedTitle = normalizeTitle(title);
  const engagement = parseEngagement(item?.engagementJson);
  const sourceQualityScore = SOURCE_QUALITY[item?.sourceType] ?? 45;
  const contentType = inferContentType(title, snippet);
  const keywordMatchType = getKeywordMatchType({ keyword, scope, item });
  const flags = [];
  const positiveSignals = [];

  if (!title || normalizedTitle.length < 4) flags.push('title_too_short');
  if (TIME_OR_NUMBER_PATTERNS.some((pattern) => pattern.test(title.replace(/\s+/g, '')))) flags.push('numeric_or_duration_title');
  if (!snippet && sourceQualityScore < 70) flags.push('missing_snippet_low_source');
  if (contentType === 'search_noise') flags.push('search_noise');
  if (contentType === 'collection') flags.push('collection_or_series');
  if (contentType === 'tutorial') flags.push('tutorial_not_hotspot');
  if (MARKETING_PATTERNS.some((pattern) => pattern.test(`${title} ${snippet}`))) flags.push('marketing_language');

  const keywordComparable = normalizeComparableText(keyword);
  const titleComparable = normalizeComparableText(title);
  if (keywordComparable && titleComparable === keywordComparable) flags.push('title_is_query');

  if (hasTrustedDomain(hostname)) positiveSignals.push('trusted_domain');
  if (hasRecentPublishedAt(item?.sourcePublishedAt)) positiveSignals.push('recent_publish_time');
  if (keywordMatchType === 'title' || keywordMatchType === 'scope-title') positiveSignals.push('direct_title_match');
  if (preMatch?.matched) positiveSignals.push('keyword_variant_match');
  if (engagement.authorVerified) positiveSignals.push('verified_author');
  if (Number(engagement.views || engagement.reads || 0) >= 10000) positiveSignals.push('meaningful_views');
  if (Number(engagement.likes || engagement.points || 0) >= 100) positiveSignals.push('meaningful_reactions');

  return {
    title,
    snippet,
    hostname,
    normalizedTitle,
    sourceQualityScore,
    contentType,
    keywordMatchType,
    keywordMentioned: Boolean(preMatch?.matched || keywordMatchType === 'title' || keywordMatchType === 'snippet'),
    engagement,
    flags,
    positiveSignals
  };
}

function shouldSkipCandidate(signals) {
  const hardFlags = new Set(['numeric_or_duration_title', 'title_too_short', 'title_is_query']);
  if (signals.flags.some((flag) => hardFlags.has(flag))) return true;
  return signals.flags.includes('missing_snippet_low_source') && signals.flags.includes('search_noise');
}

function scoreRules(signals) {
  let trustScore = signals.sourceQualityScore;
  let relevanceScore = signals.keywordMatchType.includes('title') ? 76 : 42;

  if (signals.positiveSignals.includes('trusted_domain')) trustScore += 12;
  if (signals.positiveSignals.includes('recent_publish_time')) trustScore += 8;
  if (signals.positiveSignals.includes('verified_author')) trustScore += 8;
  if (signals.positiveSignals.includes('meaningful_views')) trustScore += 7;
  if (signals.positiveSignals.includes('meaningful_reactions')) trustScore += 5;
  if (signals.positiveSignals.includes('keyword_variant_match')) relevanceScore += 18;

  if (signals.flags.includes('search_noise')) trustScore -= 34;
  if (signals.flags.includes('collection_or_series')) trustScore -= 16;
  if (signals.flags.includes('tutorial_not_hotspot')) trustScore -= 12;
  if (signals.flags.includes('marketing_language')) trustScore -= 10;
  if (signals.flags.includes('missing_snippet_low_source')) trustScore -= 14;

  if (signals.keywordMatchType === 'snippet' || signals.keywordMatchType === 'scope-snippet') relevanceScore += 8;
  if (signals.keywordMatchType === 'query' && !signals.keywordMentioned) relevanceScore -= 22;
  if (signals.flags.includes('search_noise')) relevanceScore -= 28;
  if (signals.flags.includes('title_is_query')) relevanceScore -= 45;
  if (signals.contentType === 'event') trustScore += 8;

  return {
    ruleTrustScore: clampScore(trustScore),
    ruleRelevanceScore: clampScore(relevanceScore)
  };
}

function auditStatusFromScore({ trustScore, flags }) {
  if (flags.includes('search_noise')) return 'noise';
  if (trustScore >= 75) return 'trusted';
  if (trustScore >= 50) return 'needs_review';
  return 'low_evidence';
}

function buildRuleEvidence(signals, scores) {
  const evidence = [buildRelevanceReason(signals), buildTrustReason(signals, scores)];

  if (signals.flags.length) {
    evidence.push(`风险信号：${formatSignalNames(signals.flags).slice(0, 3).join('、')}`);
  } else if (signals.positiveSignals.length) {
    evidence.push(`正向信号：${formatSignalNames(signals.positiveSignals).slice(0, 3).join('、')}`);
  }

  return evidence;
}

function buildRelevanceReason(signals) {
  if (signals.keywordMatchType === 'title' || signals.keywordMatchType === 'scope-title') {
    return '相关性理由：标题直接提及监控关键词或关键词变体。';
  }

  if (signals.keywordMatchType === 'snippet' || signals.keywordMatchType === 'scope-snippet') {
    return '相关性理由：摘要内容直接提及监控关键词或关键词变体。';
  }

  if (signals.keywordMentioned) {
    return '相关性理由：内容命中关键词扩展词，属于直接相关候选。';
  }

  return '相关性理由：未直接命中关键词，仅按采集查询结果保守评估。';
}

function buildTrustReason(signals, scores) {
  const sourceLabel = signals.hostname || signals.sourceType || '未知来源';
  return `可信度理由：来源 ${sourceLabel}，来源质量分 ${signals.sourceQualityScore}，规则可信分 ${scores.ruleTrustScore}。`;
}

function formatSignalNames(values) {
  const labels = {
    trusted_domain: '可信域名',
    recent_publish_time: '近期发布',
    direct_title_match: '标题直接命中',
    keyword_variant_match: '命中关键词变体',
    verified_author: '认证作者',
    meaningful_views: '浏览量有效',
    meaningful_reactions: '互动有效',
    title_too_short: '标题过短',
    numeric_or_duration_title: '标题像数字或时长',
    missing_snippet_low_source: '低质量来源且缺少摘要',
    search_noise: '搜索噪音',
    collection_or_series: '合集或系列',
    tutorial_not_hotspot: '教程内容',
    marketing_language: '营销表达',
    title_is_query: '标题像查询词'
  };

  return values.map((value) => labels[value] || value);
}

export function buildEvidencePackage({ item, keyword, scope, preMatch }) {
  const signals = buildRuleSignals({ item, keyword, scope, preMatch });
  const scores = scoreRules(signals);

  return {
    auditVersion: AUDIT_VERSION,
    shouldSkip: shouldSkipCandidate(signals),
    title: signals.title,
    normalizedTitle: signals.normalizedTitle,
    snippet: signals.snippet,
    sourceType: item?.sourceType || '',
    sourceAuthor: item?.sourceAuthor || '',
    hostname: signals.hostname,
    publishedAt: item?.sourcePublishedAt || null,
    keyword: keyword || '',
    scope: scope || '',
    keywordMatchType: signals.keywordMatchType,
    keywordMentioned: signals.keywordMentioned,
    sourceQualityScore: signals.sourceQualityScore,
    ruleTrustScore: scores.ruleTrustScore,
    ruleRelevanceScore: scores.ruleRelevanceScore,
    contentType: signals.contentType,
    riskFlags: signals.flags,
    positiveSignals: signals.positiveSignals,
    engagement: signals.engagement,
    ruleEvidence: buildRuleEvidence(signals, scores)
  };
}

export function finalizeAudit({ evidencePackage, analysis }) {
  if (!analysis) {
    const trustScore = evidencePackage.ruleTrustScore;
    const relevanceScore = evidencePackage.ruleRelevanceScore;
    const auditStatus = auditStatusFromScore({
      trustScore,
      flags: evidencePackage.riskFlags
    });

    return {
      auditStatus,
      aiConfidence: null,
      trustScore,
      relevanceScore,
      sourceQualityScore: evidencePackage.sourceQualityScore,
      auditFlags: evidencePackage.riskFlags,
    auditVersion: evidencePackage.auditVersion,
    contentType: evidencePackage.contentType,
    importance: 'low',
    evidence: evidencePackage.ruleEvidence
    };
  }

  const aiFlags = Array.isArray(analysis.riskFlags) ? analysis.riskFlags.map((flag) => String(flag).trim()).filter(Boolean) : [];
  const keywordMentioned = analysis.keywordMentioned ?? evidencePackage.keywordMentioned;
  const aiTrustDelta = analysis.isReal === false ? -35 : clampScore(analysis.confidence ?? 60) >= 80 ? 6 : 0;
  const relevancePenalty = keywordMentioned ? 0 : -12;
  const rawTrustScore = evidencePackage.ruleTrustScore + aiTrustDelta + relevancePenalty - (aiFlags.length ? 4 : 0);
  const trustScore = clampScore(
    analysis.isReal !== false && keywordMentioned && Number(analysis.relevance || 0) >= 75
      ? Math.max(50, rawTrustScore)
      : rawTrustScore
  );
  const relevanceScore = clampScore((analysis.relevance ?? evidencePackage.ruleRelevanceScore) * 0.64 + evidencePackage.ruleRelevanceScore * 0.36);
  const auditFlags = [...new Set([...evidencePackage.riskFlags, ...aiFlags])];
  const auditStatus = auditStatusFromScore({ trustScore, flags: auditFlags });

  return {
    auditStatus: normalizeAuditStatus(auditStatus, trustScore, auditFlags),
    aiConfidence: clampScore(analysis.confidence ?? 60),
    trustScore,
    relevanceScore,
    sourceQualityScore: evidencePackage.sourceQualityScore,
    auditFlags,
    auditVersion: evidencePackage.auditVersion,
    contentType: evidencePackage.contentType,
    importance: analysis.importance || 'medium',
    evidence: [
      analysis.relevanceReason ? `相关性理由：${analysis.relevanceReason.replace(/^相关性理由[:：]\s*/u, '')}` : null,
      ...evidencePackage.ruleEvidence,
      ...(Array.isArray(analysis.evidence) ? analysis.evidence : [])
    ].filter(Boolean).slice(0, 5)
  };
}

export function shouldUseAiReview(evidencePackage, preMatch, settings = {}) {
  if (!evidencePackage || evidencePackage.shouldSkip) return false;
  if (env.aiReviewMode === 'off' || settings.aiReviewMode === 'off') return false;

  const flags = new Set(evidencePackage.riskFlags || []);
  const trustScore = Number(evidencePackage.ruleTrustScore || 0);
  const relevanceScore = Number(evidencePackage.ruleRelevanceScore || 0);
  const strongNoise = flags.has('search_noise') || flags.has('title_is_query') || flags.has('numeric_or_duration_title');
  const strongTrusted =
    trustScore >= 82 &&
    relevanceScore >= 72 &&
    (preMatch?.matched || evidencePackage.keywordMentioned) &&
    ![...flags].some((flag) =>
      ['tutorial_not_hotspot', 'collection_or_series', 'marketing_language', 'missing_snippet_low_source'].includes(flag)
    );

  if (strongNoise || strongTrusted) return false;
  if (relevanceScore < 50) return false;

  const lowerBound = env.aiReviewMode === 'balanced' ? 48 : 55;
  const upperBound = env.aiReviewMode === 'balanced' ? 84 : 78;
  return trustScore >= lowerBound && trustScore <= upperBound;
}

export function shouldStoreAuditedCandidate({ analysis, audit, preMatch }) {
  if (!audit) return false;
  if (analysis?.isReal === false) return false;

  const relevanceScore = Number(audit.relevanceScore || 0);
  const keywordMentioned = Boolean(analysis?.keywordMentioned ?? preMatch?.matched ?? false);

  if (audit.auditStatus === 'noise') return false;
  if (relevanceScore < 50) return false;
  if (!keywordMentioned && relevanceScore < 65) return false;

  return true;
}

function normalizeAuditStatus(value, trustScore, flags) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['trusted', 'needs_review', 'low_evidence', 'noise'].includes(normalized)) {
    if (flags.includes('search_noise') && normalized === 'trusted') return 'needs_review';
    if (
      normalized === 'trusted' &&
      (trustScore < 75 ||
        flags.some((flag) => ['tutorial_not_hotspot', 'collection_or_series', 'marketing_language', 'missing_snippet_low_source'].includes(flag)))
    ) {
      return 'needs_review';
    }
    return normalized;
  }

  return auditStatusFromScore({ trustScore, flags });
}

export function needsSecondReview(audit, settings) {
  if (!audit) return false;
  if (env.aiReviewMode !== 'balanced') return false;
  if (['noise', 'low_evidence'].includes(audit.auditStatus)) return false;

  const trustScore = Number(audit.trustScore || 0);
  const relevanceScore = Number(audit.relevanceScore || 0);
  const highImpactBoundary =
    trustScore >= 68 &&
    trustScore <= 78 &&
    relevanceScore >= Number(settings?.relevanceThreshold || 70) &&
    parseImportanceRank(audit.importance) >= parseImportanceRank(settings?.importanceThreshold || 'high');
  const couldNotify =
    audit.auditStatus === 'trusted' &&
    trustScore >= 72 &&
    trustScore <= 82 &&
    relevanceScore >= Number(settings?.relevanceThreshold || 70) &&
    parseImportanceRank(audit.importance) >= parseImportanceRank(settings?.importanceThreshold || 'high');

  return couldNotify || (env.aiReviewMode === 'balanced' && highImpactBoundary);
}
