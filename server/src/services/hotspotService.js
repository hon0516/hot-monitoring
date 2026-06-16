import { prisma } from '../db/prisma.js';
import { analyzeHotspot, buildHotspotSummary, expandKeyword, preMatchKeyword, sanitizeEvidenceText } from './aiService.js';
import {
  buildEvidencePackage,
  finalizeAudit,
  needsSecondReview,
  shouldStoreAuditedCandidate,
  shouldUseAiReview
} from './auditService.js';
import { dispatchEventNotifications, dispatchNotifications } from './notificationService.js';
import { ensureSettings } from './settingsService.js';
import { searchBing } from '../sources/bingSource.js';
import { searchGoogleNews } from '../sources/googleNewsSource.js';
import { searchHackerNews } from '../sources/hackerNewsSource.js';
import { searchTwitter } from '../sources/twitterSource.js';
import { searchBilibili } from '../sources/bilibiliSource.js';
import { searchSogou } from '../sources/sogouSource.js';
import { buildDedupeFields, meetsNotificationThreshold } from '../utils/normalize.js';
import { calculateHeatScore, getHeatLabel } from '../utils/heat.js';
import { randomDelay, sleep } from '../utils/delay.js';
import { socketHub } from '../ws/socketHub.js';
import { env } from '../config/env.js';
import { processCandidateAsEvent, projectEvent } from './deepVerificationService.js';
import { recordSourceHealth } from './sourceHealthService.js';
import { replaceLatestScanInbox } from './latestScanInboxService.js';

const HOTSPOT_MAX_AGE_DAYS = 30;
const HIDDEN_SOURCE_TYPES = new Set(['weibo', 'weibo-hot']);

