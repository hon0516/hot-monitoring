<template>
  <section class="glass-card flex h-full min-h-0 flex-col rounded-[10px] p-4">
    <div
      v-if="showHeader || $slots.actions"
      class="flex items-center justify-between"
      :class="showHeader ? 'mb-4' : 'mb-3'"
    >
      <div v-if="showHeader">
        <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">热点信号</p>
        <h3 class="mt-1.5 font-display text-lg text-white">{{ title }}</h3>
      </div>
      <div v-else />
      <slot name="actions" />
    </div>

    <div v-if="$slots.toolbar" class="mb-4">
      <slot name="toolbar" />
    </div>

    <div class="min-h-0 flex-1">
      <el-scrollbar class="results-scroll h-full" wrap-class="pr-1">
        <div v-if="items.length" class="space-y-4">
          <article
            v-for="item in items"
            :key="item.id"
            class="rounded-[10px] border border-white/5 bg-white/[0.03] p-3.5 transition hover:border-cyan/35 hover:bg-cyan/[0.05]"
          >
            <div class="space-y-2.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <el-tag class="hotspot-chip hotspot-chip--source" size="small" round effect="light" type="info">{{ sourceLabel(item.sourceType) }}</el-tag>
                <el-tag
                  v-if="mode === 'monitor' && item.aiImportance"
                  class="hotspot-chip hotspot-chip--trust"
                  size="small"
                  round
                  effect="dark"
                  :type="importanceType(item.aiImportance, item.aiIsReal)"
                >
                  {{ importanceLabel(item.aiImportance, item.aiIsReal) }}
                </el-tag>
                <el-tag
                  v-else-if="mode === 'monitor'"
                  class="hotspot-chip hotspot-chip--trust"
                  size="small"
                  round
                  effect="dark"
                  type="warning"
                >
                  待 AI 复核
                </el-tag>
                <el-tag
                  v-if="mode === 'monitor' && item.aiRelevance !== null && item.aiRelevance !== undefined"
                  class="hotspot-chip hotspot-chip--relevance"
                  size="small"
                  round
                  effect="plain"
                  type="primary"
                >
                  相关度 {{ item.aiRelevance }}
                </el-tag>
                <el-tag
                  v-else-if="mode === 'monitor'"
                  class="hotspot-chip hotspot-chip--relevance"
                  size="small"
                  round
                  effect="plain"
                  type="warning"
                >
                  可信度待补齐
                </el-tag>
                <el-tag
                  class="hotspot-chip hotspot-chip--trust"
                  size="small"
                  round
                  effect="plain"
                  type="success"
                  v-if="mode === 'search'"
                >
                  即时搜索
                </el-tag>
                <el-tag
                  class="hotspot-chip hotspot-chip--keyword"
                  v-for="keyword in item.keywords"
                  :key="keyword.keyword?.term || keyword"
                  size="small"
                  round
                  effect="plain"
                >
                  {{ keyword.keyword?.term || keyword }}
                </el-tag>
                <el-tag
                  v-if="mode === 'monitor' && hasDirectMention(item)"
                  class="hotspot-chip hotspot-chip--direct"
                  size="small"
                  round
                  effect="dark"
                >
                  直接提及
                </el-tag>
              </div>

              <div class="space-y-2">
                <div>
                  <el-link
                    :href="item.url"
                    target="_blank"
                    type="primary"
                    underline="never"
                    class="font-display text-base leading-7 !text-white hover:!text-cyan"
                  >
                    {{ item.title }}
                  </el-link>
                  <p class="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-300/80">
                    <span class="mr-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-cyan/80">
                      {{ mode === 'search' ? '内容摘要' : 'AI摘要' }}
                    </span>
                    {{ formatSummary(item) }}
                  </p>
                  <details v-if="mode === 'monitor'" class="mt-1 max-w-3xl text-[13px] text-slate-300/85">
                    <summary class="cursor-pointer text-[12px] text-slate-300">
                      <span class="mr-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-cyan/65">AI判断依据</span>
                      <span class="text-slate-400">展开查看可信 / 存疑理由</span>
                    </summary>
                    <ul class="mt-2 space-y-1.5 pl-5 text-[12px] leading-5 text-slate-400/90">
                      <li v-for="(reason, index) in extractAiEvidence(item)" :key="`${item.id}-reason-${index}`" class="list-disc">
                        {{ reason }}
                      </li>
                    </ul>
                  </details>
                  <div class="hotspot-meta mt-2">
                    <el-tooltip
                      v-for="meta in buildMetaItems(item)"
                      :key="meta.key"
                      :content="meta.tooltip || meta.label"
                      placement="top"
                      effect="dark"
                    >
                      <span
                        class="hotspot-meta__item"
                        :aria-label="meta.tooltip || meta.label"
                      >
                        <el-icon class="hotspot-meta__icon"><component :is="meta.icon" /></el-icon>
                        <span class="hotspot-meta__value">{{ meta.value }}</span>
                      </span>
                    </el-tooltip>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="flex h-full items-center justify-center rounded-[10px] border border-dashed border-cyan/20 bg-cyan/[0.03] px-5 py-8">
          <el-empty :description="emptyDescription">
            <template #default>
              <p class="mx-auto mt-3 max-w-2xl text-center text-[13px] leading-5 text-slate-400">
                {{ emptyHint }}
              </p>
            </template>
          </el-empty>
        </div>
      </el-scrollbar>
    </div>
  </section>
