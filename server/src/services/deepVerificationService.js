import crypto from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { requestStructuredAnalysis } from './aiService.js';
import { semanticRelevanceScore } from './embeddingService.js';
import { fetchArticleContent } from './contentService.js';
import { buildEventFingerprint, findBestEventCluster, titleSimilarity } from './eventClusteringService.js';
import { normalizeExpansionKey } from './keywordExpansionService.js';
import { normalizeTitle } from '../utils/normalize.js';
import { searchBing } from '../sources/bingSource.js';
import { searchGoogleNews } from '../sources/googleNewsSource.js';
import { assessSourceAuthority, verificationConfig } from '../config/verificationConfig.js';
import { env } from '../config/env.js';
import { calculateHeatScore } from '../utils/heat.js';

export const DEEP_AUDIT_VERSION = 'deep-verify-v1';

const UNDERSTANDING_PROMPT = `
你是热点内容分析器。只根据输入的原文，不使用自身知识补充事实。
输出 JSON：
{
  "directlyRelevant": true,
  "relevanceScore": 0-100,
  "contentType": "news|product_release|opinion|tutorial|marketing|collection|search_noise",
  "entities": ["实体"],
  "claims": [{"statement":"可由外部来源验证的具体事实","importance":"core|supporting"}],
  "searchQueries": ["用于验证核心事实的中英文查询"],
  "riskFlags": ["风险代码"]
}
最多提取 5 条声明和 4 个查询。没有正文证据时不要猜测。
`;

const CLAIM_VERIFICATION_PROMPT = `
你是证据核验器。输入包含待核验声明和多个带编号的来源。只允许使用这些来源，不使用自身知识。
输出 JSON：
{
  "claims": [{
    "statement":"原声明",
    "status":"supported|partially_supported|contradicted|unverified",
    "confidence":0-100,
    "evidence":[{"sourceIndex":0,"stance":"support|contradict|mention","excerpt":"来源中的短证据"}]
  }]
}
只有来源明确表达相同事实才算支持；多篇转载同一稿件不能提高置信度。
`;

const ADJUDICATION_PROMPT = `
你是最终热点裁判。只读取结构化规则分、声明核验结果和来源信息，不使用自身知识。
输出 JSON：
{
  "relevanceScore":0-100,
  "evidenceScore":0-100,
  "corroborationScore":0-100,
  "contradictionScore":0-100,
  "importance":"low|medium|high|urgent",
  "verificationStatus":"trusted|needs_review|contradicted|rejected",
  "reason":"一句中文结论"
}
单一普通来源不得判 trusted；正文缺失或发布时间缺失不得判 trusted；存在核心事实反驳不得判 trusted。
`;

function buildReferenceText(keyword, scope) {
  return [keyword, scope]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function blendRelevance(llmRelevance, semanticRelevance) {
  if (semanticRelevance === null || semanticRelevance === undefined) {
    return clamp(llmRelevance);
  }

  const weight = verificationConfig.semantic.semanticWeight;
  return clamp(Number(llmRelevance || 0) * (1 - weight) + Number(semanticRelevance) * weight);
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 0;
}

function safeArray(value, max = 20) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, max) : [];
}

function safeJson(value, fallback = []) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function claimKey(statement) {
  return crypto.createHash('sha256').update(normalizeTitle(statement)).digest('hex').slice(0, 24);
}

