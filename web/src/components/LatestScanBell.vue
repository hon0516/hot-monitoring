<template>
  <el-popover
    v-model:visible="visible"
    placement="bottom-end"
    trigger="click"
    :width="390"
    popper-class="latest-scan-popover"
  >
    <template #reference>
      <button
        type="button"
        class="latest-scan-bell"
        :class="{ 'has-unread': inbox.unreadCount > 0 }"
        aria-label="查看最新扫描热点"
      >
        <el-icon><Bell /></el-icon>
        <span v-if="inbox.unreadCount > 0" class="latest-scan-bell__badge">
          {{ badgeText }}
        </span>
      </button>
    </template>

    <section class="latest-scan-panel">
      <header class="latest-scan-panel__header">
        <div>
          <p class="latest-scan-panel__eyebrow">LATEST SCAN</p>
          <h2>最新扫描热点</h2>
        </div>
        <span class="latest-scan-panel__count">{{ inbox.total }} 条</span>
      </header>

      <p v-if="inbox.scannedAt" class="latest-scan-panel__time">
        {{ formatDateTime(inbox.scannedAt) }} 完成，本轮结果会在下次扫描后替换
      </p>

      <div v-if="inbox.items.length" class="latest-scan-panel__list">
        <a
          v-for="item in inbox.items"
          :key="item.id"
          class="latest-scan-panel__item"
          :class="{ 'is-unread': !item.isRead }"
          :href="item.event.url"
          target="_blank"
          rel="noreferrer"
          @click="$emit('read-item', item.id)"
        >
          <span
            class="latest-scan-panel__status"
            :class="`is-${item.event.verificationStatus || 'needs_review'}`"
          >
            {{ item.event.verificationStatus === 'trusted' ? '可信' : '相关' }}
          </span>
          <span class="latest-scan-panel__title">{{ item.event.title }}</span>
          <span class="latest-scan-panel__meta">
            {{ sourceLabel(item.event.sourceType) }}
            <template v-if="keywordLabel(item.event)"> · {{ keywordLabel(item.event) }}</template>
          </span>
        </a>
      </div>

      <div v-else class="latest-scan-panel__empty">
        <el-icon><Bell /></el-icon>
        <p>{{ inbox.scannedAt ? '最近一轮没有发现可展示热点' : '完成一次扫描后，这里会显示本轮热点' }}</p>
      </div>
    </section>
  </el-popover>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Bell } from '@element-plus/icons-vue';

const props = defineProps({
  inbox: {
    type: Object,
    required: true
  }
});

defineEmits(['read-item']);

const visible = ref(false);
const badgeText = computed(() => (props.inbox.unreadCount > 99 ? '99+' : String(props.inbox.unreadCount)));

const sourceLabels = {
  bing: '必应',
  'google-news': '谷歌资讯',
  'hacker-news': 'Hacker News',
  twitter: '推特 / X',
  bilibili: '哔哩哔哩',
  sogou: '搜狗搜索'
};

function sourceLabel(value) {
  return sourceLabels[value] || value || '未知来源';
}

function keywordLabel(event) {
  return event.keywords?.[0]?.keyword?.term || '';
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}
</script>
