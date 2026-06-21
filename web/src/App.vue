<template>
  <AppFrame
    :socket-state="store.socketState"
    :live-message="store.liveMessage"
    :loading="store.loading"
    :scan-status="store.scanStatus"
    :latest-scan-inbox="store.latestScanInbox"
    @run-search="store.runSearch"
    @read-latest-scan-item="store.markLatestScanInboxItemRead"
  >
    <RouterView />
  </AppFrame>
</template>

<script setup>
import { h, onBeforeUnmount, onMounted, watch } from 'vue';
import { ElNotification } from 'element-plus';
import AppFrame from './components/AppFrame.vue';
import { useMonitorStore } from './stores/monitor';

const store = useMonitorStore();
const NOTIFICATION_BATCH_MS = 2500;
const MAX_BATCH_TITLES = 3;

let activeNotification = null;
let batchTimer = null;
let pendingScanToasts = [];

const scanTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function formatScanTime(value) {
  if (!value) {
    return '刚刚';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '刚刚' : scanTimeFormatter.format(date);
}

function notificationLine(label, value, emphasize = false) {
  return h(
    'div',
    { class: 'scan-item-notification__row' },
    [
      h('span', { class: 'scan-item-notification__label' }, label),
      h(
        'span',
        { class: emphasize ? 'scan-item-notification__value scan-item-notification__value--title' : 'scan-item-notification__value' },
        value
      )
    ]
  );
}

function uniqueKeywords(toasts) {
  return [
    ...new Set(
      toasts
        .flatMap((toast) => (Array.isArray(toast?.keywords) ? toast.keywords : []))
        .map((keyword) => String(keyword || '').trim())
        .filter(Boolean)
    )
  ];
}

function flushScanToastBatch() {
  if (!pendingScanToasts.length) {
    batchTimer = null;
    return;
  }

  const batch = pendingScanToasts;
  pendingScanToasts = [];
  batchTimer = null;

  const latestToast = batch[batch.length - 1];
  const keywords = uniqueKeywords(batch);
  const titles = batch.map((toast) => toast.title || '未命名热点').filter(Boolean);

  const messageBody =
    batch.length === 1
      ? [
          notificationLine('扫描时间', formatScanTime(latestToast.scannedAt)),
          notificationLine('标题', latestToast.title || '未命名热点', true),
          notificationLine('监控关键词', keywords.length ? keywords.join(' / ') : '未关联关键词')
        ]
      : [
          notificationLine('扫描时间', formatScanTime(latestToast.scannedAt)),
          notificationLine('新热点数量', `共发现 ${batch.length} 条`, true),
          h(
            'div',
            { class: 'scan-item-notification__row' },
            [
              h('span', { class: 'scan-item-notification__label' }, '热点标题'),
              h(
                'div',
                { class: 'scan-item-notification__list' },
                titles.slice(0, MAX_BATCH_TITLES).map((title) => h('div', { class: 'scan-item-notification__list-item' }, title))
              ),
              batch.length > MAX_BATCH_TITLES
                ? h('span', { class: 'scan-item-notification__more' }, `还有 ${batch.length - MAX_BATCH_TITLES} 条未展开`)
                : null
            ].filter(Boolean)
          ),
          notificationLine('监控关键词', keywords.length ? keywords.join(' / ') : '未关联关键词')
        ];

  activeNotification?.close?.();
  activeNotification = ElNotification({
    title: batch.length === 1 ? '新热点提醒' : '新热点批量提醒',
    position: 'bottom-right',
    duration: 8000,
    customClass: 'scan-item-notification',
    message: h('div', { class: 'scan-item-notification__body' }, messageBody)
  });
}

function enqueueScanToast(toast) {
  pendingScanToasts.push(toast);
  if (batchTimer) {
    return;
  }

  batchTimer = window.setTimeout(() => {
    flushScanToastBatch();
  }, NOTIFICATION_BATCH_MS);
}

onMounted(() => {
  store.bootstrap();
});

onBeforeUnmount(() => {
  if (batchTimer) {
    window.clearTimeout(batchTimer);
    batchTimer = null;
  }
  activeNotification?.close?.();
  activeNotification = null;
  pendingScanToasts = [];
});

watch(
  () => store.latestScanToast?.id,
  () => {
    const toast = store.latestScanToast;
    if (!toast) {
      return;
    }

    enqueueScanToast(toast);
  }
);
</script>