</template>

<script setup>
import {
  ChatDotRound,
  Check,
  Clock,
  RefreshRight,
  Share,
  Star,
  User,
  View
} from '@element-plus/icons-vue';

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  title: {
    type: String,
    default: '热点流'
  },
  showHeader: {
    type: Boolean,
    default: true
  },
  mode: {
    type: String,
    default: 'monitor'
  },
  emptyDescription: {
    type: String,
    default: '热点流还没有启动'
  },
  emptyHint: {
    type: String,
    default: '先在关键词页添加测试词，再执行一次扫描。现在会同时聚合必应资讯、谷歌资讯、Hacker News、推特，以及哔哩哔哩、微博、搜狗和热榜补充源。'
  }
});

function importanceType(importance, isReal) {
  if (isReal === false) return 'danger';
  if (importance === 'urgent') return 'success';
  if (importance === 'high') return 'primary';
  if (importance === 'medium') return 'primary';
  return 'info';
}

function importanceLabel(importance, isReal) {
  if (isReal === false) {
    return '不可信';
  }

  const labels = {
    low: '待验证',
    medium: '较可信',
    high: '可信',
    urgent: '高度可信'
  };

  return labels[importance] || '待验证';
}

function hasDirectMention(item) {
  return String(item?.aiSummary || '').trim().startsWith('【直接提及】');
}

function formatSummary(item) {
  const summary = String(item?.aiSummary || '').trim();
  if (summary) {
    return summary.replace(/^【直接提及】/u, '').trim();
  }

  if (item?.snippet) {
    return item.snippet;
  }

  return props.mode === 'search' ? '搜索渠道暂未返回摘要内容。' : '待 AI 分析后补齐摘要';
}

function sourceLabel(sourceType) {
  const labels = {
    bing: '必应',
    twitter: '推特',
    'google-news': '谷歌资讯',
    'hacker-news': 'Hacker News',
    bilibili: '哔哩哔哩',
    weibo: '微博',
    sogou: '搜狗'
  };

  return labels[sourceType] || sourceType;
}
function parseEngagement(engagementJson) {
  if (!engagementJson) {
    return null;
  }

  if (typeof engagementJson === 'object') {
    return engagementJson;
  }

  try {
    return JSON.parse(engagementJson);
  } catch {
    return null;
  }
}

