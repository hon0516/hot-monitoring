<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <section class="glass-card rounded-[10px] px-4 py-4">
      <div class="flex flex-col gap-3">
        <!-- <div>
          <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">搜索模块</p>
          <h2 class="mt-1.5 font-display text-lg text-white">跨渠道即时搜索</h2>
          <p class="mt-1 text-sm text-slate-400">
            输入搜索词后，系统会直接从已启用的搜索渠道抓取结果并立即展示，不经过 AI 真假判定。
          </p>
        </div> -->

        <div class="flex flex-col gap-3 lg:flex-row">
          <el-input
            v-model="query"
            size="large"
            clearable
            placeholder="输入你要搜索的热点关键词，比如 AI编程 / Codex / OpenAI"
            @keyup.enter="runSearch"
          />
          <el-button
            class="w-full lg:w-[140px]"
            type="primary"
            size="large"
            :loading="store.searchPanel.loading"
            @click="runSearch"
          >
            {{ store.searchPanel.loading ? '搜索中...' : '搜索' }}
          </el-button>
        </div>

        <!-- <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span class="rounded-[5px] border border-cyan/15 bg-cyan/[0.04] px-2.5 py-1">
            已启用渠道 {{ enabledSourceCount }} 个
          </span>
          <span v-if="store.searchPanel.meta.searchedAt" class="rounded-[5px] border border-white/8 bg-white/[0.02] px-2.5 py-1">
            最近搜索 {{ formatRelativeTime(store.searchPanel.meta.searchedAt) }}
          </span>
          <span v-if="store.searchPanel.query" class="rounded-[5px] border border-white/8 bg-white/[0.02] px-2.5 py-1">
            当前搜索 {{ store.searchPanel.query }}
          </span>
        </div> -->
      </div>
    </section>

    <HotspotFeed
      :items="filteredItems"
      :show-header="false"
      mode="search"
      empty-description="还没有搜索结果"
      empty-hint="输入搜索词并点击搜索后，这里会直接展示来自已启用搜索渠道的实时结果。"
    >
      <template #actions>
        <el-tag class="hotspot-chip" round effect="plain">{{ filteredItems.length }} / {{ store.searchPanel.meta.total }} 条结果</el-tag>
      </template>
      <template #toolbar>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="tab in sourceTabs"
            :key="tab.key"
            type="button"
            class="hotspot-toolbar__tab"
            :class="{ 'is-active': activeSourceTab === tab.key }"
            @click="activeSourceTab = tab.key"
          >
            <span class="hotspot-toolbar__tab-label">{{ tab.label }}</span>
            <span class="hotspot-toolbar__tab-count">{{ tab.count }}</span>
          </button>
        </div>
      </template>
    </HotspotFeed>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import HotspotFeed from '../components/HotspotFeed.vue';
import { useMonitorStore } from '../stores/monitor';

const sourceLabels = {
  all: '全部',
  bing: '必应',
  'google-news': '谷歌资讯',
  'hacker-news': 'Hacker News',
  twitter: '推特 / X',
  bilibili: '哔哩哔哩',
  weibo: '微博搜索',
  sogou: '搜狗搜索'
};

const store = useMonitorStore();
const query = ref(store.searchPanel.query || '');
const activeSourceTab = ref('all');

const enabledSourceCount = computed(() => {
  if (store.searchPanel.meta.enabledSources.length) {
    return store.searchPanel.meta.enabledSources.length;
  }

  if (!store.settings) {
    return 0;
  }

  return [
    store.settings.bingSourceEnabled,
    store.settings.googleNewsSourceEnabled,
    store.settings.hackerNewsSourceEnabled,
    store.settings.twitterSourceEnabled,
    store.settings.bilibiliSourceEnabled,
    store.settings.weiboSourceEnabled,
    store.settings.sogouSourceEnabled
  ].filter(Boolean).length;
});

const sourceTabCounts = computed(() => {
  const counts = {
    all: store.searchPanel.items.length,
    bing: 0,
    'google-news': 0,
    'hacker-news': 0,
    twitter: 0,
    bilibili: 0,
    weibo: 0,
    sogou: 0
  };

  for (const item of store.searchPanel.items) {
    if (item?.sourceType in counts) {
      counts[item.sourceType] += 1;
    }
  }

  return counts;
});

const sourceTabs = computed(() =>
  Object.entries(sourceLabels).map(([key, label]) => ({
    key,
    label,
    count: sourceTabCounts.value[key] || 0
  }))
);

const filteredItems = computed(() =>
  activeSourceTab.value === 'all'
    ? store.searchPanel.items
    : store.searchPanel.items.filter((item) => item.sourceType === activeSourceTab.value)
);

async function runSearch() {
  try {
    await store.searchAcrossSources(query.value);
    activeSourceTab.value = 'all';
  } catch (error) {
    ElMessage.error(error.message || '搜索失败');
  }
}

function formatRelativeTime(value) {
  if (!value) return '刚刚';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60)));
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}
</script>
