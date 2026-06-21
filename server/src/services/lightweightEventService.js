import crypto from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { fetchArticleContent } from './contentService.js';
import { buildEventFingerprint, findBestEventCluster } from './eventClusteringService.js';
import { expansionListForKeyword } from './keywordExpansionService.js';
import { analyzeContent, buildHotspotSummary, preMatchKeyword } from './aiService.js';
import { calculateHeatScore } from '../utils/heat.js';
import { env } from '../config/env.js';

export const LIGHTWEIGHT_AUDIT_VERSION = 'yupi-analysis-v1';
export const RELEVANCE_THRESHOLD = 50;
export const KEYWORD_MENTION_BYPASS_THRESHOLD = 65;
const VALID_IMPORTANCE = new Set(['low', 'medium', 'high', 'urgent']);

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 0;
}

function safeArray(value, max = 20) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, max) : [];
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceGroup(domain) {
  const parts = String(domain || '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : domain || '';
}

function matchedFields(article, expandedKeywords) {
  const title = preMatchKeyword(article.title || '', expandedKeywords);
  const snippet = preMatchKeyword(article.snippet || '', expandedKeywords);
  const body = preMatchKeyword(article.bodyText || '', expandedKeywords);
  return [
    title.matched ? 'title' : '',
    snippet.matched ? 'snippet' : '',
    body.matched ? 'body' : ''
  ].filter(Boolean);
}

function normalizeAnalysis(analysis = {}) {
  return {
    isReal: Boolean(analysis.isReal),
    relevance: clamp(analysis.relevance),
    relevanceReason: String(analysis.relevanceReason || ''),
    keywordMentioned: Boolean(analysis.keywordMentioned),
    importance: VALID_IMPORTANCE.has(analysis.importance) ? analysis.importance : 'low',
    summary: String(analysis.summary || '')
  };
}

function rejectionFlags(analysis) {
  if (!analysis.isReal) {
    return ['not_real'];
  }
  if (analysis.relevance < RELEVANCE_THRESHOLD) {
    return ['low_relevance'];
  }
  if (!analysis.keywordMentioned && analysis.relevance < KEYWORD_MENTION_BYPASS_THRESHOLD) {
    return ['keyword_not_mentioned_low_relevance'];
  }
  return [];
}

export function calculateRelevanceDecision({
  analysis,
  preMatchResult = { matched: false, matchedTerms: [] },
  article = null,
  expandedKeywords = []
}) {
  const normalized = normalizeAnalysis(analysis);
  const flags = rejectionFlags(normalized);

  return {
    accepted: flags.length === 0,
    relevanceScore: normalized.relevance,
    relevanceReason: normalized.relevanceReason,
    keywordMentioned: normalized.keywordMentioned,
    isReal: normalized.isReal,
    importance: normalized.importance,
    summary: normalized.summary,
    matchedKeywords: preMatchResult.matchedTerms || [],
    matchedFields: article ? matchedFields(article, expandedKeywords) : [],
    rejectionFlags: flags
  };
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
        gte: new Date(Date.now() - Math.max(env.hotspotMaxAgeDays, 3) * 24 * 60 * 60 * 1000)
      }
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 200
  });
  return findBestEventCluster(article.title, recentEvents)?.event || null;
}

async function ensureEvent({ article, keyword }) {
  const existing = await findEvent(article);
  if (existing) return { event: existing, created: false };

  let fingerprint = buildEventFingerprint(article.title);
  const occupied = await prisma.hotspotEvent.findUnique({ where: { eventFingerprint: fingerprint } });
  if (occupied) {
    fingerprint = crypto.createHash('sha256').update(`${fingerprint}:${article.canonicalUrl}`).digest('hex');
  }

  const event = await prisma.hotspotEvent.create({
    data: {
      eventFingerprint: fingerprint,
      title: article.title,
      primaryUrl: article.resolvedUrl,
      primarySourceType: article.sourceType,
      primarySourceAuthor: article.sourceAuthor,
      sourcePublishedAt: normalizeDate(article.sourcePublishedAt),
      contentType: 'news',
      auditVersion: LIGHTWEIGHT_AUDIT_VERSION
    }
  });

  if (keyword?.id) {
    await prisma.hotspotEventKeyword.upsert({
      where: { eventId_keywordId: { eventId: event.id, keywordId: keyword.id } },
      update: {},
      create: { eventId: event.id, keywordId: keyword.id }
    });
  }

  return { event, created: true };
}

async function upsertKeywordLink({ eventId, keyword }) {
  if (!keyword?.id) return;
  await prisma.hotspotEventKeyword.upsert({
    where: { eventId_keywordId: { eventId, keywordId: keyword.id } },
    update: {},
    create: { eventId, keywordId: keyword.id }
  });
}