function sourceGroup(domain) {
  const parts = String(domain || '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : domain || '';
}

function parseEvidenceFlags(source) {
  return safeJson(source?.evidenceFlagsJson, []);
}

function keywordTermsForEvent(event) {
  return (event.keywords || []).map((item) => item.keyword?.term || item.term).filter(Boolean);
}

function attachKeywordExpansions(item, expansionLookup) {
  const keywordExpansions = keywordTermsForEvent(item).map((keyword) => ({
    keyword,
    expandedKeywords: expansionLookup.get(normalizeExpansionKey(keyword)) || []
  }));
  return {
    ...item,
    keywordExpansions
  };
}

function independenceGroup(article) {
  if (article?.officialEntity) {
    return `official:${String(article.officialEntity).toLowerCase()}`;
  }
  const group = sourceGroup(article?.publisherDomain);
  return group ? `domain:${group}` : '';
}

function buildAuthorityFields({ item, article }) {
  const assessed = assessSourceAuthority({
    sourceType: item?.sourceType || article?.sourceType,
    publisherDomain: article.publisherDomain,
    canonicalUrl: article.canonicalUrl,
    resolvedUrl: article.resolvedUrl,
    isOfficial: article.isOfficial,
    officialEntity: article.officialEntity,
    fetchStatus: article.fetchStatus
  });

  return {
    discoverySourceType: item?.sourceType || article?.sourceType || null,
    sourceAuthorityScore: article.sourceAuthorityScore ?? assessed.score,
    authorityReason: article.authorityReason || assessed.reason,
    officialEntity: article.officialEntity || null,
    independenceGroup: independenceGroup(article)
  };
}

function buildFallbackUnderstanding({ keyword, article, semanticRelevance = null }) {
  const text = `${article.title} ${article.snippet} ${article.bodyText.slice(0, 1200)}`.toLowerCase();
  // 优先用语义相关性兜底；仅当 embedding 不可用时才退回关键词子串匹配。
  let directlyRelevant;
  let relevanceScore;
  if (semanticRelevance !== null && semanticRelevance !== undefined) {
    directlyRelevant = semanticRelevance >= verificationConfig.semantic.hardFloorRelevance;
    relevanceScore = clamp(semanticRelevance);
  } else {
    const normalizedKeyword = String(keyword || '').toLowerCase().replace(/\s+/g, '');
    directlyRelevant = Boolean(normalizedKeyword && text.replace(/\s+/g, '').includes(normalizedKeyword));
    relevanceScore = directlyRelevant ? 82 : 48;
  }
  return {
    directlyRelevant,
    relevanceScore,
    contentType: /教程|指南|tutorial|how to/iu.test(text) ? 'tutorial' : 'news',
    entities: [],
    claims: article.title ? [{ statement: article.title, importance: 'core' }] : [],
    searchQueries: article.title ? [article.title] : [],
    riskFlags: ['ai_understanding_fallback']
  };
}

async function understandContent({ settings, keyword, article, semanticRelevance = null }) {
  const payload = {
    keyword,
    title: article.title,
    snippet: article.snippet,
    body: article.bodyText.slice(0, 12000),
    publisherDomain: article.publisherDomain,
    author: article.sourceAuthor,
    publishedAt: article.sourcePublishedAt,
    evidenceFlags: article.evidenceFlags
  };

  try {
    const result = await requestStructuredAnalysis({
      settings,
      prompt: UNDERSTANDING_PROMPT,
      payload,
      maxTokens: 1000
    });
    const value = result.value;
    if (!value) return buildFallbackUnderstanding({ keyword, article, semanticRelevance });
    return {
      directlyRelevant: value.directlyRelevant === true,
      relevanceScore: blendRelevance(value.relevanceScore, semanticRelevance),
      semanticRelevance,
      contentType: String(value.contentType || 'news'),
      entities: safeArray(value.entities, 10).map(String),
      claims: safeArray(value.claims, 5)
        .map((claim) => ({
          statement: String(claim?.statement || '').trim(),
          importance: claim?.importance === 'supporting' ? 'supporting' : 'core'
        }))
        .filter((claim) => claim.statement),
      searchQueries: safeArray(value.searchQueries, 4).map(String),
      riskFlags: safeArray(value.riskFlags, 8).map(String)
    };
  } catch {
    return buildFallbackUnderstanding({ keyword, article, semanticRelevance });
  }
}

async function findEvent(article) {
  const exact = await prisma.hotspotSourceItem.findFirst({
    where: { canonicalUrl: article.canonicalUrl },
    include: { event: true }
  });
  if (exact) return exact.event;

  const recentEvents = await prisma.hotspotEvent.findMany({
    where: {
      lastSeenAt: {
        gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      }
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 200
  });
  return findBestEventCluster(article.title, recentEvents)?.event || null;
}

async function ensureEvent({ article, keyword, understanding }) {
  let event = await findEvent(article);
  if (!event) {
    let fingerprint = buildEventFingerprint(article.title);
    const occupied = await prisma.hotspotEvent.findUnique({ where: { eventFingerprint: fingerprint } });
    if (occupied) {
      fingerprint = crypto.createHash('sha256').update(`${fingerprint}:${article.canonicalUrl}`).digest('hex');
    }
    event = await prisma.hotspotEvent.create({
      data: {
        eventFingerprint: fingerprint,
        title: article.title,
        primaryUrl: article.resolvedUrl,
        primarySourceType: article.sourceType,
        primarySourceAuthor: article.sourceAuthor,
        sourcePublishedAt: normalizeDate(article.sourcePublishedAt),
        contentType: understanding.contentType,
        relevanceScore: understanding.relevanceScore,
        riskFlagsJson: JSON.stringify([...new Set([...article.evidenceFlags, ...understanding.riskFlags])])
      }
    });
  }

  if (keyword?.id) {
    await prisma.hotspotEventKeyword.upsert({
      where: { eventId_keywordId: { eventId: event.id, keywordId: keyword.id } },
      update: {},
      create: { eventId: event.id, keywordId: keyword.id }
    });
  }
  return event;
}

async function upsertSourceItem({ eventId, item, article, isSyndicated = false }) {
  const canonicalUrl = article.canonicalUrl || item.url;
  const authorityFields = buildAuthorityFields({ item, article });
  return prisma.hotspotSourceItem.upsert({
    where: { eventId_canonicalUrl: { eventId, canonicalUrl } },
    update: {
      title: article.title,
      snippet: article.snippet,
      bodyText: article.bodyText || undefined,
      bodyHash: article.bodyHash || undefined,
      publisherDomain: article.publisherDomain || undefined,
      publisherName: article.publisherName || undefined,
      sourceAuthor: article.sourceAuthor || undefined,
      sourcePublishedAt: normalizeDate(article.sourcePublishedAt) || undefined,
      engagementJson: item.engagementJson || undefined,
      fetchStatus: article.fetchStatus,
      fetchError: article.fetchError,
      isOfficial: article.isOfficial,
      isSyndicated,
      sourceGroup: sourceGroup(article.publisherDomain),
      ...authorityFields,
      evidenceFlagsJson: JSON.stringify(article.evidenceFlags)
    },
    create: {
      eventId,
      title: article.title,
      snippet: article.snippet,
      bodyText: article.bodyText,
      bodyHash: article.bodyHash,
      originalUrl: item.url,
      canonicalUrl,
      publisherDomain: article.publisherDomain,
      publisherName: article.publisherName,
      sourceType: item.sourceType,
      discoverySourceType: authorityFields.discoverySourceType,
      sourceAuthor: article.sourceAuthor,
      sourcePublishedAt: normalizeDate(article.sourcePublishedAt),
      engagementJson: item.engagementJson || null,
      fetchStatus: article.fetchStatus,
      fetchError: article.fetchError,
      isOfficial: article.isOfficial,
      isSyndicated,
      sourceGroup: sourceGroup(article.publisherDomain),
      sourceAuthorityScore: authorityFields.sourceAuthorityScore,
      authorityReason: authorityFields.authorityReason,
      officialEntity: authorityFields.officialEntity,
      independenceGroup: authorityFields.independenceGroup,
      evidenceFlagsJson: JSON.stringify(article.evidenceFlags)
    }
  });
}

function entityMatchedOfficialDomains(understanding) {
  const text = [
    ...safeArray(understanding.entities, 10),
    ...safeArray(understanding.claims, 5).map((claim) => claim.statement)
  ].join(' ').toLowerCase();
  const domains = [];
  for (const rule of verificationConfig.officialEntities) {
    const entity = String(rule.entity || '').toLowerCase();
    if (!entity || !text.includes(entity)) {
      continue;
    }
    domains.push(...safeArray(rule.domains, 4));
  }
  return [...new Set(domains)].slice(0, 4);
}

function buildCorroborationQueries({ understanding, event, maxQueries = 8 }) {
  const baseQueries = [
    ...safeArray(understanding.searchQueries, 4),
    event.title
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const dedupedBase = [...new Set(baseQueries)].slice(0, 3);
  const officialDomains = entityMatchedOfficialDomains(understanding);
  const officialQueries = officialDomains.flatMap((domain) =>
    dedupedBase.slice(0, 2).map((query) => `site:${domain} ${query}`)
  );
  const counterQueries = dedupedBase.slice(0, 2).flatMap((query) => [
    `${query} 否认`,
    `${query} 辟谣`,
    `${query} denies`,
    `${query} false`
  ]);

  return [...new Set([...dedupedBase, ...officialQueries, ...counterQueries])].slice(0, maxQueries);
}

function verificationBudgetForMode(scanMode) {
  const quick = scanMode === 'quick';
  return {
    maxQueries: quick ? env.corroborationMaxQueries : 8,
    maxArticles: quick ? env.corroborationMaxArticles : 10,
    fetchTimeoutMs: quick ? env.corroborationFetchTimeoutMs : 15000,
    minTitleSimilarity: quick ? 0.16 : 0.28,
    rawItemLimit: quick ? Math.max(12, env.corroborationMaxArticles * 3) : 24
  };
}

function quickCorroborationSkipReason({ scanMode, understanding, primaryArticle }) {
  if (scanMode !== 'quick') return '';
  const evidenceFlags = safeArray(primaryArticle.evidenceFlags, 12);
  if (
    evidenceFlags.includes('body_unavailable') &&
    clamp(understanding.relevanceScore) < env.quickScanCorroborationMinRelevance
  ) {
    return 'primary_body_unavailable';
  }
  if (verificationConfig.blockedContentTypes.includes(understanding.contentType)) return 'blocked_content_type';
  if (!understanding.directlyRelevant) return 'not_directly_relevant';
  if (clamp(understanding.relevanceScore) < env.quickScanCorroborationMinRelevance) return 'below_quick_relevance_budget';
  return '';
}

async function collectCorroboration({ settings, keyword, event, understanding, primaryArticle, budget }) {
  const queries = buildCorroborationQueries({ understanding, event, maxQueries: budget.maxQueries });
  const rawItems = [];

  for (const query of queries) {
    const settled = await Promise.allSettled([
      searchBing({ keyword: query, scope: '' }),
      searchGoogleNews({ keyword: query, scope: '' })
    ]);
    for (const result of settled) {
      if (result.status === 'fulfilled') rawItems.push(...result.value);
    }
    if (rawItems.length >= budget.rawItemLimit) break;
  }

  const seen = new Set([primaryArticle.canonicalUrl]);
  const accepted = [];
  for (const item of rawItems) {
    if (accepted.length >= budget.maxArticles) break;
    const article = await fetchArticleContent(item, { timeoutMs: budget.fetchTimeoutMs });
    if (!article.canonicalUrl || seen.has(article.canonicalUrl)) continue;
    seen.add(article.canonicalUrl);
    const similarity = titleSimilarity(event.title, article.title);
    const normalizedText = normalizeTitle(`${article.title || ''} ${article.snippet || ''} ${String(article.bodyText || '').slice(0, 1000)}`);
    const normalizedKeyword = normalizeTitle(keyword);
    const keywordMention = Boolean(normalizedKeyword && normalizedText.includes(normalizedKeyword));
    const entityMention = understanding.entities.some((entity) => {
      const normalizedEntity = normalizeTitle(entity);
      return normalizedEntity && normalizedText.includes(normalizedEntity);
    });
    const claimMention = understanding.claims.some((claim) =>
      normalizedText.includes(normalizeTitle(claim.statement).slice(0, 12))
    );
    if (similarity < budget.minTitleSimilarity && !claimMention && !(keywordMention && (entityMention || similarity >= 0.1))) continue;
    accepted.push({ item, article });
  }
  return accepted;
}

function markSyndication(sources) {
  const bodyHashes = new Map();
  const canonicalGroups = new Map();
  return sources.map((source) => {
    const hash = source.bodyHash;
    const group = source.independenceGroup || source.sourceGroup || source.publisherDomain || '';
    const duplicateBody = hash ? bodyHashes.has(hash) : false;
    const duplicateGroup = group ? canonicalGroups.has(group) : false;
    if (hash) bodyHashes.set(hash, source.id);
    if (group) canonicalGroups.set(group, source.id);
    return { ...source, isSyndicated: duplicateBody || duplicateGroup || Boolean(source.isSyndicated) };
  });
}

async function verifyClaims({ settings, claims, sources }) {
  if (!claims.length) return [];
  const payload = {
    claims,
    sources: sources.map((source, sourceIndex) => ({
      sourceIndex,
      domain: source.publisherDomain,
      title: source.title,
      publishedAt: source.sourcePublishedAt,
      isOfficial: source.isOfficial,
      isSyndicated: source.isSyndicated,
      text: String(source.bodyText || source.snippet || '').slice(0, 7000)
    }))
  };

  try {
    const result = await requestStructuredAnalysis({
      settings,
      prompt: CLAIM_VERIFICATION_PROMPT,
      payload,
      maxTokens: 1800
    });
    return safeArray(result.value?.claims, 5);
  } catch {
    return claims.map((claim) => ({
      statement: claim.statement,
      status: 'unverified',
      confidence: 0,
      evidence: []
    }));
  }
}

async function persistClaims(eventId, verifiedClaims, sources) {
  await prisma.eventClaim.deleteMany({ where: { eventId } });
  for (const result of verifiedClaims) {
    const statement = String(result.statement || '').trim();
    if (!statement) continue;
    const claim = await prisma.eventClaim.create({
      data: {
        eventId,
        claimKey: claimKey(statement),
        statement,
        status: ['supported', 'partially_supported', 'contradicted', 'unverified'].includes(result.status)
          ? result.status
          : 'unverified',
        confidence: clamp(result.confidence)
      }
    });
    for (const evidence of safeArray(result.evidence, 12)) {
      const source = sources[Number(evidence.sourceIndex)];
      if (!source) continue;
      await prisma.claimEvidence.upsert({
        where: { claimId_sourceItemId: { claimId: claim.id, sourceItemId: source.id } },
        update: {
          stance: String(evidence.stance || 'mention'),
          excerpt: String(evidence.excerpt || '').slice(0, 600),
          confidence: clamp(result.confidence)
        },
        create: {
          claimId: claim.id,
          sourceItemId: source.id,
          stance: String(evidence.stance || 'mention'),
          excerpt: String(evidence.excerpt || '').slice(0, 600),
          confidence: clamp(result.confidence)
        }
      });
    }
  }
}

function calculateRuleScores({ sources, verifiedClaims, understanding }) {
  const independent = sources.filter((source) => !source.isSyndicated);
  const evidenceReady = independent.filter((source) =>
    source.publisherDomain &&
    source.fetchStatus === 'fetched' &&
    source.sourcePublishedAt &&
    !parseEvidenceFlags(source).includes('body_unavailable')
  );
  const domains = new Set(
    independent
      .map((source) => source.independenceGroup || source.sourceGroup || source.publisherDomain)
      .filter(Boolean)
  );
  const evidenceReadyDomains = new Set(
    evidenceReady
      .map((source) => source.independenceGroup || source.sourceGroup || source.publisherDomain)
      .filter(Boolean)
  );
  const hasOfficialSource = independent.some((source) => source.isOfficial);
  const hasEvidenceReadyOfficialSource = evidenceReady.some((source) => source.isOfficial);
  const fetchedCount = independent.filter((source) => source.fetchStatus === 'fetched').length;
  const datedCount = independent.filter((source) => source.sourcePublishedAt).length;
  const authoredCount = independent.filter((source) => source.sourceAuthor).length;
  const supported = verifiedClaims.filter((claim) => claim.status === 'supported').length;
  const coreSupported = verifiedClaims.filter((claim) => claim.status === 'supported' && claim.importance === 'core').length;
  const partial = verifiedClaims.filter((claim) => claim.status === 'partially_supported').length;
  const contradicted = verifiedClaims.filter((claim) => claim.status === 'contradicted').length;
  const claimCount = Math.max(1, verifiedClaims.length);
  const bodyUnavailableCount = independent.filter((source) =>
    source.fetchStatus !== 'fetched' || parseEvidenceFlags(source).includes('body_unavailable')
  ).length;
  const publishedMissingCount = independent.filter((source) => !source.sourcePublishedAt).length;

  const { evidenceWeights, corroborationTiers } = verificationConfig;
  const evidenceScore = clamp(
    (fetchedCount / Math.max(1, independent.length)) * evidenceWeights.fetched +
    (datedCount / Math.max(1, independent.length)) * evidenceWeights.dated +
    (authoredCount / Math.max(1, independent.length)) * evidenceWeights.authored +
    (hasOfficialSource ? evidenceWeights.official : 0) +
    (independent.length >= 2 ? evidenceWeights.multiSourceBonus : 0)
  );
  const sourceQualityScore = clamp(
    independent.reduce((sum, source) => {
      const fallback = assessSourceAuthority({
        sourceType: source.sourceType,
        publisherDomain: source.publisherDomain,
        isOfficial: source.isOfficial,
        officialEntity: source.officialEntity,
        fetchStatus: source.fetchStatus
      }).score;
      return sum + Number(source.sourceAuthorityScore ?? fallback);
    }, 0) /
      Math.max(1, independent.length)
  );
  const supportRatio = (supported + partial * 0.5) / claimCount;
  const corroborationTier =
    domains.size >= 4
      ? corroborationTiers.fourPlusDomains
      : domains.size === 3
        ? corroborationTiers.threeDomains
        : domains.size === 2
          ? corroborationTiers.twoDomains
          : hasOfficialSource
            ? corroborationTiers.officialOnly
            : corroborationTiers.single;
  const corroborationScore = clamp(
    corroborationTier * (corroborationTiers.base + supportRatio * corroborationTiers.supportFactor)
  );
  const contradictionScore = clamp((contradicted / claimCount) * 100);

  return {
    relevanceScore: clamp(understanding.relevanceScore),
    evidenceScore,
    corroborationScore,
    contradictionScore,
    sourceQualityScore,
    independentSourceCount: domains.size,
    evidenceReadySourceCount: evidenceReadyDomains.size,
    hasOfficialSource,
    hasEvidenceReadyOfficialSource,
    supportedClaimCount: supported,
    coreSupportedClaimCount: coreSupported,
    bodyUnavailableCount,
    publishedMissingCount,
    hasBodyGate: evidenceReadyDomains.size >= 2 || hasEvidenceReadyOfficialSource,
    hasPublishedAtGate: evidenceReadyDomains.size >= 2 || hasEvidenceReadyOfficialSource
  };
}

async function adjudicate({ settings, ruleScores, understanding, verifiedClaims, sources }) {
  try {
    const result = await requestStructuredAnalysis({
      settings,
      prompt: ADJUDICATION_PROMPT,
      payload: {
        ruleScores,
        contentType: understanding.contentType,
        directlyRelevant: understanding.directlyRelevant,
        claims: verifiedClaims.map((claim) => ({
          statement: claim.statement,
          status: claim.status,
          confidence: claim.confidence
        })),
        sources: sources.map((source) => ({
          domain: source.publisherDomain,
          discoverySourceType: source.discoverySourceType || source.sourceType,
          sourceAuthorityScore: source.sourceAuthorityScore,
          authorityReason: source.authorityReason,
          isOfficial: source.isOfficial,
          officialEntity: source.officialEntity,
          isSyndicated: source.isSyndicated,
          fetchStatus: source.fetchStatus,
          publishedAt: source.sourcePublishedAt,
          evidenceFlags: parseEvidenceFlags(source)
        }))
      },
      maxTokens: 700
    });
    return result.value || {};
  } catch {
    return {};
  }
}

function mergeAdjudications(first, second) {
  if (!second || !Object.keys(second).length) return first;
  const importanceOrder = ['low', 'medium', 'high', 'urgent'];
  const firstImportance = importanceOrder.indexOf(first.importance);
  const secondImportance = importanceOrder.indexOf(second.importance);
  return {
    ...first,
    relevanceScore: Math.min(clamp(first.relevanceScore), clamp(second.relevanceScore)),
    evidenceScore: Math.min(clamp(first.evidenceScore), clamp(second.evidenceScore)),
    corroborationScore: Math.min(clamp(first.corroborationScore), clamp(second.corroborationScore)),
    contradictionScore: Math.max(clamp(first.contradictionScore), clamp(second.contradictionScore)),
    importance:
      importanceOrder[Math.max(0, Math.min(firstImportance < 0 ? 0 : firstImportance, secondImportance < 0 ? 0 : secondImportance))],
    verificationStatus:
      first.verificationStatus === 'trusted' && second.verificationStatus === 'trusted'
        ? 'trusted'
        : second.verificationStatus || first.verificationStatus,
    reason: [first.reason, second.reason].filter(Boolean).join('；').slice(0, 500)
  };
}

function finalizeDecision({ ruleScores, adjudication, understanding, verifiedClaims }) {
  const relevanceScore = clamp(adjudication.relevanceScore || ruleScores.relevanceScore);
  const evidenceScore = clamp((Number(adjudication.evidenceScore || ruleScores.evidenceScore) + ruleScores.evidenceScore) / 2);
  const corroborationScore = clamp(
    (Number(adjudication.corroborationScore || ruleScores.corroborationScore) + ruleScores.corroborationScore) / 2
  );
  const contradictionScore = Math.max(
    ruleScores.contradictionScore,
    clamp(adjudication.contradictionScore || 0)
  );
  const { trustWeights, decisionThresholds, blockedContentTypes } = verificationConfig;
  const trustScore = clamp(
    relevanceScore * trustWeights.relevance +
    evidenceScore * trustWeights.evidence +
    corroborationScore * trustWeights.corroboration +
    ruleScores.sourceQualityScore * trustWeights.sourceQuality -
    contradictionScore * trustWeights.contradictionPenalty
  );
  const riskFlags = [...new Set(understanding.riskFlags)];
  const blockedType = blockedContentTypes.includes(understanding.contentType);
  const hasEvidenceGate =
    ruleScores.coreSupportedClaimCount >= 1 &&
    ((ruleScores.evidenceReadySourceCount ?? ruleScores.independentSourceCount) >= 2 ||
      (ruleScores.hasEvidenceReadyOfficialSource ?? ruleScores.hasOfficialSource)) &&
    ruleScores.hasBodyGate &&
    ruleScores.hasPublishedAtGate;
  const trusted =
    understanding.directlyRelevant &&
    relevanceScore >= decisionThresholds.trustedRelevance &&
    trustScore >= decisionThresholds.trustedTrust &&
    contradictionScore < decisionThresholds.maxContradictionForTrusted &&
    hasEvidenceGate &&
    !blockedType;
  let verificationStatus = trusted ? 'trusted' : 'needs_review';
  if (
    contradictionScore >= decisionThresholds.contradictedScore ||
    verifiedClaims.some((claim) => claim.status === 'contradicted' && claim.importance === 'core')
  ) {
    verificationStatus = 'contradicted';
  } else if (
    !understanding.directlyRelevant ||
    relevanceScore < decisionThresholds.rejectRelevance ||
    understanding.contentType === 'search_noise'
  ) {
    verificationStatus = 'rejected';
  }
  if (adjudication.verificationStatus === 'contradicted') verificationStatus = 'contradicted';

  return {
    relevanceScore,
    evidenceScore,
    corroborationScore,
    contradictionScore,
    sourceQualityScore: ruleScores.sourceQualityScore,
    trustScore,
    verificationStatus,
    independentSourceCount: ruleScores.independentSourceCount,
    hasOfficialSource: ruleScores.hasOfficialSource,
    importance: ['low', 'medium', 'high', 'urgent'].includes(adjudication.importance)
      ? adjudication.importance
      : 'medium',
    reason: String(adjudication.reason || '').slice(0, 500),
    riskFlags
  };
}

export function calculateVerificationScoresForTest(input) {
  return calculateRuleScores(input);
}

export function finalizeVerificationDecisionForTest(input) {
  return finalizeDecision(input);
}

function buildVerifiedSummary({ keyword, event, decision, verifiedClaims }) {
  const confirmed = verifiedClaims.find((claim) => claim.status === 'supported')?.statement;
  const relation = confirmed || event.title;
  if (decision.verificationStatus === 'trusted') {
    return `此内容与【${keyword}】的关联：${relation}。经 ${decision.independentSourceCount} 个独立来源佐证，核心事实已确认。`
      .slice(0, 220);
  }
  const partiallySupported = verifiedClaims.some((claim) => claim.status === 'partially_supported');
  const supportedCount = verifiedClaims.filter((claim) => claim.status === 'supported').length;
  let reviewReason = '当前证据不足，已进入待核验区。';
  if (decision.independentSourceCount >= 2) {
    reviewReason = partiallySupported || supportedCount
      ? `已找到 ${decision.independentSourceCount} 个独立来源，但核心事实仍需更强证据确认。`
      : `已找到 ${decision.independentSourceCount} 个独立来源，但核心声明尚未被明确支持。`;
  } else if (decision.hasOfficialSource) {
    reviewReason = '已发现官方来源，但仍缺少可验证的核心事实支持。';
  } else if (decision.evidenceScore >= 70) {
    reviewReason = '原文证据可用，但仍缺少独立来源佐证。';
  }
  return `此内容与【${keyword}】的关联：${relation}。${reviewReason}`.slice(0, 220);
}

function buildCandidateText(article) {
  return `${article.title || ''} ${article.snippet || ''} ${String(article.bodyText || '').slice(0, 800)}`.trim();
}

async function rejectLowRelevanceEvent({ item, keyword, primaryArticle, semanticRelevance }) {
  const understanding = {
    directlyRelevant: false,
    relevanceScore: clamp(semanticRelevance ?? 0),
    semanticRelevance,
    contentType: 'search_noise',
    entities: [],
    claims: [],
    searchQueries: [],
    riskFlags: [...new Set([...(primaryArticle.evidenceFlags || []), 'low_semantic_relevance'])]
  };
  const event = await ensureEvent({ article: primaryArticle, keyword, understanding });
  await upsertSourceItem({ eventId: event.id, item, article: primaryArticle });

  const updated = await prisma.hotspotEvent.update({
    where: { id: event.id },
    data: {
      contentType: understanding.contentType,
      verificationStatus: 'rejected',
      relevanceScore: understanding.relevanceScore,
      trustScore: 0,
      riskFlagsJson: JSON.stringify(understanding.riskFlags),
      auditEvidenceJson: JSON.stringify({
        reason: `语义相关性 ${understanding.relevanceScore} 低于阈值 ${verificationConfig.semantic.hardFloorRelevance}，未进入深度核验。`,
        claims: []
      }),
      auditVersion: DEEP_AUDIT_VERSION,
      verifiedAt: null
    },
    include: {
      keywords: { include: { keyword: true } },
      sourceItems: true,
      claims: { include: { evidence: { include: { sourceItem: true } } } }
    }
  });

  return {
    event: updated,
    created: event.firstSeenAt.getTime() === event.lastSeenAt.getTime(),
    fullTextFetched: primaryArticle.fetchStatus === 'fetched',
    bodyUnavailable: primaryArticle.evidenceFlags.includes('body_unavailable'),
    corroborated: false,
    verificationFailed: true,
    aiCallCount: 0
  };
}

export async function processCandidateAsEvent({ item, keyword, settings, scanMode = 'deep' }) {
  const primaryArticle = {
    ...(await fetchArticleContent(item)),
    sourceType: item.sourceType
  };

  // 语义相关性闸：明显不相关的候选在进入昂贵 LLM 链前被挡掉（降本主收益）。
  const semanticRelevance = await semanticRelevanceScore(
    buildReferenceText(keyword.term, settings.scope),
    buildCandidateText(primaryArticle)
  );
  if (
    semanticRelevance !== null &&
    semanticRelevance < verificationConfig.semantic.hardFloorRelevance
  ) {
    return rejectLowRelevanceEvent({ item, keyword, primaryArticle, semanticRelevance });
  }

  const understanding = await understandContent({
    settings,
    keyword: keyword.term,
    article: primaryArticle,
    semanticRelevance
  });
  understanding.riskFlags = [...new Set([...(primaryArticle.evidenceFlags || []), ...understanding.riskFlags])];
  const event = await ensureEvent({ article: primaryArticle, keyword, understanding });
  await upsertSourceItem({ eventId: event.id, item, article: primaryArticle });

  const corroborationBudget = verificationBudgetForMode(scanMode);
  const corroborationSkipReason = quickCorroborationSkipReason({
    scanMode,
    understanding,
    primaryArticle
  });
  if (corroborationSkipReason) {
    understanding.riskFlags = [
      ...new Set([...understanding.riskFlags, 'quick_scan_corroboration_skipped', corroborationSkipReason])
    ];
  }
  const corroboration = corroborationSkipReason
    ? []
    : await collectCorroboration({
        settings,
        keyword: keyword.term,
        event,
        understanding,
        primaryArticle,
        budget: corroborationBudget
      });
  for (const candidate of corroboration) {
    await upsertSourceItem({
      eventId: event.id,
      item: candidate.item,
      article: { ...candidate.article, sourceType: candidate.item.sourceType }
    });
  }

  const rawSources = await prisma.hotspotSourceItem.findMany({
    where: { eventId: event.id },
    orderBy: { discoveredAt: 'asc' }
  });
  const sources = markSyndication(rawSources);
  for (const source of sources) {
    if (source.isSyndicated !== rawSources.find((item) => item.id === source.id)?.isSyndicated) {
      await prisma.hotspotSourceItem.update({
        where: { id: source.id },
        data: { isSyndicated: source.isSyndicated }
      });
    }
  }

  const claims = understanding.claims.length
    ? understanding.claims
    : [{ statement: event.title, importance: 'core' }];
  const verifiedClaims = await verifyClaims({ settings, claims, sources });
  const claimsWithImportance = verifiedClaims.map((claim) => ({
    ...claim,
    importance: claims.find((source) => source.statement === claim.statement)?.importance || 'core'
  }));
  await persistClaims(event.id, claimsWithImportance, sources);

  const ruleScores = calculateRuleScores({ sources, verifiedClaims: claimsWithImportance, understanding });
  let adjudication = await adjudicate({
    settings,
    ruleScores,
    understanding,
    verifiedClaims: claimsWithImportance,
    sources
  });
  const preliminary = finalizeDecision({
    ruleScores,
    adjudication,
    understanding,
    verifiedClaims: claimsWithImportance
  });
  const [reviewLow, reviewHigh] = verificationConfig.decisionThresholds.independentReviewTrustRange;
  const needsIndependentReview =
    ['high', 'urgent'].includes(adjudication.importance) ||
    (preliminary.trustScore >= reviewLow && preliminary.trustScore <= reviewHigh) ||
    preliminary.contradictionScore > 0;
  let adjudicationCount = 1;
  if (needsIndependentReview) {
    const secondAdjudication = await adjudicate({
      settings,
      ruleScores,
      understanding,
      verifiedClaims: claimsWithImportance,
      sources
    });
    adjudication = mergeAdjudications(adjudication, secondAdjudication);
    adjudicationCount += 1;
  }
  const decision = finalizeDecision({
    ruleScores,
    adjudication,
    understanding,
    verifiedClaims: claimsWithImportance
  });
  const summary = buildVerifiedSummary({
    keyword: keyword.term,
    event,
    decision,
    verifiedClaims: claimsWithImportance
  });
  const updated = await prisma.hotspotEvent.update({
    where: { id: event.id },
    data: {
      title: primaryArticle.title || event.title,
      summary,
      primaryUrl: primaryArticle.resolvedUrl || event.primaryUrl,
      primarySourceType: item.sourceType,
      primarySourceAuthor: primaryArticle.sourceAuthor || item.sourceAuthor,
      sourcePublishedAt: normalizeDate(primaryArticle.sourcePublishedAt) || event.sourcePublishedAt,
      contentType: understanding.contentType,
      verificationStatus: decision.verificationStatus,
      relevanceScore: decision.relevanceScore,
      evidenceScore: decision.evidenceScore,
      corroborationScore: decision.corroborationScore,
      contradictionScore: decision.contradictionScore,
      sourceQualityScore: decision.sourceQualityScore,
      trustScore: decision.trustScore,
      importance: decision.importance,
      independentSourceCount: decision.independentSourceCount,
      hasOfficialSource: decision.hasOfficialSource,
      riskFlagsJson: JSON.stringify(decision.riskFlags),
      auditEvidenceJson: JSON.stringify({
        reason: decision.reason,
        claims: claimsWithImportance.map((claim) => ({
          statement: claim.statement,
          status: claim.status,
          confidence: claim.confidence
        }))
      }),
      auditVersion: DEEP_AUDIT_VERSION,
      verifiedAt: decision.verificationStatus === 'trusted' ? new Date() : null
    },
    include: {
      keywords: { include: { keyword: true } },
      sourceItems: true,
      claims: { include: { evidence: { include: { sourceItem: true } } } }
    }
  });

  return {
    event: updated,
    created: event.firstSeenAt.getTime() === event.lastSeenAt.getTime(),
    fullTextFetched: primaryArticle.fetchStatus === 'fetched',
    bodyUnavailable: primaryArticle.evidenceFlags.includes('body_unavailable'),
    corroborated: decision.independentSourceCount >= 2,
    verificationFailed: ['needs_review', 'contradicted', 'rejected'].includes(decision.verificationStatus)
    ,
    aiCallCount: 2 + adjudicationCount
  };
}

export function parseEventAuditEvidence(value) {
  return safeJson(value, {});
}

function eventEvidenceLines(event) {
  if (['relevance-v1', 'yupi-analysis-v1'].includes(event.auditVersion)) {
    const audit = parseEventAuditEvidence(event.auditEvidenceJson);
    return [
      event.relevanceReason || audit.relevanceReason || '',
      audit.matchedFields?.length ? `命中字段：${audit.matchedFields.join('、')}` : '',
      audit.matchedKeywords?.length ? `命中关键词：${audit.matchedKeywords.join('、')}` : '',
      typeof audit.keywordMentioned === 'boolean' ? `直接提及关键词：${audit.keywordMentioned ? '是' : '否'}` : ''
    ].filter(Boolean).join('\n');
  }

  const audit = parseEventAuditEvidence(event.auditEvidenceJson);
  const lines = [];
  if (audit.reason) lines.push(`最终裁决：${audit.reason}`);
  lines.push(`证据质量：${event.evidenceScore}，多源佐证：${event.corroborationScore}，矛盾风险：${event.contradictionScore}`);
  lines.push(
    event.hasOfficialSource
      ? `包含官方一手来源，共 ${event.independentSourceCount} 个独立来源。`
      : `共 ${event.independentSourceCount} 个独立来源，未发现官方一手来源。`
  );
  const supported = safeArray(audit.claims).filter((claim) => claim.status === 'supported').length;
  if (supported) lines.push(`${supported} 条核心事实获得来源支持。`);
  if (event.sourceItems?.some((source) => parseEvidenceFlags(source).includes('body_unavailable'))) {
    lines.push('存在正文缺失来源，可信状态将保持保守。');
  }
  return lines.join('\n');
}

function sanitizeProjectedSummary(event, primarySource) {
  const summary = String(event.summary || '').trim();
  const fallback = event.relevanceReason || '该内容通过关键词感知 AI 分析过滤。';
  const cleaned = summary
    .replace(/当前证据不足，已进入待核验区。?/gu, fallback)
    .replace(/已找到\s*\d+\s*个独立来源，但核心事实仍需更强证据确认。?/gu, fallback)
    .replace(/已找到\s*\d+\s*个独立来源，但核心声明尚未被明确支持。?/gu, fallback)
    .replace(/已发现官方来源，但仍缺少可验证的核心事实支持。?/gu, fallback)
    .replace(/原文证据可用，但仍缺少独立来源佐证。?/gu, fallback);

  return cleaned || primarySource?.snippet || event.title;
}

export function projectEvent(event) {
  const primarySource =
    event.sourceItems?.find((source) => source.canonicalUrl === event.primaryUrl) ||
    event.sourceItems?.[0] ||
    null;
  const sourceItems = event.sourceItems || [];
  const bodyAvailable = sourceItems.some((source) => source.fetchStatus === 'fetched');
  const feedbackItems = event.feedback || [];
  const feedbackSummary = feedbackItems.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.type] = (summary[item.type] || 0) + 1;
      return summary;
    },
    { total: 0 }
  );
  return {
    id: event.id,
    title: event.title,
    snippet: primarySource?.snippet || null,
    url: event.primaryUrl || primarySource?.originalUrl || '',
    sourceType: event.primarySourceType || primarySource?.sourceType || 'event',
    sourceAuthor: event.primarySourceAuthor || primarySource?.sourceAuthor || primarySource?.publisherName || '',
    sourcePublishedAt: event.sourcePublishedAt,
    engagementJson: primarySource?.engagementJson || null,
    discoveredAt: event.firstSeenAt,
    lastSeenAt: event.lastSeenAt,
    aiIsReal: event.verificationStatus === 'trusted',
    aiRelevance: event.relevanceScore,
    aiImportance: event.importance,
    aiSummary: sanitizeProjectedSummary(event, primarySource),
    aiEvidence: eventEvidenceLines(event),
    auditStatus:
      event.verificationStatus === 'trusted'
        ? 'trusted'
        : event.verificationStatus === 'rejected'
          ? 'noise'
          : event.verificationStatus === 'contradicted'
            ? 'low_evidence'
            : 'needs_review',
    verificationStatus: event.verificationStatus,
    trustScore: event.trustScore,
    heatScore: calculateHeatScore({
      heatScore: event.heatScore,
      engagementJson: primarySource?.engagementJson,
      sourcePublishedAt: event.sourcePublishedAt,
      discoveredAt: event.firstSeenAt,
      lastSeenAt: event.lastSeenAt
    }),
    matchedKeywords: safeJson(event.matchedKeywordsJson, []),
    relevanceReason: event.relevanceReason || '',
    keywordMentioned: event.keywordMentioned ?? null,
    evidenceScore: event.evidenceScore,
    corroborationScore: event.corroborationScore,
    contradictionScore: event.contradictionScore,
    sourceQualityScore: event.sourceQualityScore,
    sourceAuthorityScore: primarySource?.sourceAuthorityScore ?? event.sourceQualityScore,
    authorityReason: primarySource?.authorityReason || '',
    bodyAvailable,
    feedbackSummary,
    corroborationCount: event.independentSourceCount,
    independentSourceCount: event.independentSourceCount,
    hasOfficialSource: event.hasOfficialSource,
    auditFlagsJson: event.riskFlagsJson,
    auditVersion: event.auditVersion,
    contentType: event.contentType,
    keywords: event.keywords || [],
    sources: sourceItems,
    claims: event.claims || [],
    feedback: feedbackItems
  };
}