function getHotspotFreshnessWhere() {
  const cutoff = new Date(Date.now() - HOTSPOT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  return {
    OR: [{ sourcePublishedAt: null }, { sourcePublishedAt: { gte: cutoff } }]
  };
}

async function findDuplicate({ canonicalUrl, titleNormalized }) {
  return prisma.hotspot.findFirst({
    where: {
      OR: [
        canonicalUrl ? { canonicalUrl } : undefined,
        { titleNormalized }
      ].filter(Boolean)
    },
    include: {
      keywords: {
        include: {
          keyword: true
        }
      }
    }
  });
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function ensureHotspotKeyword(hotspotId, keywordId) {
  if (!keywordId) {
    return;
  }

  await prisma.hotspotKeyword.upsert({
    where: {
      hotspotId_keywordId: {
        hotspotId,
        keywordId
      }
    },
    update: {},
    create: {
      hotspotId,
      keywordId
    }
  });
}

async function hydrateHotspot(id) {
  const hotspot = await prisma.hotspot.findUnique({
    where: { id },
    include: {
      keywords: {
        include: {
          keyword: true
        }
      },
      notifications: {
        orderBy: {
          sentAt: 'desc'
        }
      }
    }
  });

  return sanitizeHotspot(hotspot);
}

const hotspotOrderBy = [
  { trustScore: 'desc' },
  { aiRelevance: 'desc' },
  { sourceQualityScore: 'desc' },
  { sourcePublishedAt: 'desc' },
  { discoveredAt: 'desc' }
];

export async function listHotspots(filters) {
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(filters.pageSize || '12', 10) || 12));
  const where = buildHotspotWhere(filters);
  const sourceCountsWhere = buildHotspotWhere({ ...filters, sourceType: '' });

  const [items, total, sourceGroups] = await Promise.all([
    prisma.hotspot.findMany({
      where,
      include: {
        keywords: {
          include: {
            keyword: true
          }
        },
        notifications: {
          orderBy: {
            sentAt: 'desc'
          }
        }
      },
      orderBy: hotspotOrderBy,
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.hotspot.count({ where }),
    prisma.hotspot.groupBy({
      by: ['sourceType'],
      where: sourceCountsWhere,
      _count: {
        _all: true
      }
    })
  ]);

  return {
    items: items.map(sanitizeHotspot),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    meta: {
      sourceCounts: buildSourceCounts(sourceGroups)
    }
  };
}

function buildHotspotWhere(filters) {
  return {
    AND: [
      getHotspotFreshnessWhere(),
      {
        sourceType: {
          notIn: [...HIDDEN_SOURCE_TYPES]
        }
      },
      {
        sourceType: filters.sourceType || undefined,
        aiImportance: filters.importance || undefined,
        OR:
          filters.onlyReal === 'true'
            ? [
                {
                  auditStatus: 'trusted',
                  trustScore: {
                    gte: 75
                  },
                  aiRelevance: {
                    gte: 70
                  }
                },
                {
                  auditStatus: null,
                  aiIsReal: true,
                  aiRelevance: {
                    gte: 70
                  }
                }
              ]
            : undefined,
        keywords: filters.keyword
          ? {
              some: {
                keyword: {
                  term: {
                    contains: filters.keyword
                  }
                }
              }
            }
          : undefined,
        notifications:
          filters.onlyNotified === 'true'
            ? {
                some: {
                  status: 'sent'
                }
              }
            : undefined
      }
    ]
  };
}

function buildSourceCounts(groups) {
  const counts = buildSourceStats();
  for (const group of groups) {
    if (HIDDEN_SOURCE_TYPES.has(group.sourceType)) {
      continue;
    }
    counts[group.sourceType] = group._count?._all || 0;
  }

  return {
    all: Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0),
    ...counts
  };
}

function sanitizeHotspot(hotspot) {
  if (!hotspot) {
    return hotspot;
  }

  const keyword = hotspot.keywords?.[0]?.keyword?.term || null;
  const heatScore = calculateHeatScore(hotspot);

  return {
    ...hotspot,
    heatScore,
    heatLabel: getHeatLabel(heatScore),
    aiSummary: hotspot.aiSummary || buildHotspotSummary({
      value: hotspot.aiSummary,
      item: {
        title: hotspot.title,
        snippet: hotspot.snippet
      },
      keyword
    }),
    aiEvidence: sanitizeEvidenceText(hotspot.aiEvidence, { publishedAt: hotspot.sourcePublishedAt })
  };
}

export async function getHotspotById(id) {
  return hydrateHotspot(id);
}

async function createHotspotRecord({ item, keyword, analysis, audit }) {
  const { canonicalUrl, titleNormalized, dedupeKey } = buildDedupeFields(item);
  const fallbackSummary = buildHotspotSummary({
    value: analysis?.summary,
    item,
    keyword: keyword?.term || null
  });
  const existing = await findDuplicate({ canonicalUrl, titleNormalized });

  if (existing) {
    await ensureHotspotKeyword(existing.id, keyword?.id);
    if (
      (analysis || audit) &&
      (existing.aiImportance === null ||
        existing.aiRelevance === null ||
        existing.aiSummary === null ||
        existing.aiEvidence === null ||
        existing.auditStatus === null ||
        existing.trustScore === null)
    ) {
      await prisma.hotspot.update({
        where: { id: existing.id },
        data: {
          aiIsReal: analysis?.isReal ?? existing.aiIsReal,
          aiRelevance: analysis?.relevance ?? existing.aiRelevance,
          aiImportance: analysis?.importance ?? existing.aiImportance,
          aiSummary: fallbackSummary || existing.aiSummary,
          aiEvidence: analysis?.evidence ?? existing.aiEvidence,
          auditStatus: audit?.auditStatus ?? null,
          aiConfidence: audit?.aiConfidence ?? null,
          trustScore: audit?.trustScore ?? null,
          sourceQualityScore: audit?.sourceQualityScore ?? null,
          auditFlagsJson: audit?.auditFlags ? JSON.stringify(audit.auditFlags) : null,
          auditVersion: audit?.auditVersion ?? null,
          corroborationCount: audit?.corroborationCount ?? 0
        }
      });
    }

    return { hotspot: await hydrateHotspot(existing.id), created: false, pendingAnalysis: false };
  }

  const created = await prisma.hotspot.create({
    data: {
      title: item.title,
      snippet: item.snippet,
      url: item.url,
      canonicalUrl,
      sourceType: item.sourceType,
      sourceAuthor: item.sourceAuthor,
      sourcePublishedAt: parseDate(item.sourcePublishedAt),
      engagementJson: item.engagementJson || null,
      dedupeKey,
      titleNormalized,
      aiIsReal: analysis?.isReal ?? null,
      aiRelevance: analysis?.relevance ?? null,
      aiImportance: analysis?.importance ?? null,
      aiSummary: fallbackSummary,
      aiEvidence: analysis?.evidence ?? null,
      auditStatus: audit?.auditStatus ?? null,
      aiConfidence: audit?.aiConfidence ?? null,
      trustScore: audit?.trustScore ?? null,
      sourceQualityScore: audit?.sourceQualityScore ?? null,
      auditFlagsJson: audit?.auditFlags ? JSON.stringify(audit.auditFlags) : null,
      auditVersion: audit?.auditVersion ?? null,
      corroborationCount: audit?.corroborationCount ?? 0,
      keywords: keyword?.id
        ? {
            create: {
              keywordId: keyword.id
            }
          }
        : undefined
    }
  });

  return {
    hotspot: await hydrateHotspot(created.id),
    created: true,
    pendingAnalysis: !analysis
  };
}

const KEYWORD_SOURCE_CONFIGS = [
  { name: 'bing', runner: searchBing, applyDelay: true, enabledKey: 'bingSourceEnabled' },
  { name: 'google-news', runner: searchGoogleNews, applyDelay: false, enabledKey: 'googleNewsSourceEnabled' },
  { name: 'hacker-news', runner: searchHackerNews, applyDelay: false, enabledKey: 'hackerNewsSourceEnabled' },
  { name: 'twitter', runner: searchTwitter, applyDelay: false, enabledKey: 'twitterSourceEnabled' },
  { name: 'bilibili', runner: searchBilibili, applyDelay: false, enabledKey: 'bilibiliSourceEnabled' },
  { name: 'sogou', runner: searchSogou, applyDelay: false, enabledKey: 'sogouSourceEnabled' }
];

const HOT_SOURCE_CONFIGS = [];

let collectionJobId = 0;
let activeCollectionPromise = null;
let collectionStatus = {
  jobId: null,
  state: 'idle',
  trigger: null,
  startedAt: null,
  finishedAt: null,
  message: '',
  warning: '',
  error: null,
  result: null
};

function setCollectionStatus(patch) {
  collectionStatus = {
    ...collectionStatus,
    ...patch
  };
}

export function getCollectionStatus() {
  return {
    ...collectionStatus,
    running: collectionStatus.state === 'running'
  };
}

export function isCollectionRunning() {
  return Boolean(activeCollectionPromise);
}

export function triggerCollection({ trigger = 'manual' } = {}) {
  if (activeCollectionPromise) {
    return {
      accepted: false,
      alreadyRunning: true,
      status: getCollectionStatus()
    };
  }

  const jobId = ++collectionJobId;
  const startedAt = new Date().toISOString();

  setCollectionStatus({
    jobId,
    state: 'running',
    trigger,
    startedAt,
    finishedAt: null,
    message: trigger === 'manual' ? '已开始后台扫描' : '后台定时扫描进行中',
    warning: '',
    error: null,
    result: null
  });

  activeCollectionPromise = (async () => {
    try {
      const result = await runCollection({ trigger });
      const finishedAt = new Date().toISOString();
      const latestScanInbox = await replaceLatestScanInbox({
        scanJobId: jobId,
        trigger,
        scannedAt: new Date(finishedAt),
        items: result.items
      });
      socketHub.publishLatestScan(latestScanInbox);
      const warning = String(result.warning || '').trim();
      const message = String(result.message || '').trim() || `扫描完成，新增 ${result.createdCount} 条热点`;

      setCollectionStatus({
        state: 'succeeded',
        finishedAt,
        message,
        warning,
        error: null,
        result: {
          trigger: result.trigger,
          aiProvider: result.aiProvider,
          createdCount: result.createdCount,
          duplicateCount: result.duplicateCount,
          skippedCount: result.skippedCount,
          processedCount: result.processedCount,
          analysisErrorCount: result.analysisErrorCount,
          pendingAnalysisCount: result.pendingAnalysisCount,
          hitAnalysisLimit: result.hitAnalysisLimit,
          skipAiForCurrentRun: result.skipAiForCurrentRun,
          ruleOnlyCount: result.ruleOnlyCount,
          aiReviewedCount: result.aiReviewedCount,
          ruleFilteredCount: result.ruleFilteredCount,
          lowRelevanceFilteredCount: result.lowRelevanceFilteredCount,
          fullTextFetchedCount: result.fullTextFetchedCount,
          corroboratedCount: result.corroboratedCount,
          verificationFailedCount: result.verificationFailedCount,
          trustedCount: result.trustedCount,
          createdEventCount: result.createdEventCount,
          updatedEventCount: result.updatedEventCount,
          latestScanCount: latestScanInbox.total,
          sourceStats: result.sourceStats
        }
      });

      return result;
    } catch (error) {
      setCollectionStatus({
        state: 'failed',
        finishedAt: new Date().toISOString(),
        message: '后台扫描失败',
        warning: '',
        error: error.message || '未知错误',
        result: null
      });
      throw error;
    } finally {
      activeCollectionPromise = null;
    }
  })();

  activeCollectionPromise.catch((error) => {
    console.error(`[collection:${trigger}] 后台任务失败`, error);
  });

  return {
    accepted: true,
    alreadyRunning: false,
    status: getCollectionStatus()
  };
}

function buildSourceStats() {
  return Object.fromEntries([...KEYWORD_SOURCE_CONFIGS, ...HOT_SOURCE_CONFIGS].map((source) => [source.name, 0]));
}

function getEnabledKeywordSources(settings) {
  return KEYWORD_SOURCE_CONFIGS.filter((source) => settings[source.enabledKey] !== false);
}

function buildSearchResultId(item, fallbackIndex) {
  const canonicalSource = String(item.url || item.title || fallbackIndex || 'search')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  return `${item.sourceType || 'search'}:${canonicalSource}`;
}

function compareSearchItems(left, right) {
  const rightPublishedAt = new Date(right?.sourcePublishedAt || right?.discoveredAt || 0).getTime();
  const leftPublishedAt = new Date(left?.sourcePublishedAt || left?.discoveredAt || 0).getTime();
  const publishedDiff = rightPublishedAt - leftPublishedAt;
  if (publishedDiff !== 0) {
    return publishedDiff;
  }

  const rightDiscoveredAt = new Date(right?.discoveredAt || 0).getTime();
  const leftDiscoveredAt = new Date(left?.discoveredAt || 0).getTime();
  return rightDiscoveredAt - leftDiscoveredAt;
}

function normalizeSearchResultItem({ item, query, fallbackIndex }) {
  return {
    id: buildSearchResultId(item, fallbackIndex),
    title: item.title,
    snippet: item.snippet || item.title,
    url: item.url,
    sourceType: item.sourceType,
    sourceAuthor: item.sourceAuthor,
    sourcePublishedAt: item.sourcePublishedAt || null,
    engagementJson: item.engagementJson || null,
    discoveredAt: new Date().toISOString(),
    keywords: query
      ? [
          {
            keyword: {
              term: query
            }
          }
        ]
      : []
  };
}

async function processSourceItems({
  source,
  settings,
  keyword = null,
  trigger,
  createdItems,
  counters,
  sourceStats
}) {
  let sourceItems = [];
  const sourceStartedAt = new Date();

  try {
    sourceItems = await source.runner({
      keyword: keyword?.term || null,
      scope: settings.scope
    });
  } catch (error) {
    console.error(`[collection:${source.name}]`, error.message);
    await recordSourceHealth({
      sourceType: source.name,
      startedAt: sourceStartedAt,
      error
    });
    if (source.applyDelay) {
      await sleep(randomDelay());
    }
    return;
  }

  for (const item of sourceItems) {
    sourceStats[item.sourceType || source.name] = (sourceStats[item.sourceType || source.name] || 0) + 1;

    if (counters.processedCount >= env.aiAnalysisMaxItemsPerRun) {
      counters.hitAnalysisLimit = true;
      break;
    }

    counters.processedCount += 1;
    if (!keyword?.id || !item?.title || !item?.url) {
      counters.skippedCount += 1;
      counters.ruleFilteredCount += 1;
      continue;
    }

    try {
      const result = await processCandidateAsEvent({
        item,
        keyword,
        settings
      });
      const projected = projectEvent(result.event);
      counters.aiReviewedCount += result.aiCallCount || 3;
      if (result.fullTextFetched) counters.fullTextFetchedCount += 1;
      if (result.corroborated) counters.corroboratedCount += 1;
      if (result.verificationFailed) counters.verificationFailedCount += 1;
      if (result.event.verificationStatus === 'trusted') counters.trustedCount += 1;
      if (result.created) counters.createdEventCount += 1;
      else counters.updatedEventCount += 1;

      const existingIndex = createdItems.findIndex((entry) => entry.id === projected.id);
      if (existingIndex >= 0) createdItems[existingIndex] = projected;
      else createdItems.push(projected);

      if (result.event.verificationStatus === 'trusted') {
        await dispatchEventNotifications({
          event: result.event,
          hotspot: projected,
          settings,
          trigger
        });
      }
    } catch (error) {
      counters.analysisErrorCount += 1;
      counters.analysisErrorMessage ||= error.message;
      counters.verificationFailedCount += 1;
      counters.skippedCount += 1;
      console.error('[deep-verification] 热点深度核验失败', error.message);
    }
  }

  await recordSourceHealth({
    sourceType: source.name,
    startedAt: sourceStartedAt,
    candidateCount: sourceItems.length,
    filteredCount: counters.skippedCount
  });

  if (source.applyDelay) {
    await sleep(randomDelay());
  }
}

function buildRuleOnlyAnalysis({ audit, preMatch, item, keyword }) {
  const relationSummary = buildRuleRelationSummary({ audit, preMatch, item, keyword });

  return {
    isReal: audit.auditStatus === 'trusted' || audit.auditStatus === 'needs_review',
    relevance: audit.relevanceScore,
    importance: audit.importance || 'low',
    keywordMentioned: Boolean(preMatch?.matched),
    summary: relationSummary,
    evidence: audit.evidence.join('\n')
  };
}

function buildRuleRelationSummary({ audit, preMatch, item, keyword }) {
  if (!keyword) {
    return null;
  }

  const title = String(item?.title || '').trim();
  const contentType = audit.contentType || 'discussion';
  const matchedTerms = Array.isArray(preMatch?.matchedTerms) ? preMatch.matchedTerms.filter(Boolean).slice(0, 2) : [];
  const matchText = matchedTerms.length ? `命中「${matchedTerms.join('、')}」` : '命中关键词线索';

  if (preMatch?.matched) {
    if (contentType === 'event') {
      return `此内容与【${keyword}】的关联：${matchText}，并呈现为近期事件或产品动态。`;
    }

    if (contentType === 'tutorial') {
      return `此内容与【${keyword}】的关联：${matchText}，但更像教程或经验内容，需降低热点权重。`;
    }

    if (contentType === 'collection') {
      return `此内容与【${keyword}】的关联：${matchText}，但更像合集或系列内容，需谨慎展示。`;
    }

    return `此内容与【${keyword}】的关联：${matchText}，主题与监控关键词直接相关。`;
  }

  if (title) {
    return `此内容与【${keyword}】的关联：标题《${title}》来自关键词检索结果，但未直接命中关键词，相关性保守评估。`;
  }

  return `此内容与【${keyword}】的关联：来自关键词检索结果，但证据较少，相关性保守评估。`;
}

function mergeAnalysisResults(first, second, firstAudit, secondAudit) {
  if (!second) {
    return first;
  }

  const firstTrust = Number(firstAudit?.trustScore ?? first?.trustScore ?? 0);
  const secondTrust = Number(secondAudit?.trustScore ?? second?.trustScore ?? 0);
  const conservative = secondTrust < firstTrust ? second : first;

  return {
    ...conservative,
    isReal: Boolean(first?.isReal && second?.isReal),
    relevance: Math.round((Number(first?.relevance || 0) + Number(second?.relevance || 0)) / 2),
    trustScore: Math.min(Number(first?.trustScore || 0), Number(second?.trustScore || 0)),
    confidence: Math.round((Number(first?.confidence || 0) + Number(second?.confidence || 0)) / 2),
    evidence: [first?.evidence, second?.evidence].filter(Boolean).join('\n')
  };
}

function alignAnalysisWithAudit(analysis, audit) {
  return {
    ...analysis,
    isReal: audit.auditStatus === 'trusted' || (analysis.isReal === true && audit.auditStatus === 'needs_review'),
    relevance: audit.relevanceScore,
    evidence: audit.evidence.join('\n')
  };
}

function buildCollectionWarning({ createdCount, counters }) {
  const warnings = [];

  if (counters.analysisErrorCount) {
    const reason = counters.analysisErrorMessage || 'AI 分析服务异常';
    if (!createdCount && counters.processedCount > 0) {
      warnings.push(`本轮已抓取 ${counters.processedCount} 条候选内容，但 AI 分析不可用（${reason}），因此结果均以待复核状态保存。`);
    } else {
      warnings.push(`本轮有 ${counters.analysisErrorCount} 条候选内容在 AI 分析阶段失败（${reason}），已按待复核状态保存。`);
    }
  }

  if (counters.hitAnalysisLimit) {
    warnings.push(`为避免长时间等待，本轮最多处理 ${env.aiAnalysisMaxItemsPerRun} 条候选内容。`);
  }

  if (counters.skipAiForCurrentRun) {
    warnings.push('本轮 AI 连续失败已触发熔断，剩余候选按待复核状态保存。');
  }

  return warnings.join(' ');
}

export async function runCollection({ trigger = 'manual' } = {}) {
  const settings = await ensureSettings();
  const aiProvider = settings.aiProvider || 'openrouter';
  const keywords = await prisma.keyword.findMany({
    where: {
      enabled: true
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  const keywordSources = getEnabledKeywordSources(settings);
  const hotSources = HOT_SOURCE_CONFIGS.filter((source) => settings[source.enabledKey] !== false);
  const createdItems = [];
  const counters = {
    duplicateCount: 0,
    skippedCount: 0,
    processedCount: 0,
    analysisErrorCount: 0,
    analysisConsecutiveFailures: 0,
    analysisErrorMessage: null,
    pendingAnalysisCount: 0,
    hitAnalysisLimit: false,
    skipAiForCurrentRun: false,
    ruleOnlyCount: 0,
    aiReviewedCount: 0,
    ruleFilteredCount: 0,
    lowRelevanceFilteredCount: 0,
    fullTextFetchedCount: 0,
    corroboratedCount: 0,
    verificationFailedCount: 0,
    trustedCount: 0,
    createdEventCount: 0,
    updatedEventCount: 0
  };
  const sourceStats = buildSourceStats();

  for (const keyword of keywords) {
    for (const source of keywordSources) {
      await processSourceItems({
        source,
        settings,
        keyword,
        trigger,
        createdItems,
        counters,
        sourceStats
      });
    }
  }

  for (const source of hotSources) {
    await processSourceItems({
      source,
      settings,
      trigger,
      createdItems,
      counters,
      sourceStats
    });
  }

  const message =
    keywords.length || !hotSources.length
      ? undefined
      : '暂无启用中的关键词，本轮仅采集热榜源';

  if (!keywords.length && !hotSources.length) {
    return {
      trigger,
      aiProvider,
      message: '暂无启用中的关键词，且热榜源均已停用',
      warning: buildCollectionWarning({ createdCount: 0, counters }),
      createdCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      processedCount: 0,
      analysisErrorCount: 0,
      pendingAnalysisCount: 0,
      hitAnalysisLimit: false,
      skipAiForCurrentRun: false,
      ruleOnlyCount: 0,
      aiReviewedCount: 0,
      ruleFilteredCount: 0,
      lowRelevanceFilteredCount: 0,
      fullTextFetchedCount: 0,
      corroboratedCount: 0,
      verificationFailedCount: 0,
      trustedCount: 0,
      createdEventCount: 0,
      updatedEventCount: 0,
      sourceStats,
      items: []
    }
  }

  const warning = buildCollectionWarning({
    createdCount: createdItems.length,
    counters
  });

  return {
    trigger,
    aiProvider,
    message,
    warning,
    createdCount: createdItems.length,
    duplicateCount: counters.duplicateCount,
    skippedCount: counters.skippedCount,
    processedCount: counters.processedCount,
    analysisErrorCount: counters.analysisErrorCount,
    pendingAnalysisCount: counters.pendingAnalysisCount,
    hitAnalysisLimit: counters.hitAnalysisLimit,
    skipAiForCurrentRun: counters.skipAiForCurrentRun,
    ruleOnlyCount: counters.ruleOnlyCount,
    aiReviewedCount: counters.aiReviewedCount,
    ruleFilteredCount: counters.ruleFilteredCount,
    lowRelevanceFilteredCount: counters.lowRelevanceFilteredCount,
    fullTextFetchedCount: counters.fullTextFetchedCount,
    corroboratedCount: counters.corroboratedCount,
    verificationFailedCount: counters.verificationFailedCount,
    trustedCount: counters.trustedCount,
    createdEventCount: counters.createdEventCount,
    updatedEventCount: counters.updatedEventCount,
    sourceStats,
    items: createdItems
  };
}

export async function searchHotspotsAcrossSources({ query }) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    throw new Error('请输入要搜索的关键词');
  }

  const settings = await ensureSettings();
  const enabledSources = getEnabledKeywordSources(settings);
  const settledResults = await Promise.allSettled(
    enabledSources.map(async (source) => {
      const items = await source.runner({
        keyword: trimmedQuery,
        scope: ''
      });

      return {
        source: source.name,
        items: Array.isArray(items) ? items : []
      };
    })
  );

  const sourceStats = buildSourceStats();
  const results = [];

  settledResults.forEach((result, index) => {
    const sourceName = enabledSources[index]?.name;
    if (!sourceName) {
      return;
    }

    if (result.status !== 'fulfilled') {
      console.error(`[search:${sourceName}]`, result.reason?.message || result.reason || '即时搜索失败');
      sourceStats[sourceName] = 0;
      return;
    }

    sourceStats[sourceName] = result.value.items.length;
    result.value.items.forEach((item, itemIndex) => {
      if (!item?.title || !item?.url) {
        return;
      }

      results.push(
        normalizeSearchResultItem({
          item,
          query: trimmedQuery,
          fallbackIndex: `${sourceName}-${itemIndex}`
        })
      );
    });
  });

  const dedupedResults = Array.from(
    results.reduce((map, item) => {
      const dedupeKey = `${item.url || ''}::${item.title || ''}`.trim().toLowerCase();
      if (!dedupeKey || map.has(dedupeKey)) {
        return map;
      }

      map.set(dedupeKey, item);
      return map;
    }, new Map())
  )
    .map(([, item]) => item)
    .sort(compareSearchItems);

  return {
    items: dedupedResults,
    meta: {
      query: trimmedQuery,
      total: dedupedResults.length,
      enabledSources: enabledSources.map((source) => source.name),
      sourceStats,
      searchedAt: new Date().toISOString()
    }
  };
}