async function upsertSourceItem({ eventId, item, article }) {
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
      sourceGroup: sourceGroup(article.publisherDomain),
      sourceAuthorityScore: article.sourceAuthorityScore ?? 50,
      authorityReason: article.authorityReason || null,
      officialEntity: article.officialEntity || null,
      independenceGroup: sourceGroup(article.publisherDomain),
      evidenceFlagsJson: JSON.stringify(article.evidenceFlags || [])
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
      discoverySourceType: item.sourceType,
      sourceAuthor: article.sourceAuthor,
      sourcePublishedAt: normalizeDate(article.sourcePublishedAt),
      engagementJson: item.engagementJson || null,
      fetchStatus: article.fetchStatus,
      fetchError: article.fetchError,
      isOfficial: article.isOfficial,
      isSyndicated: false,
      sourceGroup: sourceGroup(article.publisherDomain),
      sourceAuthorityScore: article.sourceAuthorityScore ?? 50,
      authorityReason: article.authorityReason || null,
      officialEntity: article.officialEntity || null,
      independenceGroup: sourceGroup(article.publisherDomain),
      evidenceFlagsJson: JSON.stringify(article.evidenceFlags || [])
    }
  });
}

function summaryFor({ keyword, article, decision }) {
  return buildHotspotSummary({
    value: decision.summary || decision.relevanceReason,
    item: {
      title: article.title,
      snippet: article.snippet
    },
    keyword: keyword.term
  });
}

function buildFullText(article) {
  return `${article.title || ''}\n${article.bodyText || article.snippet || ''}`.trim();
}

export async function processCandidateByRelevance({ item, keyword, settings, expandedKeywords }) {
  const primaryArticle = {
    ...(await fetchArticleContent(item)),
    sourceType: item.sourceType
  };
  const keywordVariants = expandedKeywords?.length
    ? expandedKeywords
    : expansionListForKeyword(keyword.term || keyword, []);
  const fullText = buildFullText(primaryArticle);
  const preMatchResult = preMatchKeyword(fullText, keywordVariants);
  const analysis = await analyzeContent(fullText, keyword.term || keyword, preMatchResult, settings);
  const decision = calculateRelevanceDecision({
    analysis,
    preMatchResult,
    article: primaryArticle,
    expandedKeywords: keywordVariants
  });
  const heatScore = calculateHeatScore({ engagementJson: item.engagementJson });
  const { event, created } = await ensureEvent({ article: primaryArticle, keyword });
  await upsertKeywordLink({ eventId: event.id, keyword });
  await upsertSourceItem({ eventId: event.id, item, article: primaryArticle });

  const nextStatus = decision.accepted ? 'trusted' : 'rejected';
  const shouldExpose = decision.accepted;
  const riskFlags = [
    ...safeArray(primaryArticle.evidenceFlags, 12),
    ...decision.rejectionFlags
  ];
  const auditEvidence = {
    relevanceReason: decision.relevanceReason,
    matchedKeywords: decision.matchedKeywords,
    matchedFields: decision.matchedFields,
    keywordMentioned: decision.keywordMentioned,
    isReal: decision.isReal
  };

  const updated = await prisma.hotspotEvent.update({
    where: { id: event.id },
    data: {
      title: primaryArticle.title || event.title,
      summary: summaryFor({ keyword, article: primaryArticle, decision }),
      primaryUrl: primaryArticle.resolvedUrl || event.primaryUrl,
      primarySourceType: item.sourceType,
      primarySourceAuthor: primaryArticle.sourceAuthor || item.sourceAuthor,
      sourcePublishedAt: normalizeDate(primaryArticle.sourcePublishedAt) || event.sourcePublishedAt,
      contentType: 'news',
      verificationStatus: nextStatus,
      relevanceScore: decision.relevanceScore,
      evidenceScore: 0,
      corroborationScore: 0,
      contradictionScore: 0,
      sourceQualityScore: 0,
      trustScore: 0,
      heatScore,
      matchedKeywordsJson: JSON.stringify(decision.matchedKeywords),
      relevanceReason: decision.relevanceReason,
      keywordMentioned: decision.keywordMentioned,
      importance: decision.importance,
      independentSourceCount: 1,
      hasOfficialSource: false,
      riskFlagsJson: JSON.stringify(riskFlags),
      auditEvidenceJson: JSON.stringify(auditEvidence),
      auditVersion: LIGHTWEIGHT_AUDIT_VERSION,
      verifiedAt: nextStatus === 'trusted' ? new Date() : null
    },
    include: {
      keywords: { include: { keyword: true } },
      sourceItems: true,
      claims: { include: { evidence: { include: { sourceItem: true } } } },
      feedback: true
    }
  });

  return {
    event: updated,
    created,
    accepted: shouldExpose,
    fullTextFetched: primaryArticle.fetchStatus === 'fetched',
    bodyUnavailable: safeArray(primaryArticle.evidenceFlags, 12).includes('body_unavailable'),
    verificationFailed: !decision.accepted,
    aiCallCount: analysis.aiCalled ? 1 : 0,
    aiFailed: Boolean(analysis.aiFailed),
    aiError: analysis.aiError || ''
  };
}
