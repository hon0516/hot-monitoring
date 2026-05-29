import { prisma } from '../db/prisma.js';
import { analyzeHotspot, sanitizeEvidenceText } from './aiService.js';
import { dispatchNotifications } from './notificationService.js';
import { ensureSettings } from './settingsService.js';
import { searchBing } from '../sources/bingSource.js';
import { searchGoogleNews } from '../sources/googleNewsSource.js';
import { searchHackerNews } from '../sources/hackerNewsSource.js';
import { searchTwitter } from '../sources/twitterSource.js';
import { searchBilibili } from '../sources/bilibiliSource.js';
import { searchWeibo } from '../sources/weiboSource.js';
import { searchSogou } from '../sources/sogouSource.js';
import { buildDedupeFields, meetsNotificationThreshold } from '../utils/normalize.js';
import { randomDelay, sleep } from '../utils/delay.js';
import { socketHub } from '../ws/socketHub.js';
import { env } from '../config/env.js';

const HOTSPOT_MAX_AGE_DAYS = 30;

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

const hotspotOrderBy = [{ discoveredAt: 'desc' }, { aiRelevance: 'desc' }];

export async function listHotspots(filters) {
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(filters.pageSize || '12', 10) || 12));

  const where = {
    AND: [
      getHotspotFreshnessWhere(),
      {
        sourceType: filters.sourceType || undefined,
        aiImportance: filters.importance || undefined,
        aiIsReal: filters.onlyReal === 'true' ? true : undefined,
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

  const [items, total] = await Promise.all([
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
    prisma.hotspot.count({ where })
  ]);

  return {
    items: items.map(sanitizeHotspot),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

function sanitizeHotspot(hotspot) {
  if (!hotspot) {
    return hotspot;
  }

  return {
    ...hotspot,
    aiEvidence: sanitizeEvidenceText(hotspot.aiEvidence, { publishedAt: hotspot.sourcePublishedAt })
  };
}

export async function getHotspotById(id) {
  return hydrateHotspot(id);
}

async function createHotspotRecord({ item, keyword, analysis }) {
  const { canonicalUrl, titleNormalized, dedupeKey } = buildDedupeFields(item);
  const existing = await findDuplicate({ canonicalUrl, titleNormalized });

  if (existing) {
    await ensureHotspotKeyword(existing.id, keyword?.id);
    if (
      analysis &&
      (existing.aiImportance === null ||
        existing.aiRelevance === null ||
        existing.aiSummary === null ||
        existing.aiEvidence === null)
    ) {
      await prisma.hotspot.update({
        where: { id: existing.id },
        data: {
          aiIsReal: analysis.isReal,
          aiRelevance: analysis.relevance,
          aiImportance: analysis.importance,
          aiSummary: analysis.summary,
          aiEvidence: analysis.evidence
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
      aiSummary: analysis?.summary ?? null,
      aiEvidence: analysis?.evidence ?? null,
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

  try {
    sourceItems = await source.runner({
      keyword: keyword?.term || null,
      scope: settings.scope
    });
  } catch (error) {
    console.error(`[collection:${source.name}]`, error.message);
    if (source.applyDelay) {
      await sleep(randomDelay());
    }
    return;
  }

  sourceStats[source.name] = (sourceStats[source.name] || 0) + sourceItems.length;

  for (const item of sourceItems) {
    if (counters.processedCount >= env.aiAnalysisMaxItemsPerRun) {
      counters.hitAnalysisLimit = true;
      break;
    }

    counters.processedCount += 1;
    let analysis = null;

    if (!counters.skipAiForCurrentRun) {
      try {
        analysis = await analyzeHotspot({
          settings,
          scope: settings.scope,
          keyword: keyword?.term || null,
          item
        });
        counters.analysisConsecutiveFailures = 0;
      } catch (error) {
        counters.analysisErrorCount += 1;
        counters.analysisConsecutiveFailures += 1;
        counters.analysisErrorMessage ||= error.message;
        console.error('[analysis] 热点分析失败', error.message);

        const isRateLimitOrTimeout =
          /429|超时|timeout|rate limit|too many requests/iu.test(String(error?.message || ''));
        if (isRateLimitOrTimeout && counters.analysisConsecutiveFailures >= 3) {
          counters.skipAiForCurrentRun = true;
          console.error('[analysis] 本轮已触发 AI 熔断，后续候选将跳过 AI 分析并以待复核入库');
        }
      }
    }

    const { hotspot, created, pendingAnalysis } = await createHotspotRecord({
      item,
      keyword,
      analysis
    });

    if (!hotspot) {
      counters.skippedCount += 1;
      continue;
    }

    if (!created) {
      counters.duplicateCount += 1;
      continue;
    }

    createdItems.push(hotspot);
    if (pendingAnalysis) {
      counters.pendingAnalysisCount += 1;
      continue;
    }

    if (meetsNotificationThreshold(hotspot, settings)) {
      await dispatchNotifications({
        hotspot,
        settings,
        trigger
      });
    } else if (settings.websocketEnabled && trigger !== 'manual') {
      socketHub.broadcast('hotspot:new', hotspot);
    }
  }

  if (source.applyDelay) {
    await sleep(randomDelay());
  }
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

  const keywordSources = KEYWORD_SOURCE_CONFIGS.filter((source) => settings[source.enabledKey] !== false);
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
    skipAiForCurrentRun: false
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
    sourceStats,
    items: createdItems
  };
}
