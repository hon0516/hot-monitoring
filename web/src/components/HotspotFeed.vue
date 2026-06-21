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
                <el-tag
                  v-if="importanceValue(item)"
                  :class="['hotspot-chip', 'hotspot-chip--importance', `hotspot-chip--importance-${importanceValue(item)}`]"
                  size="small"
                  round
                  effect="plain"
                >
                  <el-icon class="hotspot-chip__icon"><component :is="importanceIcon(item)" /></el-icon>
                  {{ importanceLabel(item) }}
                </el-tag>
                <el-tag class="hotspot-chip hotspot-chip--source" size="small" round effect="light" type="info">
                  <el-icon class="hotspot-chip__icon"><component :is="sourceIcon(item.sourceType)" /></el-icon>
                  {{ sourceLabel(item.sourceType) }}
                </el-tag>
                <el-tag
                  class="hotspot-chip hotspot-chip--keyword"
                  v-for="keyword in keywordTags(item)"
                  :key="`${item.id}-keyword-${keyword}`"
                  size="small"
                  round
                  effect="plain"
                >
                  <el-icon class="hotspot-chip__icon"><PriceTag /></el-icon>
                  {{ keyword }}
                </el-tag>
                <el-tag
                  v-if="truthStatus(item)"
                  :class="['hotspot-chip', 'hotspot-chip--truth', `hotspot-chip--truth-${truthStatus(item)}`]"
                  size="small"
                  round
                  effect="plain"
                >
                  <el-icon class="hotspot-chip__icon"><component :is="truthStatusIcon(item)" /></el-icon>
                  {{ truthStatusLabel(item) }}
                </el-tag>
                <el-tag
                  v-if="mentionStatus(item)"
                  :class="['hotspot-chip', 'hotspot-chip--mention', `hotspot-chip--mention-${mentionStatus(item)}`]"
                  size="small"
                  round
                  effect="plain"
                >
                  <el-icon class="hotspot-chip__icon"><component :is="mentionStatusIcon(item)" /></el-icon>
                  {{ mentionStatusLabel(item) }}
                </el-tag>
                <el-tag
                  v-if="hasComputedHeat(item)"
                  :class="['hotspot-chip', 'hotspot-chip--heat', heatClass(item.heatScore)]"
                  size="small"
                  round
                  effect="plain"
                >
                  <el-icon class="hotspot-chip__icon"><Odometer /></el-icon>
                  {{ heatLabel(item) }}
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
                  <div v-if="displaySummary(item)" class="mt-1.5 max-w-3xl">
                    <span class="mr-1.5 text-[12px] leading-5 font-medium text-cyan/65">
                      AI 摘要
                    </span>
                    <span class="text-[12px] leading-5 text-slate-400">{{ displaySummary(item) }}</span>
                  </div>
                  <div v-if="mode === 'monitor' && relevanceReasonText(item)" class="mt-2 max-w-3xl">
                    <button
                      type="button"
                      class="flex items-center gap-1 text-[11px] text-cyan/70 transition hover:text-cyan"
                      @click="toggleReason(item.id)"
                    >
                      <el-icon class="text-[12px]">
                        <component :is="isReasonExpanded(item.id) ? ArrowUp : ArrowDown" />
                      </el-icon>
                      AI 分析理由
                    </button>
                    <div v-if="isReasonExpanded(item.id)" class="overflow-hidden">
                      <p class="mt-1 border-l-2 border-cyan/20 pl-4 text-xs leading-5 text-slate-500">
                        {{ relevanceReasonText(item) }}
                      </p>
                    </div>
                  </div>
                  <div v-if="mode === 'monitor'" class="mt-3 flex flex-wrap items-center gap-2">
                    <el-button class="hotspot-detail-button" size="small" plain round @click.prevent="openEvidence(item)">
                      <el-icon><View /></el-icon>
                      内容详情
                    </el-button>
                  </div>
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

    <el-drawer
      v-model="evidenceDrawerOpen"
      size="min(720px, 92vw)"
      direction="rtl"
      class="evidence-drawer"
      :with-header="false"
    >
      <div class="evidence-panel">
        <div class="evidence-panel__header">
          <div>
            <p class="evidence-panel__eyebrow">DETAIL</p>
            <h2>{{ selectedHotspot?.title || '内容详情' }}</h2>
          </div>
          <el-tag v-if="evidence" round :type="auditStatusType(selectedHotspot?.auditStatus)">
            {{ auditStatusLabel(selectedHotspot) }}
          </el-tag>
        </div>

        <el-skeleton v-if="evidenceLoading" :rows="8" animated />

        <div v-else-if="evidence" class="evidence-panel__body">
          <section class="evidence-score-grid">
            <div v-for="score in scoreCards" :key="score.label" class="evidence-score-card">
              <p>{{ score.label }}</p>
              <strong>{{ score.value }}</strong>
            </div>
          </section>

          <section class="evidence-section">
            <div class="evidence-section__title">相关度依据</div>
            <article class="evidence-claim">
              <p>{{ evidence.relevanceReason || selectedHotspot?.relevanceReason || '该内容通过关键词感知 AI 分析过滤。' }}</p>
              <div v-if="evidence.matchedKeywords?.length" class="mt-3 flex flex-wrap gap-1.5">
                <el-tag v-for="term in evidence.matchedKeywords" :key="term" size="small" round type="primary">
                  {{ term }}
                </el-tag>
              </div>
            </article>
          </section>

          <section class="evidence-section">
            <div class="evidence-section__title">来源链路</div>
            <div class="space-y-2">
              <article v-for="source in evidence.sources" :key="source.id" class="evidence-source">
                <div class="min-w-0">
                  <a :href="source.url" target="_blank" rel="noreferrer">{{ source.title }}</a>
                  <p>
                    {{ source.domain || sourceLabel(source.discoverySourceType) }}
                    · {{ fetchStatusLabel(source.fetchStatus) }}
                  </p>
                </div>
                <div class="flex flex-wrap justify-end gap-1.5">
                  <el-tag size="small" round :type="source.fetchStatus === 'fetched' ? 'success' : 'warning'">
                    {{ fetchStatusLabel(source.fetchStatus) }}
                  </el-tag>
                </div>
                <p v-if="source.evidenceFlags?.length" class="evidence-source__flags">
                  {{ source.evidenceFlags.map(auditFlagLabel).join(' / ') }}
                </p>
              </article>
            </div>
          </section>

          <section class="evidence-section">
            <div class="evidence-section__title">人工反馈</div>
            <div class="grid gap-2 md:grid-cols-[180px_1fr]">
              <el-select v-model="feedbackType" size="small">
                <el-option value="false_positive" label="误报" />
                <el-option value="missed_relevance" label="相关性漏判" />
                <el-option value="cluster_error" label="聚类错误" />
                <el-option value="evidence_error" label="内容/匹配错误" />
              </el-select>
              <el-input v-model="feedbackNote" size="small" placeholder="补充说明，可留空" />
            </div>
            <div class="mt-3 flex items-center justify-between gap-3">
              <p class="evidence-muted">误报、内容/匹配错误、聚类错误会立即从默认热点流隐藏。</p>
              <el-button type="primary" size="small" round :loading="feedbackSaving" @click="submitFeedback">提交反馈</el-button>
            </div>
          </section>
        </div>
      </div>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  ArrowDown,
  ArrowUp,
  Aim,
  ChatDotRound,
  Check,
  CircleCheckFilled,
  CircleCloseFilled,
  Clock,
  CollectionTag,
  Connection,
  DataAnalysis,
  Link as LinkIcon,
  Odometer,
  PriceTag,
  RefreshRight,
  Search,
  Share,
  Star,
  StarFilled,
  TrendCharts,
  User,
  VideoCameraFilled,
  View,
  WarningFilled
} from '@element-plus/icons-vue';
import { api } from '../services/api';

