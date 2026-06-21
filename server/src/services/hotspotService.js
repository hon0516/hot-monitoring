import { prisma } from '../db/prisma.js';
import { analyzeContent, buildHotspotSummary, preMatchKeyword, sanitizeEvidenceText } from './aiService.js';
import { dispatchEventNotifications } from './notificationService.js';
import { ensureSettings } from './settingsService.js';
import { searchBing } from '../sources/bingSource.js';
import { searchGoogleNews } from '../sources/googleNewsSource.js';
import { searchHackerNews } from '../sources/hackerNewsSource.js';
import { searchTwitter } from '../sources/twitterSource.js';
import { searchBilibili } from '../sources/bilibiliSource.js';
import { searchSogou } from '../sources/sogouSource.js';
import { searchWeibo } from '../sources/weiboSource.js';
import { calculateHeatScore, getHeatLabel } from '../utils/heat.js';
import { randomDelay, sleep } from '../utils/delay.js';
import { socketHub } from '../ws/socketHub.js';
import { env } from '../config/env.js';
import { projectEvent } from './deepVerificationService.js';
import { calculateRelevanceDecision, processCandidateByRelevance } from './lightweightEventService.js';
import { expansionListForKeyword, resolveKeywordExpansions } from './keywordExpansionService.js';
import { recordSourceHealth } from './sourceHealthService.js';
import { replaceLatestScanInbox } from './latestScanInboxService.js';

const HIDDEN_SOURCE_TYPES = new Set(['weibo', 'weibo-hot']);
const TWITTER_ANALYSIS_QUOTA = 15;
const OTHER_ANALYSIS_QUOTA = 10;
const SOURCE_PRIORITY = {
  twitter: 1,
  weibo: 2,
  bilibili: 3,
  hackernews: 4,
  'hacker-news': 4,
  sogou: 5,
  bing: 6,
  google: 7,
  'google-news': 7,
  duckduckgo: 8
};

function analysisQuotaLimit(limit) {
  return Math.min(
    Number.isFinite(Number(limit)) ? Number(limit) : TWITTER_ANALYSIS_QUOTA + OTHER_ANALYSIS_QUOTA,
    TWITTER_ANALYSIS_QUOTA + OTHER_ANALYSIS_QUOTA
  );
}

