<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <HotspotFeed :items="sortedHotspots" :show-header="false" @feedback-saved="applyFilters">
      <template #actions>
        <div class="flex items-center gap-2">
          <el-tag class="hotspot-chip" round effect="plain">{{ store.pagination.total }} 条记录</el-tag>
        </div>
      </template>
      <template #toolbar>
        <div ref="toolbarRoot" class="hotspot-toolbar">
          <button
            v-if="toolbarOpen"
            type="button"
            class="hotspot-toolbar__scrim"
            aria-label="关闭筛选与排序"
            @click="toolbarOpen = false"
          />
          <div class="hotspot-toolbar__tabs">
            <button
              v-for="tab in sourceTabs"
              :key="tab.key"
              type="button"
              class="hotspot-toolbar__tab"
              :class="{ 'is-active': activeSourceTab === tab.key }"
              @click="selectSourceTab(tab.key)"
            >
              <span class="hotspot-toolbar__tab-label">{{ tab.label }}</span>
              <span class="hotspot-toolbar__tab-count">{{ tab.count }}</span>
            </button>
          </div>

          <div class="hotspot-toolbar__dock">
            <button
              type="button"
              class="hotspot-toolbar__trigger"
              :class="{ 'is-active': toolbarOpen }"
              @click="toolbarOpen = !toolbarOpen"
            >
              <span class="hotspot-toolbar__trigger-icon" aria-hidden="true">
                <el-icon><Filter /></el-icon>
              </span>
              <span class="hotspot-toolbar__trigger-copy">筛选与排序</span>
              <span v-if="activeControlCount" class="hotspot-toolbar__trigger-count">{{ activeControlCount }}</span>
            </button>
          </div>

          <Transition name="hotspot-toolbar-panel">
            <section v-if="toolbarOpen" class="hotspot-filterbar hotspot-toolbar__panel">
              <div class="hotspot-filterbar__topline">
                <div class="hotspot-toolbar__panel-meta">
                  <span class="hotspot-toolbar__meta-pill">{{ activeFilterCount }} 个筛选条件</span>
                  <span v-if="activeSorts.length" class="hotspot-toolbar__meta-pill">{{ activeSorts.length }} 个排序条件</span>
                </div>
                <div class="hotspot-toolbar__panel-actions">
                  <button
                    v-if="activeSorts.length"
                    type="button"
                    class="hotspot-sortbar__reset"
                    @click="clearSorts"
                  >
                    清空排序
                  </button>
                  <button type="button" class="hotspot-toolbar__close" @click="toolbarOpen = false">
                    <el-icon><Close /></el-icon>
                  </button>
                </div>
              </div>

              <el-form label-position="top">
                <div class="hotspot-filterbar__grid">
                  <el-form-item class="mb-0 hotspot-filterbar__field hotspot-filterbar__field--keyword">
                    <el-input v-model="filters.keyword" size="small" placeholder="关键词过滤" clearable />
                  </el-form-item>

                  <el-form-item class="mb-0 hotspot-filterbar__field">
                    <el-select v-model="filters.sourceType" size="small" placeholder="全部来源" clearable>
                      <el-option value="bing" label="必应" />
                      <el-option value="google-news" label="谷歌资讯" />
                      <el-option value="hacker-news" label="Hacker News" />
                      <el-option value="twitter" label="推特 / X" />
                      <el-option value="bilibili" label="哔哩哔哩" />
                      <el-option value="weibo" label="微博" />
                      <el-option value="weibo-hot" label="微博热搜" />
                      <el-option value="sogou" label="搜狗搜索" />
                    </el-select>
                  </el-form-item>

                  <div class="hotspot-toolbar__meta-pill">
                    默认隐藏低相关内容
                  </div>

                  <div class="hotspot-filterbar__actions">
                    <el-button type="primary" size="small" round @click="applyFiltersAndHide">应用</el-button>
                    <el-button size="small" round @click="resetFilters">重置</el-button>
                  </div>
                </div>
              </el-form>

              <div class="hotspot-sortbar">
                <div class="hotspot-sortbar__title">
                  <span class="hotspot-sortbar__icon" aria-hidden="true">
                    <el-icon><Sort /></el-icon>
                  </span>
                  <span class="hotspot-sortbar__label">排序</span>
                </div>

                <div class="hotspot-sortbar__chips">
                  <button
                    v-for="option in sortOptions"
                    :key="option.key"
                    type="button"
                    class="hotspot-sortbar__chip"
                    :class="{ 'is-active': sortIndexMap[option.key] !== undefined }"
                    @click="toggleSort(option.key)"
                  >
                    <span>{{ option.label }}</span>
                    <span v-if="sortIndexMap[option.key] !== undefined" class="hotspot-sortbar__order">
                      {{ sortIndexMap[option.key] + 1 }}
                    </span>
                  </button>
                </div>
              </div>
            </section>
          </Transition>
        </div>
      </template>
    </HotspotFeed>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Close, Filter, Sort } from '@element-plus/icons-vue';