const emit = defineEmits(['feedback-saved']);

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

const evidenceDrawerOpen = ref(false);
const evidenceLoading = ref(false);
const evidence = ref(null);
const selectedHotspot = ref(null);
const feedbackType = ref('false_positive');
const feedbackNote = ref('');
const feedbackSaving = ref(false);
const expandedReasons = ref(new Set());

const scoreCards = computed(() => {
  const scores = evidence.value?.scores || {};
  return [
    { label: '热度', value: evidence.value?.heatScore ?? selectedHotspot.value?.heatScore ?? '-' },
    { label: '相关度', value: scores.relevance ?? '-' },
    { label: '命中词', value: evidence.value?.matchedKeywords?.length ?? 0 }
  ];
});

function heatClass(score) {
  const value = Number(score);
  if (value >= 80) return 'hotspot-chip--heat-blast';
  if (value >= 60) return 'hotspot-chip--heat-hot';
  if (value >= 40) return 'hotspot-chip--heat-warm';
  return 'hotspot-chip--heat-cold';
}

function hasComputedHeat(item) {
  const score = item?.heatScore;
  return score !== null && score !== undefined && score !== '' && Number.isFinite(Number(score));
}

function heatLabel(item) {
  const score = Number(item?.heatScore);
  const label = String(item?.heatLabel || '').trim();
  if (Number.isFinite(score)) {
    return `${label || localHeatLabel(score)} ${score}`;
  }

  return '';
}