function extractMetrics(engagementJson) {
  const engagement = parseEngagement(engagementJson);
  if (!engagement) {
    return [];
  }

  const metricMap = [
    ['views', '阅读', View],
    ['reads', '阅读', View],
    ['likes', '点赞', Star],
    ['retweets', '转发', Share],
    ['replies', '评论', ChatDotRound],
    ['comments', '评论', ChatDotRound]
  ];

  return metricMap
    .filter(([key]) => engagement[key] !== undefined && engagement[key] !== null)
    .map(([key, label, icon]) => ({
      key,
      label,
      tooltip: `${label}量`,
      icon,
      value: formatCount(engagement[key])
    }));
}

function authorMeta(engagementJson) {
  const engagement = parseEngagement(engagementJson);
  if (!engagement) {
    return {
      verified: false,
      followers: null
    };
  }

  const followers = Number(engagement.authorFollowers);
  return {
    verified: Boolean(engagement.authorVerified),
    followers: Number.isFinite(followers) ? followers : null
  };
}

function buildMetaItems(item) {
  const author = authorMeta(item.engagementJson);
  const items = [];

  if (item.sourceAuthor) {
    items.push({
      key: 'author',
      label: '作者',
      tooltip: '作者名称',
      icon: User,
      value: item.sourceAuthor
    });
  }

  if (author.verified) {
    items.push({
      key: 'verified',
      label: '认证',
      tooltip: '账号认证状态',
      icon: Check,
      value: '已认证'
    });
  }

  if (author.followers !== null) {
    items.push({
      key: 'followers',
      label: '粉丝',
      tooltip: '粉丝数量',
      icon: User,
      value: formatCount(author.followers)
    });
  }

  if (item.sourcePublishedAt) {
    items.push({
      key: 'publishedAt',
      label: '发布时间',
      tooltip: '内容发布时间',
      icon: Clock,
      value: formatRelativeTime(item.sourcePublishedAt)
    });
  }

  if (item.discoveredAt) {
    items.push({
      key: 'discoveredAt',
      label: '扫描时间',
      tooltip: '系统扫描到该内容的时间',
      icon: RefreshRight,
      value: formatRelativeTime(item.discoveredAt)
    });
  }

  return items.concat(extractMetrics(item.engagementJson));
}

function extractAiEvidence(item) {
  const raw = String(item?.aiEvidence || '').trim();
  if (raw) {
    return raw
      .split(/\n+|(?<=[。；;])/u)
      .map((line) => line.replace(/^[-*•\d.\s]+/u, '').trim())
      .filter(Boolean);
  }

  return ['这条热点已入库，但当前还没有完成 AI 真假与可信度分析。'];
}

function formatCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return value;
  }

  if (count >= 10000) {
    return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  }

  return count.toLocaleString('zh-CN');
}

function formatRelativeTime(value) {
  if (!value) return '未知时间';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 天前`;

  return date.toLocaleDateString('zh-CN');
}
</script>

<style scoped>
.hotspot-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.hotspot-meta__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(128, 156, 214, 0.12);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(148, 163, 184, 0.9);
  font-size: 11px;
  line-height: 1;
}

:deep(.hotspot-chip) {
  border-radius: 5px;
}

:deep(.hotspot-chip--direct) {
  border-color: rgba(255, 214, 102, 0.45);
  background: rgba(255, 214, 102, 0.16);
  color: #ffe08a;
}

:deep(.hotspot-chip--source) {
  border-color: rgba(123, 211, 255, 0.34);
  background: rgba(55, 216, 255, 0.12);
  color: #bff7ff;
}

:deep(.hotspot-chip--trust) {
  font-weight: 600;
}

:deep(.hotspot-chip--relevance) {
  border-color: rgba(102, 255, 194, 0.34);
  background: rgba(32, 201, 151, 0.12);
  color: #9dffd8;
}

:deep(.hotspot-chip--keyword) {
  border-color: rgba(177, 156, 255, 0.34);
  background: rgba(110, 131, 255, 0.12);
  color: #d5ccff;
}

.hotspot-meta__icon {
  color: rgba(55, 216, 255, 0.82);
  font-size: 12px;
}

.hotspot-meta__value {
  color: rgba(226, 232, 240, 0.76);
}
</style>