import { useMonitorStore } from '../stores/monitor';
import HotspotFeed from '../components/HotspotFeed.vue';

const sourceLabels = {
  all: '全部',
  bing: '必应',
  'google-news': '谷歌资讯',
  'hacker-news': 'Hacker News',
  twitter: '推特 / X',
  bilibili: '哔哩哔哩',
  weibo: '微博',
  'weibo-hot': '微博热搜',
  sogou: '搜狗搜索'
};

const store = useMonitorStore();
const activeSorts = ref([]);
const activeSourceTab = ref('all');
const toolbarOpen = ref(false);
const toolbarRoot = ref(null);

const filters = reactive({
  keyword: '',
  sourceType: '',
  importance: ''
});

const sortOptions = [
  { key: 'latestPublished', label: '最新发布' },
  { key: 'latestDiscovered', label: '最新发现' },
  { key: 'relevance', label: '相关性' },
  { key: 'heat', label: '热度' }
];

const sortIndexMap = computed(() =>
  activeSorts.value.reduce((result, key, index) => {
    result[key] = index;
    return result;
  }, {})
);

const activeFilterCount = computed(() => {
  let count = 0;

  if (filters.keyword.trim()) count += 1;
  return count;
});

const activeControlCount = computed(() => activeFilterCount.value + activeSorts.value.length);

const sourceTabCounts = computed(() => {
  const counts = {
    all: Number(store.sourceCounts.all || store.pagination.total || 0),
    bing: 0,
    'google-news': 0,
    'hacker-news': 0,
    twitter: 0,
    bilibili: 0,
    weibo: 0,
    'weibo-hot': 0,
    sogou: 0
  };

  for (const source of Object.keys(counts)) {
    if (source === 'all') {
      continue;
    }

    counts[source] = Number(store.sourceCounts[source] || 0);
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

const sortedHotspots = computed(() => {
  const items = [...store.hotspots];

  if (!activeSorts.value.length) {
    return items;
  }

  return items.sort(compareHotspots);
});

function applyFilters() {
  activeSourceTab.value = filters.sourceType || 'all';
  store.fetchHotspots({
    ...filters
  });
}

function applyFiltersAndHide() {
  applyFilters();
  toolbarOpen.value = false;
}

function selectSourceTab(key) {
  activeSourceTab.value = key;
  filters.sourceType = key === 'all' ? '' : key;
  applyFilters();
}

function handlePointerDown(event) {
  if (!toolbarOpen.value) {
    return;
  }

  if (toolbarRoot.value?.contains(event.target)) {
    return;
  }

  toolbarOpen.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handlePointerDown);
});

function resetFilters() {
  filters.keyword = '';
  filters.sourceType = '';
  filters.importance = '';
  activeSourceTab.value = 'all';
  applyFilters();
}

function toggleSort(key) {
  const index = activeSorts.value.indexOf(key);
  if (index >= 0) {
    activeSorts.value.splice(index, 1);
    return;
  }

  activeSorts.value.push(key);
}

function clearSorts() {
  activeSorts.value = [];
}

function compareHotspots(left, right) {
  for (const key of activeSorts.value) {
    const diff = compareByKey(left, right, key);
    if (diff !== 0) {
      return diff;
    }
  }

  return fallbackCompare(left, right);
}

function compareByKey(left, right, key) {
  if (key === 'latestPublished') {
    return normalizeTimestamp(right.sourcePublishedAt) - normalizeTimestamp(left.sourcePublishedAt);
  }

  if (key === 'latestDiscovered') {
    return normalizeTimestamp(right.discoveredAt) - normalizeTimestamp(left.discoveredAt);
  }

  if (key === 'relevance') {
    return numericValue(right.aiRelevance) - numericValue(left.aiRelevance);
  }

  if (key === 'heat') {
    return heatScore(right) - heatScore(left);
  }

  return 0;
}

function fallbackCompare(left, right) {
  const heatDiff = heatScore(right) - heatScore(left);
  if (heatDiff !== 0) {
    return heatDiff;
  }

  const relevanceDiff = numericValue(right.aiRelevance) - numericValue(left.aiRelevance);
  if (relevanceDiff !== 0) {
    return relevanceDiff;
  }

  const discoveredDiff = normalizeTimestamp(right.discoveredAt) - normalizeTimestamp(left.discoveredAt);
  if (discoveredDiff !== 0) {
    return discoveredDiff;
  }

  return Number(right.id || 0) - Number(left.id || 0);
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function heatScore(item) {
  return numericValue(item.heatScore);
}
</script>