function buildQualityWhere(quality) {
  const normalized = String(quality || '').trim();
  if (normalized === 'official') {
    return { hasOfficialSource: true };
  }
  if (normalized === 'multi_source') {
    return { independentSourceCount: { gte: 2 } };
  }
  if (normalized === 'body_missing') {
    return {
      sourceItems: {
        some: {
          evidenceFlagsJson: {
            contains: 'body_unavailable'
          }
        }
      }
    };
  }
  if (normalized === 'low_evidence') {
    return {
      OR: [
        { evidenceScore: { lt: 60 } },
        { corroborationScore: { lt: 60 } },
        { verificationStatus: 'needs_review' }
      ]
    };
  }
  if (normalized === 'feedback') {
    return {
      feedback: {
        some: {}
      }
    };
  }
  return {};
}

function getEventFreshnessWhere() {
  const cutoff = new Date(Date.now() - env.hotspotMaxAgeDays * 24 * 60 * 60 * 1000);
  return {
    OR: [
      { sourcePublishedAt: { gte: cutoff } },
      {
        sourcePublishedAt: null,
        lastSeenAt: { gte: cutoff }
      }
    ]
  };
}

export async function listVerifiedEvents(filters = {}) {
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(filters.pageSize || '10', 10) || 10));
  const requestedStatus = String(filters.status || '').trim();
  const verificationStatus = ['trusted', 'rejected'].includes(requestedStatus) ? requestedStatus : 'trusted';
  const statusFilter = verificationStatus;
  const qualityWhere = buildQualityWhere(filters.quality);
  const filterClauses = [];
  const sourceAgnosticFilterClauses = [];
  if (filters.sourceType) {
    filterClauses.push({
      sourceItems: {
        some: { sourceType: String(filters.sourceType) }
      }
    });
  }
  if (Object.keys(qualityWhere).length) {
    filterClauses.push(qualityWhere);
    sourceAgnosticFilterClauses.push(qualityWhere);
  }
  const freshnessWhere = getEventFreshnessWhere();
  filterClauses.push(freshnessWhere);
  sourceAgnosticFilterClauses.push(freshnessWhere);
  const where = {
    verificationStatus: statusFilter,
    keywords: filters.keyword
      ? {
          some: {
            keyword: {
              term: { contains: String(filters.keyword) }
            }
          }
        }
      : undefined,
    AND: filterClauses.length ? filterClauses : undefined
  };
  const include = {
    keywords: { include: { keyword: true } },
    sourceItems: { orderBy: { discoveredAt: 'asc' } },
    claims: true,
    feedback: true
  };
  const sourceAgnosticWhere = {
    ...where,
    AND: sourceAgnosticFilterClauses.length ? sourceAgnosticFilterClauses : undefined
  };
  const [items, total, sourceAgnosticTotal, allForCounts] = await Promise.all([
    prisma.hotspotEvent.findMany({
      where,
      include,
      orderBy: [
        { heatScore: 'desc' },
        { relevanceScore: 'desc' },
        { sourcePublishedAt: 'desc' },
        { lastSeenAt: 'desc' }
      ],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.hotspotEvent.count({ where }),
    prisma.hotspotEvent.count({ where: sourceAgnosticWhere }),
    prisma.hotspotEvent.findMany({
      where: sourceAgnosticWhere,
      select: { sourceItems: { select: { sourceType: true } } }
    })
  ]);
  const sourceCounts = {};
  for (const event of allForCounts) {
    for (const sourceType of new Set(event.sourceItems.map((source) => source.sourceType))) {
      sourceCounts[sourceType] = (sourceCounts[sourceType] || 0) + 1;
    }
  }

  const keywordTerms = [
    ...new Set(items.flatMap((event) => keywordTermsForEvent(event)).map((term) => String(term || '').trim()).filter(Boolean))
  ];
  const expansionRecords = keywordTerms.length
    ? await prisma.keywordExpansion.findMany({
        where: {
          normalizedKeyword: { in: keywordTerms.map(normalizeExpansionKey) }
        }
      })
    : [];
  const expansionLookup = new Map(
    expansionRecords.map((record) => [record.normalizedKeyword, safeJson(record.expandedKeywordsJson, [])])
  );

  return {
    items: items.map((event) => attachKeywordExpansions(projectEvent(event), expansionLookup)),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    meta: {
      verificationStatus,
      sourceCounts: { all: sourceAgnosticTotal, ...sourceCounts }
    }
  };
}

export async function getVerifiedEvent(id) {
  const event = await prisma.hotspotEvent.findUnique({
    where: { id },
    include: {
      keywords: { include: { keyword: true } },
      sourceItems: { orderBy: { discoveredAt: 'asc' } },
      claims: {
        include: {
          evidence: {
            include: { sourceItem: true }
          }
        }
      },
      feedback: true
    }
  });
  return event ? projectEvent(event) : null;
}

export async function getVerifiedEventEvidence(id) {
  const event = await getVerifiedEvent(id);
  if (!event) return null;
  return {
    eventId: event.id,
    verificationStatus: event.verificationStatus,
    scores: {
      relevance: event.aiRelevance,
      evidence: event.evidenceScore,
      corroboration: event.corroborationScore,
      contradiction: event.contradictionScore,
      trust: event.trustScore
    },
    heatScore: event.heatScore,
    matchedKeywords: event.matchedKeywords || [],
    relevanceReason: event.relevanceReason || '',
    keywordMentioned: event.keywordMentioned,
    summary: event.aiSummary || '',
    independentSourceCount: event.independentSourceCount,
    hasOfficialSource: event.hasOfficialSource,
    claims: event.claims.map((claim) => ({
      id: claim.id,
      statement: claim.statement,
      status: claim.status,
      confidence: claim.confidence,
      evidence: claim.evidence.map((evidence) => ({
        stance: evidence.stance,
        excerpt: evidence.excerpt,
        source: {
          id: evidence.sourceItem.id,
          title: evidence.sourceItem.title,
          url: evidence.sourceItem.originalUrl,
          domain: evidence.sourceItem.publisherDomain,
          discoverySourceType: evidence.sourceItem.discoverySourceType || evidence.sourceItem.sourceType,
          sourceAuthorityScore: evidence.sourceItem.sourceAuthorityScore,
          authorityReason: evidence.sourceItem.authorityReason,
          officialEntity: evidence.sourceItem.officialEntity,
          independenceGroup: evidence.sourceItem.independenceGroup,
          isOfficial: evidence.sourceItem.isOfficial,
          fetchStatus: evidence.sourceItem.fetchStatus,
          evidenceFlags: safeJson(evidence.sourceItem.evidenceFlagsJson, [])
        }
      }))
    })),
    sources: event.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.originalUrl,
      domain: source.publisherDomain,
      publisherName: source.publisherName,
      discoverySourceType: source.discoverySourceType || source.sourceType,
      sourceAuthorityScore: source.sourceAuthorityScore,
      authorityReason: source.authorityReason,
      officialEntity: source.officialEntity,
      independenceGroup: source.independenceGroup,
      fetchStatus: source.fetchStatus,
      engagementJson: source.engagementJson,
      isOfficial: source.isOfficial,
      isSyndicated: source.isSyndicated,
      publishedAt: source.sourcePublishedAt,
      evidenceFlags: safeJson(source.evidenceFlagsJson, [])
    })),
    feedback: event.feedback.map((item) => ({
      id: item.id,
      type: item.type,
      note: item.note,
      createdAt: item.createdAt
    }))
  };
}

export async function saveVerificationFeedback(eventId, payload = {}) {
  const type = String(payload.type || '').trim();
  if (!['false_positive', 'missed_relevance', 'cluster_error', 'evidence_error'].includes(type)) {
    throw new Error('反馈类型无效');
  }
  const event = await prisma.hotspotEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error('热点事件不存在');
  return prisma.$transaction(async (tx) => {
    const feedback = await tx.verificationFeedback.create({
      data: {
        eventId,
        type,
        note: String(payload.note || '').trim().slice(0, 1000) || null
      }
    });

    if (['false_positive', 'cluster_error', 'evidence_error'].includes(type)) {
      await tx.hotspotEvent.update({
        where: { id: eventId },
        data: {
          verificationStatus: 'rejected',
          trustScore: 0,
          verifiedAt: null,
          riskFlagsJson: JSON.stringify([
            ...new Set([...safeJson(event.riskFlagsJson, []), `feedback_${type}`])
          ])
        }
      });
    }

    return feedback;
  });
}
