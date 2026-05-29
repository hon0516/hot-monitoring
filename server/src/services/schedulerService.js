import cron from 'node-cron';
import { triggerCollection } from './hotspotService.js';

const ALLOWED_SCAN_INTERVALS = [5, 10, 15, 30, 60];

let collectionTask = null;
let currentScanIntervalMinutes = 30;

export function normalizeScanIntervalMinutes(value) {
  const parsed = Number.parseInt(String(value), 10);
  return ALLOWED_SCAN_INTERVALS.includes(parsed) ? parsed : 30;
}

function toCronExpression(intervalMinutes) {
  if (intervalMinutes === 60) {
    return '0 * * * *';
  }

  return `*/${intervalMinutes} * * * *`;
}

function scheduleCollectionTask(intervalMinutes) {
  const normalizedInterval = normalizeScanIntervalMinutes(intervalMinutes);
  const expression = toCronExpression(normalizedInterval);

  collectionTask = cron.schedule(expression, async () => {
    try {
      await triggerCollection({ trigger: 'cron' });
    } catch (error) {
      console.error('[cron] 热点采集失败', error);
    }
  });

  currentScanIntervalMinutes = normalizedInterval;
  return normalizedInterval;
}

export function startCollectionScheduler(intervalMinutes) {
  stopCollectionScheduler();
  return scheduleCollectionTask(intervalMinutes);
}

export function rescheduleCollectionScheduler(intervalMinutes) {
  return startCollectionScheduler(intervalMinutes);
}

export function stopCollectionScheduler() {
  if (!collectionTask) {
    return;
  }

  collectionTask.stop();
  collectionTask.destroy();
  collectionTask = null;
}

export function getCollectionSchedulerState() {
  return {
    currentScanIntervalMinutes
  };
}

export { ALLOWED_SCAN_INTERVALS };
