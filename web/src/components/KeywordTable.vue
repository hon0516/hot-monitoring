<template>
  <section class="glass-card rounded-[30px] p-5">
    <div class="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">关键词矩阵</p>
        <h3 class="mt-2 font-display text-xl text-white">监控关键词</h3>
        <p class="mt-2 max-w-xl text-sm leading-6 text-slate-400">
          把模型名、产品名和发布时间线索组合起来，能更快捕获真正值得看的新热点。
        </p>
      </div>
      <form class="flex flex-col gap-3 sm:flex-row" @submit.prevent="submit">
        <el-input v-model="draft" class="w-full sm:w-56" placeholder="例如 GPT-5 / OpenAI" />
        <el-button type="primary" round native-type="submit">添加</el-button>
      </form>
    </div>

    <div class="space-y-3">
      <div v-if="!items.length" class="rounded-[24px] border border-dashed border-cyan/20 bg-cyan/[0.03] px-5 py-6">
        <p class="font-display text-lg text-white">当前还没有监控关键词</p>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          可以先从 1-2 个高信号词开始，跑通链路后再扩展到品牌、模型代号和竞品组合词。
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <el-button v-for="suggestion in suggestions" :key="suggestion" round @click="emit('add', suggestion)">
            + {{ suggestion }}
          </el-button>
        </div>
      </div>

      <div
        v-for="keyword in items"
        :key="keyword.id"
        class="flex flex-col gap-3 rounded-[22px] border border-white/5 bg-white/[0.03] px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <p class="font-display text-lg text-white">{{ keyword.term }}</p>
          <p class="mt-1 text-xs text-slate-500">创建于 {{ formatDate(keyword.createdAt) }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <el-switch :model-value="keyword.enabled" inline-prompt active-text="开" inactive-text="停" @change="$emit('toggle', keyword)" />
          <el-button round @click="rename(keyword)">重命名</el-button>
          <el-button round type="danger" plain @click="$emit('remove', keyword.id)">删除</el-button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessageBox } from 'element-plus';

const emit = defineEmits(['add', 'toggle', 'rename', 'remove']);

defineProps({
  items: {
    type: Array,
    default: () => []
  },
  suggestions: {
    type: Array,
    default: () => []
  }
});

const draft = ref('');

function submit() {
  if (!draft.value.trim()) {
    return;
  }

  const value = draft.value.trim();
  draft.value = '';
  emit('add', value);
}

async function rename(keyword) {
  try {
    const { value } = await ElMessageBox.prompt('输入新的关键词', '重命名关键词', {
      inputValue: keyword.term,
      inputPattern: /\S+/,
      inputErrorMessage: '关键词不能为空'
    });

    if (!value || value.trim() === keyword.term) {
      return;
    }

    emit('rename', {
      keyword,
      term: value.trim()
    });
  } catch {
    // 用户取消
  }
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('zh-CN');
}
</script>