function getHotspotFreshnessWhere() {
  const cutoff = new Date(Date.now() - env.hotspotMaxAgeDays * 24 * 60 * 60 * 1000);

  return {
    OR: [{ sourcePublishedAt: null }, { sourcePublishedAt: { gte: cutoff } }]
  };
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

const KEYWORD_SOURCE_CONFIGS = [
  { name: 'bing', runner: searchBing, applyDelay: true, enabledKey: 'bingSourceEnabled' },
  { name: 'google-news', runner: searchGoogleNews, applyDelay: false, enabledKey: 'googleNewsSourceEnabled' },
  { name: 'hacker-news', runner: searchHackerNews, applyDelay: false, enabledKey: 'hackerNewsSourceEnabled' },
  { name: 'twitter', runner: searchTwitter, applyDelay: false, enabledKey: 'twitterSourceEnabled' },
  { name: 'bilibili', runner: searchBilibili, applyDelay: false, enabledKey: 'bilibiliSourceEnabled' },
  { name: 'weibo', runner: searchWeibo, applyDelay: false, enabledKey: 'weiboSourceEnabled' },
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
  result: null,
  progress: null
};

function setCollectionStatus(patch) {
  collectionStatus = {
    ...collectionStatus,
    ...patch
  };
}

function setCollectionProgress(patch) {
  if (collectionStatus.state !== 'running') return;
  const progress = {
    ...(collectionStatus.progress || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  setCollectionStatus({
    progress,
    message: progress.totalToProcess
      ? `后台扫描进行中：已完成 ${progress.completedCount || 0}/${progress.totalToProcess}`
      : collectionStatus.message
  });
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
    result: null,
    progress: {
      phase: 'starting',
      mode: trigger === 'manual' ? 'quick' : 'deep',
      collectedCount: 0,
      candidateCount: 0,
      analysisLimit: 0,
      totalToProcess: 0,
      startedCount: 0,
      completedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      remainingCount: 0,
      activeCount: 0,
      keywordExpansions: [],
      currentItems: [],
      updatedAt: startedAt
    }
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
        progress: {
          ...(collectionStatus.progress || {}),
          phase: 'completed',
          completedCount: result.processedCount,
          remainingCount: 0,
          activeCount: 0,
          currentItems: [],
          updatedAt: finishedAt
        },
        result: {
          trigger: result.trigger,
          aiProvider: result.aiProvider,
          analysisMode: result.analysisMode,
          analysisLimit: result.analysisLimit,
          analysisConcurrency: result.analysisConcurrency,
          candidateCount: result.candidateCount,
          createdCount: result.createdCount,
          duplicateCount: result.duplicateCount,
          skippedCount: result.skippedCount,
          processedCount: result.processedCount,
          acceptedCount: result.acceptedCount,
          rejectedCount: result.rejectedCount,
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
          keywordExpansions: result.keywordExpansions,
          sourceStats: result.sourceStats,
          sourceMetrics: result.sourceMetrics
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
        progress: {
          ...(collectionStatus.progress || {}),
          phase: 'failed',
          activeCount: 0,
          currentItems: [],
          updatedAt: new Date().toISOString()
        },
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

function getScanBudget(trigger) {
  const quick = trigger === 'manual';
  return {
    mode: quick ? 'quick' : 'deep',
    maxItems: quick ? env.aiAnalysisManualMaxItemsPerRun : env.aiAnalysisMaxItemsPerRun,
    concurrency: quick ? env.aiAnalysisManualConcurrency : env.aiAnalysisConcurrency
  };
}

function buildSearchResultId(item, fallbackIndex) {
  const canonicalSource = String(item.url || item.title || fallbackIndex || 'search')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  return `${item.sourceType || 'search'}:${canonicalSource}`;
}

function createSourceMetric(name) {
  return {
    sourceType: name,
    startedAt: new Date(),
    collected: 0,
    processed: 0,
    trusted: 0,
    failed: 0,
    filtered: 0,
    bodyUnavailable: 0,
    error: null
  };
}

function metricFor(metrics, name) {
  if (!metrics[name]) {
    metrics[name] = createSourceMetric(name);
  }
  return metrics[name];
}

function candidateDedupeKey(entry) {
  return [
    entry.keyword?.id || 'hot',
    entry.item?.url || '',
    entry.item?.title || ''
  ].join('::').toLowerCase();
}

function candidatePriority(entry) {
  const item = entry?.item || {};
  const sourceType = item.sourceType || entry?.source?.name || '';
  return SOURCE_PRIORITY[sourceType] || 99;
}

function prioritizeCandidateEntries(left, right) {
  const priorityDiff = candidatePriority(left) - candidatePriority(right);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return compareSearchItems(left.item, right.item);
}

export function selectEntriesForAnalysis(entries, limit, mode) {
  const selected = [];
  let twitterProcessed = 0;
  let otherProcessed = 0;
  const totalLimit = analysisQuotaLimit(limit);

  for (const entry of entries) {
    const sourceType = entry.item?.sourceType || entry.source?.name || '';
    if (sourceType === 'twitter') {
      if (twitterProcessed >= TWITTER_ANALYSIS_QUOTA) continue;
      twitterProcessed += 1;
    } else {
      if (otherProcessed >= OTHER_ANALYSIS_QUOTA) continue;
      otherProcessed += 1;
    }

    selected.push(entry);
    if (selected.length >= totalLimit) {
      break;
    }
  }

  return selected;
}

function compactProgressItem({ source, keyword, item }) {
  return {
    title: String(item?.title || '').slice(0, 120),
    sourceType: item?.sourceType || source?.name || '',
    keyword: keyword?.term || ''
  };
}

async function collectSourceCandidates({ source, settings, keyword = null, expandedKeywords = [], sourceStats, sourceMetrics }) {
  const metric = metricFor(sourceMetrics, source.name);
  try {
    const rawItems = await source.runner({
      keyword: keyword?.term || null,
      scope: settings.scope
    });
    const sourceItems = Array.isArray(rawItems) ? rawItems : [];
    metric.collected += sourceItems.length;
    for (const item of sourceItems) {
      sourceStats[item.sourceType || source.name] = (sourceStats[item.sourceType || source.name] || 0) + 1;
    }
    if (source.applyDelay) {
      await sleep(randomDelay());
    }
    return sourceItems
      .filter((item) => item?.title && item?.url && keyword?.id)
      .map((item) => ({ source, keyword, expandedKeywords, item }));
  } catch (error) {
    metric.error ||= error;
    console.error(`[collection:${source.name}]`, error.message);
    if (source.applyDelay) {
      await sleep(randomDelay());
    }
    return [];
  }
}

async function runLimited(entries, limit, worker) {
  const queue = [...entries];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      await worker(entry);
    }
  });
  await Promise.all(workers);
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

function buildSearchPreMatch(text, expandedKeywords) {
  return preMatchKeyword(text, expandedKeywords);
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
      const result = await processCandidateByRelevance({
        item,
        keyword,
        settings,
        expandedKeywords: expansionListForKeyword(keyword.term, [])
      });
      const projected = projectEvent(result.event);
      counters.aiReviewedCount += result.aiCallCount || 0;
      if (result.aiFailed) {
        counters.analysisErrorCount += 1;
        counters.analysisErrorMessage ||= result.aiError || 'AI 分析失败';
      }
      if (result.fullTextFetched) counters.fullTextFetchedCount += 1;
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
      console.error('[relevance-filter] 热点相关度处理失败', error.message);
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

function buildCollectionWarning({ createdCount, counters }) {
  const warnings = [];

  if (counters.analysisErrorCount) {
    const reason = counters.analysisErrorMessage || 'AI 分析服务异常';
    if (!createdCount && counters.processedCount > 0) {
        warnings.push(`本轮已抓取 ${counters.processedCount} 条候选内容，但相关度处理异常（${reason}），部分结果未展示。`);
      } else {
      warnings.push(`本轮有 ${counters.analysisErrorCount} 条候选内容在相关度处理阶段失败（${reason}），已跳过展示。`);
    }
  }

  if (counters.hitAnalysisLimit) {
    warnings.push(`为避免长时间等待，本轮每个关键词最多处理 ${counters.analysisLimit || env.aiAnalysisMaxItemsPerRun} 条候选内容。`);
  }

  if (counters.skipAiForCurrentRun) {
    warnings.push('本轮相关度处理连续失败已触发熔断，剩余候选已跳过展示。');
  }

  return warnings.join(' ');
}

export async function runCollection({ trigger = 'manual' } = {}) {
  const settings = await ensureSettings();
  const aiProvider = settings.aiProvider || 'openrouter';
  const scanBudget = getScanBudget(trigger);
  const analysisLimit = analysisQuotaLimit(scanBudget.maxItems);
  setCollectionProgress({
    phase: 'loading',
    mode: scanBudget.mode,
    analysisLimit,
    concurrency: scanBudget.concurrency
  });
  const keywords = await prisma.keyword.findMany({
    where: {
      enabled: true
    },
    orderBy: {
      createdAt: 'asc'
    }
  });
  const keywordExpansions = await resolveKeywordExpansions({ keywords, settings });
  const keywordExpansionMap = new Map(keywordExpansions.map((item) => [String(item.keyword).toLowerCase(), item.expandedKeywords]));
  setCollectionProgress({
    keywordExpansions
  });

  const keywordSources = getEnabledKeywordSources(settings);
  const hotSources = HOT_SOURCE_CONFIGS.filter((source) => settings[source.enabledKey] !== false);
  const createdItems = [];
  const sourceMetrics = {};
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
    updatedEventCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    analysisLimit,
    candidateCount: 0
  };
  const sourceStats = buildSourceStats();
  let totalCollectedCount = 0;

  for (const keyword of keywords) {
    const expandedKeywords =
      keywordExpansionMap.get(String(keyword.term).toLowerCase()) ||
      expansionListForKeyword(keyword.term, keywordExpansions);
    const keywordCandidateEntries = [];

    for (const source of keywordSources) {
      setCollectionProgress({
        phase: 'collecting',
        currentSource: source.name,
        currentKeyword: keyword.term,
        collectedCount: totalCollectedCount + keywordCandidateEntries.length,
        candidateCount: counters.candidateCount
      });
      const collectedEntries = await collectSourceCandidates({
        source,
        settings,
        keyword,
        expandedKeywords,
        sourceStats,
        sourceMetrics
      });
      keywordCandidateEntries.push(...collectedEntries);
      setCollectionProgress({
        phase: 'collecting',
        currentSource: source.name,
        currentKeyword: keyword.term,
        collectedCount: totalCollectedCount + keywordCandidateEntries.length,
        candidateCount: counters.candidateCount
      });
    }

    totalCollectedCount += keywordCandidateEntries.length;
    const dedupedEntries = Array.from(
      keywordCandidateEntries.reduce((map, entry) => {
        const key = candidateDedupeKey(entry);
        if (!key || map.has(key)) {
          counters.duplicateCount += 1;
          return map;
        }
        map.set(key, entry);
        return map;
      }, new Map()).values()
    ).sort(prioritizeCandidateEntries);
    counters.candidateCount += dedupedEntries.length;
    const entriesForAnalysis = selectEntriesForAnalysis(dedupedEntries, analysisLimit, scanBudget.mode);
    if (dedupedEntries.length > entriesForAnalysis.length) {
      counters.hitAnalysisLimit = true;
    }
    counters.pendingAnalysisCount += Math.max(0, dedupedEntries.length - entriesForAnalysis.length);

    const activeItems = new Map();
    let workId = 0;
    let keywordStartedCount = 0;
    let keywordCompletedCount = 0;
    setCollectionProgress({
      phase: 'verifying',
      currentSource: null,
      currentKeyword: keyword.term,
      collectedCount: totalCollectedCount,
      candidateCount: counters.candidateCount,
      analysisLimit,
      totalToProcess: entriesForAnalysis.length,
      startedCount: 0,
      completedCount: keywordCompletedCount,
      acceptedCount: counters.acceptedCount,
      rejectedCount: counters.rejectedCount,
      remainingCount: entriesForAnalysis.length,
      activeCount: 0,
      currentItems: []
    });

    await runLimited(entriesForAnalysis, scanBudget.concurrency, async ({ source, keyword: entryKeyword, expandedKeywords: entryExpandedKeywords, item }) => {
      const currentWorkId = ++workId;
      const metric = metricFor(sourceMetrics, source.name);
      counters.processedCount += 1;
      keywordStartedCount += 1;
      metric.processed += 1;
      activeItems.set(currentWorkId, compactProgressItem({ source, keyword: entryKeyword, item }));
      setCollectionProgress({
        phase: 'verifying',
        currentKeyword: entryKeyword?.term || keyword.term,
        startedCount: keywordStartedCount,
        completedCount: keywordCompletedCount,
        acceptedCount: counters.acceptedCount,
        rejectedCount: counters.rejectedCount,
        remainingCount: Math.max(0, entriesForAnalysis.length - keywordCompletedCount - activeItems.size),
        activeCount: activeItems.size,
        currentItems: Array.from(activeItems.values())
      });

      try {
        const result = await processCandidateByRelevance({
          item,
          keyword: entryKeyword,
          settings,
          expandedKeywords: entryExpandedKeywords
        });
        const projected = projectEvent(result.event);
        counters.aiReviewedCount += result.aiCallCount || 0;
        if (result.aiFailed) {
          counters.analysisErrorCount += 1;
          counters.analysisErrorMessage ||= result.aiError || 'AI 分析失败';
        }
        if (result.fullTextFetched) counters.fullTextFetchedCount += 1;
        if (result.bodyUnavailable) metric.bodyUnavailable += 1;
        if (result.verificationFailed) {
          counters.verificationFailedCount += 1;
          metric.filtered += 1;
        }
        if (result.accepted && result.event.verificationStatus === 'trusted') {
          counters.acceptedCount += 1;
          counters.trustedCount += 1;
          metric.trusted += 1;
        } else {
          counters.rejectedCount += 1;
        }
        if (result.created) counters.createdEventCount += 1;
        else counters.updatedEventCount += 1;

        if (result.accepted && result.event.verificationStatus === 'trusted') {
          const existingIndex = createdItems.findIndex((entry) => entry.id === projected.id);
          if (existingIndex >= 0) createdItems[existingIndex] = projected;
          else createdItems.push(projected);
          socketHub.broadcast('scan:item', {
            ...projected,
            scannedAt: new Date().toISOString(),
            scanIsNew: result.created
          });
        }

        if (result.accepted && result.event.verificationStatus === 'trusted') {
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
        metric.failed += 1;
        metric.filtered += 1;
        console.error('[deep-verification] 热点深度核验失败', error.message);
      } finally {
        activeItems.delete(currentWorkId);
        keywordCompletedCount += 1;
        setCollectionProgress({
          phase: 'verifying',
          currentKeyword: entryKeyword?.term || keyword.term,
          startedCount: keywordStartedCount,
          completedCount: keywordCompletedCount,
          acceptedCount: counters.acceptedCount,
          rejectedCount: counters.rejectedCount,
          remainingCount: Math.max(0, entriesForAnalysis.length - keywordCompletedCount - activeItems.size),
          activeCount: activeItems.size,
          currentItems: Array.from(activeItems.values())
        });
      }
    });
  }

  for (const source of [...keywordSources, ...hotSources]) {
    const metric = metricFor(sourceMetrics, source.name);
    await recordSourceHealth({
      sourceType: source.name,
      startedAt: metric.startedAt,
      candidateCount: metric.collected,
      filteredCount: metric.filtered,
      error: metric.error && metric.collected === 0 ? metric.error : null
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
      analysisMode: scanBudget.mode,
      analysisLimit,
      analysisConcurrency: scanBudget.concurrency,
      candidateCount: 0,
      message: '暂无启用中的关键词，且热榜源均已停用',
      warning: buildCollectionWarning({ createdCount: 0, counters }),
      createdCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      processedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
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
      keywordExpansions,
      sourceStats,
      sourceMetrics,
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
    analysisMode: scanBudget.mode,
    analysisLimit,
    analysisConcurrency: scanBudget.concurrency,
    candidateCount: counters.candidateCount,
    message,
    warning,
    createdCount: createdItems.length,
    duplicateCount: counters.duplicateCount,
    skippedCount: counters.skippedCount,
    processedCount: counters.processedCount,
    acceptedCount: counters.acceptedCount,
    rejectedCount: counters.rejectedCount,
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
    keywordExpansions,
    sourceStats,
    sourceMetrics,
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
  const [keywordExpansion] = await resolveKeywordExpansions({
    keywords: [{ term: trimmedQuery }],
    settings
  });
  const expandedKeywords = keywordExpansion?.expandedKeywords || expansionListForKeyword(trimmedQuery, []);
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
    .sort((left, right) => prioritizeCandidateEntries({ item: left }, { item: right }))
    .slice(0, 10);

  const analyzedResults = await Promise.all(
    dedupedResults.map(async (item) => {
      const fullText = `${item.title || ''}\n${item.snippet || ''}`.trim();
      const preMatchResult = buildSearchPreMatch(fullText, expandedKeywords);
      const analysis = await analyzeContent(fullText, trimmedQuery, preMatchResult, settings);
      const decision = calculateRelevanceDecision({
        analysis,
        preMatchResult,
        article: {
          title: item.title,
          snippet: item.snippet,
          bodyText: ''
        },
        expandedKeywords
      });
      const heatScore = calculateHeatScore(item);
      return {
        ...item,
        matchedKeywords: decision.matchedKeywords,
        relevanceReason: decision.relevanceReason,
        keywordMentioned: decision.keywordMentioned,
        aiRelevance: decision.relevanceScore,
        aiImportance: decision.importance,
        aiSummary: decision.summary,
        heatScore,
        heatLabel: getHeatLabel(heatScore),
        accepted: decision.accepted
      };
    })
  );

  const visibleResults = analyzedResults
    .filter((item) => item.accepted)
    .sort((left, right) => {
      const heatDiff = Number(right.heatScore || 0) - Number(left.heatScore || 0);
      if (heatDiff !== 0) return heatDiff;
      const relevanceDiff = Number(right.aiRelevance || 0) - Number(left.aiRelevance || 0);
      if (relevanceDiff !== 0) return relevanceDiff;
      return compareSearchItems(left, right);
    });

  return {
    items: visibleResults,
    meta: {
      query: trimmedQuery,
      total: visibleResults.length,
      expandedKeywords,
      enabledSources: enabledSources.map((source) => source.name),
      sourceStats,
      searchedAt: new Date().toISOString()
    }
  };
}
