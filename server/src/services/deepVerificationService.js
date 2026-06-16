import crypto from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { requestStructuredAnalysis } from './aiService.js';
import { fetchArticleContent } from './contentService.js';
import { buildEventFingerprint, findBestEventCluster, titleSimilarity } from './eventClusteringService.js';
import { normalizeTitle } from '../utils/normalize.js';
import { searchBing } from '../sources/bingSource.js';
import { searchGoogleNews } from '../sources/googleNewsSource.js';

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

const SOURCE_QUALITY = {
  'google-news': 82,
  bing: 78,
  'hacker-news': 74,
  twitter: 52,
  bilibili: 45,
  sogou: 35
};

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 0;
}

function safeArray(value, max = 20) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, max) : [];
}

function safeJson(value, fallback = []) {
  try {
    return JSON.parse(value);
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

function buildFallbackUnderstanding({ keyword, article }) {
  const text = `${article.title} ${article.snippet} ${article.bodyText.slice(0, 1200)}`.toLowerCase();
  const normalizedKeyword = String(keyword || '').toLowerCase().replace(/\s+/g, '');
  const directlyRelevant = normalizedKeyword && text.replace(/\s+/g, '').includes(normalizedKeyword);
  return {
    directlyRelevant,
    relevanceScore: directlyRelevant ? 82 : 48,
    contentType: /教程|指南|tutorial|how to/iu.test(text) ? 'tutorial' : 'news',
    entities: [],
    claims: article.title ? [{ statement: article.title, importance: 'core' }] : [],
    searchQueries: article.title ? [article.title] : [],
    riskFlags: ['ai_understanding_fallback']
  };
}

async function understandContent({ settings, keyword, article }) {
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
    if (!value) return buildFallbackUnderstanding({ keyword, article });
    return {
      directlyRelevant: value.directlyRelevant === true,
      relevanceScore: clamp(value.relevanceScore),
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
    return buildFallbackUnderstanding({ keyword, article });
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
      sourceAuthor: article.sourceAuthor,
      sourcePublishedAt: normalizeDate(article.sourcePublishedAt),
      engagementJson: item.engagementJson || null,
      fetchStatus: article.fetchStatus,
      fetchError: article.fetchError,
      isOfficial: article.isOfficial,
      isSyndicated,
      sourceGroup: sourceGroup(article.publisherDomain),
      evidenceFlagsJson: JSON.stringify(article.evidenceFlags)
    }
  });
}

async function collectCorroboration({ settings, keyword, event, understanding, primaryArticle }) {
  const queries = [...new Set([...understanding.searchQueries, event.title].map((item) => String(item || '').trim()).filter(Boolean))]
    .slice(0, 3);
  const rawItems = [];

  for (const query of queries) {
    const settled = await Promise.allSettled([
      searchBing({ keyword: query, scope: '' }),
      searchGoogleNews({ keyword: query, scope: '' })
    ]);
    for (const result of settled) {
      if (result.status === 'fulfilled') rawItems.push(...result.value);
    }
    if (rawItems.length >= 12) break;
  }

  const seen = new Set([primaryArticle.canonicalUrl]);
  const accepted = [];
  for (const item of rawItems) {
    if (accepted.length >= 7) break;
    const article = await fetchArticleContent(item);
    if (!article.canonicalUrl || seen.has(article.canonicalUrl)) continue;
    seen.add(article.canonicalUrl);
    const similarity = titleSimilarity(event.title, article.title);
    const claimMention = understanding.claims.some((claim) =>
      normalizeTitle(article.bodyText || article.snippet).includes(normalizeTitle(claim.statement).slice(0, 24))
    );
    if (similarity < 0.28 && !claimMention) continue;
    accepted.push({ item, article });
  }
  return accepted;
}

