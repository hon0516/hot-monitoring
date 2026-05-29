<template>
  <section class="glass-card rounded-[30px] p-5">
    <div class="mb-6">
      <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">通知日志</p>
      <h3 class="mt-2 font-display text-xl text-white">通知历史</h3>
    </div>

    <div class="space-y-3">
      <article
        v-for="item in items"
        :key="item.id"
        class="rounded-[20px] border border-white/5 bg-white/[0.03] px-4 py-4"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.3em] text-slate-300">
            {{ channelLabel(item.channel) }}
          </span>
          <span :class="item.status === 'sent' ? 'text-acid' : 'text-ember'" class="text-xs uppercase tracking-[0.25em]">
            {{ statusLabel(item.status) }}
          </span>
        </div>
        <p class="mt-3 text-sm text-white">{{ item.hotspot?.title || item.errorMessage || '系统事件' }}</p>
        <p class="mt-2 text-xs text-slate-500">{{ formatTime(item.sentAt) }}</p>
      </article>

      <el-empty v-if="!items.length" description="还没有通知记录。" :image-size="64" />
    </div>
  </section>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => []
  }
});

function channelLabel(value) {
  const labels = {
    websocket: '站内推送',
    email: '邮件'
  };

  return labels[value] || value;
}

function statusLabel(value) {
  const labels = {
    sent: '已发送',
    failed: '失败'
  };

  return labels[value] || value;
}

function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN');
}
</script>