function keywordTags(item) {
  return (Array.isArray(item?.keywords) ? item.keywords : [])
    .map((entry) => String(entry?.keyword?.term || entry?.term || entry || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function localHeatLabel(score) {
  if (score >= 80) return '爆';
  if (score >= 60) return '热';
  if (score >= 40) return '温';
  return '冷';
}

function importanceValue(item) {
  const value = String(item?.aiImportance || item?.importance || '').trim().toLowerCase();
  return ['urgent', 'high', 'medium', 'low'].includes(value) ? value : '';
}

function importanceLabel(item) {
  return importanceValue(item);
}

function importanceIcon(item) {
  const icons = {
    urgent: WarningFilled,
    high: TrendCharts,
    medium: DataAnalysis,
    low: StarFilled
  };

  return icons[importanceValue(item)] || DataAnalysis;
}

function sourceIcon(sourceType) {
  const icons = {
    bing: Search,
    twitter: LinkIcon,
    weibo: TrendCharts,
    'weibo-hot': TrendCharts,
    'google-news': CollectionTag,
    'hacker-news': DataAnalysis,
    bilibili: VideoCameraFilled,
    sogou: Search
  };

  return icons[sourceType] || LinkIcon;
}

function truthStatus(item) {
  if (item?.aiIsReal === false || ['rejected', 'contradicted'].includes(item?.verificationStatus)) {
    return 'suspicious';
  }

  if (item?.aiIsReal === true && Number(item?.aiRelevance) >= 80) {
    return 'trusted';
  }

  return '';
}

function truthStatusLabel(item) {
  return truthStatus(item) === 'suspicious' ? '可疑' : '可信';
}

function truthStatusIcon(item) {
  return truthStatus(item) === 'suspicious' ? CircleCloseFilled : CircleCheckFilled;
}

function mentionStatus(item) {
  if (item?.keywordMentioned === true || hasDirectMention(item)) {
    return 'direct';
  }

  if (item?.keywordMentioned === false) {
    return 'indirect';
  }

  return '';
}

function mentionStatusLabel(item) {
  return mentionStatus(item) === 'direct' ? '直接提及' : '间接相关';
}

function mentionStatusIcon(item) {
  return mentionStatus(item) === 'direct' ? Aim : Connection;
}

function displaySummary(item) {
  const summary = String(item?.aiSummary || item?.summary || '').trim();
  const title = String(item?.title || '').trim();
  return summary && summary !== title ? summary : '';
}

function relevanceReasonText(item) {
  return String(item?.relevanceReason || '').trim();
}

function isReasonExpanded(id) {
  return expandedReasons.value.has(id);
}

function toggleReason(id) {
  const next = new Set(expandedReasons.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedReasons.value = next;
}

function reviewStatusLabel(item) {
  if (!item || typeof item === 'string') return '相关热点';
  return item.relevanceReason || '相关热点';
}

function auditStatusLabel(statusOrItem) {
  const status = typeof statusOrItem === 'string'
    ? statusOrItem
    : statusOrItem?.auditStatus || statusOrItem?.verificationStatus;
  if (status === 'needs_review') return reviewStatusLabel(statusOrItem);
  const labels = {
    trusted: '可信',
    needs_review: '相关热点',
    low_evidence: '低相关',
    noise: '搜索噪音'
  };

  return labels[status] || '相关热点';
}

function auditStatusType(status) {
  const types = {
    trusted: 'success',
    needs_review: 'warning',
    low_evidence: 'info',
    noise: 'danger'
  };

  return types[status] || 'warning';
}

function hasDirectMention(item) {
  return String(item?.aiSummary || '').trim().startsWith('【直接提及】');
}

function sourceLabel(sourceType) {
  const labels = {
    bing: '必应',
    twitter: '推特',
    weibo: '微博',
    'weibo-hot': '微博热搜',
    'google-news': '谷歌资讯',
    'hacker-news': 'Hacker News',
    bilibili: '哔哩哔哩',
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

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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

function auditFlagLabel(flag) {
  const labels = {
    search_noise: '疑似搜索结果或聚合页',
    collection_or_series: '合集或系列内容',
    tutorial_not_hotspot: '教程内容，热点属性较弱',
    marketing_language: '标题有营销化表达',
    missing_snippet_low_source: '摘要不足且来源较弱',
    title_is_query: '标题像查询词',
    numeric_or_duration_title: '标题像数字或时长',
    title_too_short: '标题过短'
    ,
    body_unavailable: '正文不可用',
    published_at_missing: '发布时间缺失',
    metadata_fallback: '使用元数据兜底',
    low_semantic_relevance: '语义相关性过低',
    feedback_false_positive: '用户反馈误报',
    feedback_cluster_error: '用户反馈聚类错误',
    feedback_evidence_error: '用户反馈内容/匹配错误'
  };

  return labels[flag] || flag;
}

function fetchStatusLabel(status) {
  const labels = {
    fetched: '正文已抓取',
    metadata_only: '元数据',
    failed: '抓取失败'
  };
  return labels[status] || status || '未知';
}

async function openEvidence(item) {
  selectedHotspot.value = item;
  evidenceDrawerOpen.value = true;
  evidenceLoading.value = true;
  evidence.value = null;
  feedbackType.value = 'false_positive';
  feedbackNote.value = '';

  try {
    evidence.value = await api.getHotspotEvidence(item.id);
  } catch (error) {
    ElMessage.error(error.message || '内容详情加载失败');
  } finally {
    evidenceLoading.value = false;
  }
}

async function submitFeedback() {
  if (!selectedHotspot.value) return;
  feedbackSaving.value = true;
  try {
    await api.saveHotspotFeedback(selectedHotspot.value.id, {
      type: feedbackType.value,
      note: feedbackNote.value
    });
    ElMessage.success('反馈已记录');
    if (['false_positive', 'cluster_error', 'evidence_error'].includes(feedbackType.value)) {
      selectedHotspot.value.verificationStatus = 'rejected';
      selectedHotspot.value.auditStatus = 'noise';
      selectedHotspot.value.trustScore = 0;
    }
    emit('feedback-saved', selectedHotspot.value);
    evidence.value = await api.getHotspotEvidence(selectedHotspot.value.id);
    feedbackNote.value = '';
  } catch (error) {
    ElMessage.error(error.message || '反馈提交失败');
  } finally {
    feedbackSaving.value = false;
  }
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

:deep(.hotspot-chip .el-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

:deep(.hotspot-chip__icon) {
  font-size: 12px;
  line-height: 1;
}

:deep(.hotspot-chip--importance) {
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

:deep(.hotspot-chip--importance-urgent) {
  border-color: rgba(248, 113, 113, 0.48);
  background: rgba(220, 38, 38, 0.16);
  color: #fecaca;
}

:deep(.hotspot-chip--importance-high) {
  border-color: rgba(251, 146, 60, 0.46);
  background: rgba(234, 88, 12, 0.15);
  color: #fed7aa;
}

:deep(.hotspot-chip--importance-medium) {
  border-color: rgba(251, 191, 36, 0.42);
  background: rgba(217, 119, 6, 0.14);
  color: #fde68a;
}

:deep(.hotspot-chip--importance-low) {
  border-color: rgba(52, 211, 153, 0.36);
  background: rgba(16, 185, 129, 0.12);
  color: #bbf7d0;
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

:deep(.hotspot-chip--truth-trusted) {
  border-color: rgba(74, 222, 128, 0.42);
  background: rgba(34, 197, 94, 0.13);
  color: #bbf7d0;
}

:deep(.hotspot-chip--truth-suspicious) {
  border-color: rgba(248, 113, 113, 0.48);
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}

:deep(.hotspot-chip--mention-direct) {
  border-color: rgba(192, 132, 252, 0.42);
  background: rgba(147, 51, 234, 0.13);
  color: #e9d5ff;
}

:deep(.hotspot-chip--mention-indirect) {
  border-color: rgba(250, 204, 21, 0.38);
  background: rgba(202, 138, 4, 0.12);
  color: #fef08a;
}

:deep(.hotspot-chip--heat) {
  font-weight: 700;
  letter-spacing: 0.02em;
  backdrop-filter: blur(6px);
}

:deep(.hotspot-chip--heat-cold) {
  border-color: rgba(100, 181, 246, 0.38);
  background: rgba(37, 99, 235, 0.14);
  color: #bfdbfe;
}

:deep(.hotspot-chip--heat-warm) {
  border-color: rgba(251, 191, 36, 0.42);
  background: rgba(217, 119, 6, 0.16);
  color: #fde68a;
}

:deep(.hotspot-chip--heat-hot) {
  border-color: rgba(248, 113, 113, 0.48);
  background: rgba(220, 38, 38, 0.18);
  color: #fecaca;
}

:deep(.hotspot-chip--heat-blast) {
  border-color: rgba(220, 38, 38, 0.62);
  background: rgba(127, 29, 29, 0.36);
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.18);
  color: #fff1f2;
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

:deep(.hotspot-detail-button .el-icon) {
  margin-right: 2px;
}
</style>
