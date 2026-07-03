import { prisma } from '../db/prisma.js';
import { configState } from '../config/env.js';
import { getAiProviderRuntimeStatus, normalizeAiProvider } from './aiService.js';
import {
  ALLOWED_SCAN_INTERVALS,
  getCollectionSchedulerState,
  normalizeScanIntervalMinutes,
  rescheduleCollectionScheduler
} from './schedulerService.js';

export async function ensureSettings() {
  const existing = await prisma.setting.findFirst({
    orderBy: { id: 'asc' }
  });

  if (existing) {
    return existing;
  }

  return prisma.setting.create({
    data: {}
  });
}

export async function getSettingsWithState() {
  const settings = await ensureSettings();
  const aiRuntime = getAiProviderRuntimeStatus(settings.aiProvider);
  const schedulerState = getCollectionSchedulerState();

  return {
    ...settings,
    ...configState,
    aiProvider: normalizeAiProvider(settings.aiProvider),
    scanIntervalMinutes: normalizeScanIntervalMinutes(settings.scanIntervalMinutes),
    allowedScanIntervals: ALLOWED_SCAN_INTERVALS,
    aiProviderLabel: aiRuntime.label,
    aiProviderAvailable: aiRuntime.available,
    schedulerIntervalMinutes: schedulerState.currentScanIntervalMinutes,
    schedulerEnabled: schedulerState.enabled
  };
}

export async function updateSettings(payload) {
  const current = await ensureSettings();

  const data = {};
  if (typeof payload.scope === 'string') data.scope = payload.scope.trim();
  if (typeof payload.aiProvider === 'string') {
    const aiProvider = String(payload.aiProvider).trim().toLowerCase();
    if (!['tencent-tokenhub', 'openrouter'].includes(aiProvider)) {
      throw new Error('AI 提供方仅支持 tencent-tokenhub 或 openrouter');
    }
    data.aiProvider = aiProvider;
  }
  if (payload.scanIntervalMinutes !== undefined) {
    const parsedScanIntervalMinutes = Number.parseInt(String(payload.scanIntervalMinutes), 10);
    if (!ALLOWED_SCAN_INTERVALS.includes(parsedScanIntervalMinutes)) {
      throw new Error(`扫描频率仅支持 ${ALLOWED_SCAN_INTERVALS.join('/')} 分钟`);
    }
    data.scanIntervalMinutes = normalizeScanIntervalMinutes(parsedScanIntervalMinutes);
  }
  if (typeof payload.autoScanEnabled === 'boolean') data.autoScanEnabled = payload.autoScanEnabled;
  if (typeof payload.emailEnabled === 'boolean') data.emailEnabled = payload.emailEnabled;
  if (typeof payload.websocketEnabled === 'boolean') data.websocketEnabled = payload.websocketEnabled;
  if (typeof payload.recipientEmail === 'string') data.recipientEmail = payload.recipientEmail.trim() || null;
  if (typeof payload.relevanceThreshold === 'number') data.relevanceThreshold = Math.min(100, Math.max(0, payload.relevanceThreshold));
  if (typeof payload.importanceThreshold === 'string') data.importanceThreshold = payload.importanceThreshold.toLowerCase();
  if (typeof payload.bingSourceEnabled === 'boolean') data.bingSourceEnabled = payload.bingSourceEnabled;
  if (typeof payload.googleNewsSourceEnabled === 'boolean') data.googleNewsSourceEnabled = payload.googleNewsSourceEnabled;
  if (typeof payload.hackerNewsSourceEnabled === 'boolean') data.hackerNewsSourceEnabled = payload.hackerNewsSourceEnabled;
  if (typeof payload.twitterSourceEnabled === 'boolean') data.twitterSourceEnabled = payload.twitterSourceEnabled;
  if (typeof payload.bilibiliSourceEnabled === 'boolean') data.bilibiliSourceEnabled = payload.bilibiliSourceEnabled;
  if (typeof payload.weiboSourceEnabled === 'boolean') data.weiboSourceEnabled = payload.weiboSourceEnabled;
  if (typeof payload.sogouSourceEnabled === 'boolean') data.sogouSourceEnabled = payload.sogouSourceEnabled;
  await prisma.setting.update({
    where: { id: current.id },
    data
  });

  const nextSettings = await ensureSettings();
  rescheduleCollectionScheduler(nextSettings.scanIntervalMinutes, nextSettings.autoScanEnabled);
  return getSettingsWithState();
}