function markSyndication(sources) {
  const bodyHashes = new Map();
  return sources.map((source) => {
    const hash = source.bodyHash;
    if (!hash) return { ...source, isSyndicated: Boolean(source.isSyndicated) };
    const duplicate = bodyHashes.has(hash);
    bodyHashes.set(hash, source.id);
    return { ...source, isSyndicated: duplicate || Boolean(source.isSyndicated) };
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
  const domains = new Set(independent.map((source) => source.publisherDomain).filter(Boolean));
  const hasOfficialSource = independent.some((source) => source.isOfficial);
  const fetchedCount = independent.filter((source) => source.fetchStatus === 'fetched').length;
  const datedCount = independent.filter((source) => source.sourcePublishedAt).length;
  const authoredCount = independent.filter((source) => source.sourceAuthor).length;
  const supported = verifiedClaims.filter((claim) => claim.status === 'supported').length;
  const partial = verifiedClaims.filter((claim) => claim.status === 'partially_supported').length;
  const contradicted = verifiedClaims.filter((claim) => claim.status === 'contradicted').length;
  const claimCount = Math.max(1, verifiedClaims.length);

  const evidenceScore = clamp(
    (fetchedCount / Math.max(1, independent.length)) * 45 +
    (datedCount / Math.max(1, independent.length)) * 20 +
    (authoredCount / Math.max(1, independent.length)) * 10 +
    (hasOfficialSource ? 20 : 0) +
    (independent.length >= 2 ? 5 : 0)
  );
  const sourceQualityScore = clamp(
    independent.reduce((sum, source) => sum + (source.isOfficial ? 98 : SOURCE_QUALITY[source.sourceType] ?? 50), 0) /
      Math.max(1, independent.length)
  );
  const supportRatio = (supported + partial * 0.5) / claimCount;
  const corroborationScore = clamp(
    (domains.size >= 4 ? 92 : domains.size === 3 ? 82 : domains.size === 2 ? 68 : hasOfficialSource ? 62 : 24) *
      (0.55 + supportRatio * 0.45)
  );
  const contradictionScore = clamp((contradicted / claimCount) * 100);

  return {
    relevanceScore: clamp(understanding.relevanceScore),
    evidenceScore,
    corroborationScore,
    contradictionScore,
    sourceQualityScore,
    independentSourceCount: domains.size,
    hasOfficialSource,
    supportedClaimCount: supported
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
          isOfficial: source.isOfficial,
          isSyndicated: source.isSyndicated,
          fetchStatus: source.fetchStatus,
          publishedAt: source.sourcePublishedAt
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
  const trustScore = clamp(
    relevanceScore * 0.2 +
    evidenceScore * 0.25 +
    corroborationScore * 0.4 +
    ruleScores.sourceQualityScore * 0.15 -
    contradictionScore * 0.55
  );
  const riskFlags = [...new Set(understanding.riskFlags)];
  const blockedType = ['tutorial', 'opinion', 'marketing', 'collection', 'search_noise'].includes(understanding.contentType);
  const hasEvidenceGate =
    ruleScores.supportedClaimCount >= 1 &&
    (ruleScores.independentSourceCount >= 2 || ruleScores.hasOfficialSource);
  const trusted =
    understanding.directlyRelevant &&
    relevanceScore >= 75 &&
    trustScore >= 80 &&
    contradictionScore < 25 &&
    hasEvidenceGate &&
    !blockedType;
  let verificationStatus = trusted ? 'trusted' : 'needs_review';
  if (contradictionScore >= 50 || verifiedClaims.some((claim) => claim.status === 'contradicted' && claim.importance === 'core')) {
    verificationStatus = 'contradicted';
  } else if (!understanding.directlyRelevant || relevanceScore < 50 || understanding.contentType === 'search_noise') {
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
  return `此内容与【${keyword}】的关联：${relation}。当前证据不足，已进入待核验区。`.slice(0, 220);
}

export async function processCandidateAsEvent({ item, keyword, settings }) {
  const primaryArticle = {
    ...(await fetchArticleContent(item)),
    sourceType: item.sourceType
  };
  const understanding = await understandContent({
    settings,
    keyword: keyword.term,
    article: primaryArticle
  });
  const event = await ensureEvent({ article: primaryArticle, keyword, understanding });
  await upsertSourceItem({ eventId: event.id, item, article: primaryArticle });

  const corroboration = await collectCorroboration({
    settings,
    keyword: keyword.term,
    event,
    understanding,
    primaryArticle
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
  const needsIndependentReview =
    ['high', 'urgent'].includes(adjudication.importance) ||
    (preliminary.trustScore >= 72 && preliminary.trustScore <= 88) ||
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
  return lines.join('\n');
}

export function projectEvent(event) {
  const primarySource =
    event.sourceItems?.find((source) => source.canonicalUrl === event.primaryUrl) ||
    event.sourceItems?.[0] ||
    null;
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
    aiSummary: event.summary,
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
    evidenceScore: event.evidenceScore,
    corroborationScore: event.corroborationScore,
    contradictionScore: event.contradictionScore,
    sourceQualityScore: event.sourceQualityScore,
    corroborationCount: event.independentSourceCount,
    independentSourceCount: event.independentSourceCount,
    hasOfficialSource: event.hasOfficialSource,
    auditFlagsJson: event.riskFlagsJson,
    auditVersion: event.auditVersion,
    contentType: event.contentType,
    keywords: event.keywords || [],
    sources: event.sourceItems || [],
    claims: event.claims || []
  };
}

export async function listVerifiedEvents(filters = {}) {
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(filters.pageSize || '12', 10) || 12));
  const requestedStatus = String(filters.status || '').trim();
  const verificationStatus = ['trusted', 'needs_review'].includes(requestedStatus) ? requestedStatus : 'all';
  const statusFilter =
    verificationStatus === 'all'
      ? { in: ['trusted', 'needs_review'] }
      : verificationStatus;
  const where = {
    verificationStatus: statusFilter,
    relevanceScore: verificationStatus === 'trusted' ? { gte: 75 } : undefined,
    trustScore: verificationStatus === 'trusted' ? { gte: 80 } : undefined,
    keywords: filters.keyword
      ? {
          some: {
            keyword: {
              term: { contains: String(filters.keyword) }
            }
          }
        }
      : undefined,
    sourceItems: filters.sourceType
      ? {
          some: { sourceType: String(filters.sourceType) }
        }
      : undefined
  };
  const include = {
    keywords: { include: { keyword: true } },
    sourceItems: { orderBy: { discoveredAt: 'asc' } },
    claims: true
  };
  const [items, total, allForCounts] = await Promise.all([
    prisma.hotspotEvent.findMany({
      where,
      include,
      orderBy: [
        { trustScore: 'desc' },
        { importance: 'desc' },
        { corroborationScore: 'desc' },
        { sourcePublishedAt: 'desc' },
        { lastSeenAt: 'desc' }
      ],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.hotspotEvent.count({ where }),
    prisma.hotspotEvent.findMany({
      where: { ...where, sourceItems: undefined },
      select: { sourceItems: { select: { sourceType: true } } }
    })
  ]);
  const sourceCounts = {};
  for (const event of allForCounts) {
    for (const sourceType of new Set(event.sourceItems.map((source) => source.sourceType))) {
      sourceCounts[sourceType] = (sourceCounts[sourceType] || 0) + 1;
    }
  }

  return {
    items: items.map(projectEvent),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    meta: {
      verificationStatus,
      sourceCounts: { all: total, ...sourceCounts }
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
      }
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
          isOfficial: evidence.sourceItem.isOfficial
        }
      }))
    })),
    sources: event.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.originalUrl,
      domain: source.publisherDomain,
      publisherName: source.publisherName,
      fetchStatus: source.fetchStatus,
      isOfficial: source.isOfficial,
      isSyndicated: source.isSyndicated,
      publishedAt: source.sourcePublishedAt,
      evidenceFlags: safeJson(source.evidenceFlagsJson, [])
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
  return prisma.verificationFeedback.create({
    data: {
      eventId,
      type,
      note: String(payload.note || '').trim().slice(0, 1000) || null
    }
  });
}
