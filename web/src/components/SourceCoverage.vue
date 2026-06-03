<template>
  <section class="glass-card rounded-[10px] p-4">
    <div
      v-if="showHeader || total"
      class="flex items-start justify-between gap-3"
      :class="showHeader ? 'mb-3' : 'mb-2'"
    >
      <div v-if="showHeader">
        <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">来源覆盖</p>
        <h3 class="mt-1.5 font-display text-lg text-white">{{ title }}</h3>
      </div>
      <div v-else />
      <el-tag v-if="total" size="small" round effect="dark">{{ total }} 条</el-tag>
    </div>

    <div class="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
      <article
        v-for="item in normalizedItems"
        :key="item.key"
        class="source-coverage-card rounded-[10px] px-3.5 py-3"
      >
        <div class="flex items-center gap-3">
          <span class="source-coverage-card__icon" :class="item.iconClass" aria-hidden="true">
            <component :is="item.icon" />
          </span>

          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] text-slate-300">{{ item.label }}</p>
            <p class="mt-1 text-[11px] uppercase tracking-[0.24em] text-slate-500">
              {{ item.percentage }}% of scan
            </p>
          </div>

          <div class="text-right">
            <p class="text-xl font-semibold leading-none text-white">{{ item.count }}</p>
            <p class="mt-1 text-[11px] uppercase tracking-[0.24em] text-cyan/70">条目</p>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import {
  ChatDotRound,
  Document,
  Promotion,
  Search,
  TrendCharts,
  VideoPlay
} from '@element-plus/icons-vue';

const props = defineProps({
  stats: {
    type: Object,
    default: () => ({})
  },
  items: {
    type: Array,
    default: () => []
  },
  title: {
    type: String,
    default: '本轮聚合来源'
  },
  showHeader: {
    type: Boolean,
    default: true
  }
});

const labels = {
  bing: '必应资讯',
  'google-news': '谷歌资讯',
  'hacker-news': 'Hacker News',
  twitter: '推特 / X',
  bilibili: '哔哩哔哩',
  weibo: '微博搜索',
  sogou: '搜狗搜索'
};

const sourceMeta = {
  bing: {
    icon: Search,
    iconClass: 'source-coverage-card__icon--cyan'
  },
  'google-news': {
    icon: Document,
    iconClass: 'source-coverage-card__icon--violet'
  },
  'hacker-news': {
    icon: TrendCharts,
    iconClass: 'source-coverage-card__icon--amber'
  },
  twitter: {
    icon: Promotion,
    iconClass: 'source-coverage-card__icon--sky'
  },
  bilibili: {
    icon: VideoPlay,
    iconClass: 'source-coverage-card__icon--rose'
  },
  weibo: {
    icon: ChatDotRound,
    iconClass: 'source-coverage-card__icon--orange'
  },
  sogou: {
    icon: Search,
    iconClass: 'source-coverage-card__icon--emerald'
  }
};

const fallbackStats = computed(() => {
  const counts = {
    bing: 0,
    'google-news': 0,
    'hacker-news': 0,
    twitter: 0,
    bilibili: 0,
    weibo: 0,
    sogou: 0
  };

  for (const item of props.items) {
    if (item?.sourceType in counts) {
      counts[item.sourceType] += 1;
    }
  }

  return counts;
});

const effectiveStats = computed(() => {
  const totalFromLatest = Object.values(props.stats).reduce((sum, value) => sum + Number(value || 0), 0);
  return totalFromLatest > 0 ? props.stats : fallbackStats.value;
});

const total = computed(() =>
  Object.values(effectiveStats.value).reduce((sum, value) => sum + Number(value || 0), 0)
);

const normalizedItems = computed(() => {
  const floor = total.value || 1;

  return Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    icon: sourceMeta[key]?.icon || Search,
    iconClass: sourceMeta[key]?.iconClass || 'source-coverage-card__icon--cyan',
    count: Number(effectiveStats.value[key] || 0),
    percentage: Math.round((Number(effectiveStats.value[key] || 0) / floor) * 100)
  }));
});
</script>

<style scoped>
.source-coverage-card {
  border: 1px solid rgba(255, 255, 255, 0.05);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
    rgba(2, 6, 23, 0.44);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.source-coverage-card__icon {
  display: inline-flex;
  height: 36px;
  width: 36px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid currentColor;
  background: rgba(255, 255, 255, 0.03);
  font-size: 16px;
}

.source-coverage-card__icon--cyan {
  color: #37d8ff;
}

.source-coverage-card__icon--violet {
  color: #8b9cff;
}

.source-coverage-card__icon--amber {
  color: #ffb454;
}

.source-coverage-card__icon--sky {
  color: #5ce1e6;
}

.source-coverage-card__icon--rose {
  color: #ff7aa2;
}

.source-coverage-card__icon--orange {
  color: #ff8d4d;
}

.source-coverage-card__icon--emerald {
  color: #88ff6b;
}
</style>
