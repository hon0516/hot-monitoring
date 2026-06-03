<template>
  <el-scrollbar class="page-scroll h-full">
    <div class="flex min-h-full flex-col gap-4 pr-1">
      <MetricStrip :metrics="metrics" />
      <SourceCoverage :stats="store.lastSourceStats" :items="store.hotspots" />

      <section class="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_380px]">
        <HotspotFeed :items="store.hotspots.slice(0, 6)" title="高频信号流" />

        <div class="space-y-6">
          <section class="glass-card rounded-[10px] p-5">
            <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">系统脉冲</p>
            <h3 class="mt-2 font-display text-xl text-white">运行态势</h3>
            <div class="mt-6 space-y-4">
              <div class="rounded-[10px] border border-white/5 bg-white/[0.03] p-4">
                <p class="text-sm text-slate-400">最近一次发现时间</p>
                <p class="mt-2 font-display text-2xl text-cyan">{{ latestTime }}</p>
              </div>
              <div class="rounded-[10px] border border-white/5 bg-white/[0.03] p-4">
                <p class="text-sm text-slate-400">配置状态</p>
                <p class="mt-2 text-sm leading-7 text-slate-200">
                  {{ aiProviderTag }} / 推特 {{ twitterTag }} / SMTP {{ readyTag(store.settings?.hasSmtpConfig) }}
                </p>
              </div>
            </div>
          </section>

          <NotificationRail :items="store.notifications.slice(0, 6)" />
        </div>
      </section>
    </div>
  </el-scrollbar>
</template>

<script setup>
import { computed } from 'vue';
import { useMonitorStore } from '../stores/monitor';
import MetricStrip from '../components/MetricStrip.vue';
import HotspotFeed from '../components/HotspotFeed.vue';
import NotificationRail from '../components/NotificationRail.vue';
import SourceCoverage from '../components/SourceCoverage.vue';

const store = useMonitorStore();

const metrics = computed(() => [
  {
    label: '热点总数',
    value: store.summary.totalHotspots,
    help: '累积采集热点'
  },
  {
    label: '真实热点',
    value: store.summary.verifiedHotspots,
    help: 'AI 判定为真实'
  },
  {
    label: '高优先级',
    value: store.summary.urgentHotspots,
    help: '高优先级热点'
  },
  {
    label: '启用关键词',
    value: store.summary.activeKeywords,
    help: '当前启用关键词'
  }
]);

const latestTime = computed(() =>
  store.summary.latestDiscoveredAt ? new Date(store.summary.latestDiscoveredAt).toLocaleString('zh-CN') : '尚未捕获'
);

const aiProviderTag = computed(() => {
  const providerLabel = store.settings?.aiProviderLabel || 'AI';
  return `${providerLabel} ${readyTag(store.settings?.aiProviderAvailable)}`;
});

const twitterTag = computed(() => {
  if (!store.settings?.hasTwitterApiKey) {
    return '缺失';
  }

  if (!store.settings.twitterSourceRuntimeEnabled) {
    return '环境已暂停';
  }

  return store.settings.twitterSourceEnabled ? '已就绪' : '已停用';
});

function readyTag(flag) {
  return flag ? '已就绪' : '缺失';
}
</script>
