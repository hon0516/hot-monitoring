<template>
  <el-row :gutter="16">
    <el-col v-for="metric in metrics" :key="metric.label" :xs="24" :sm="12" :xl="6">
      <el-card class="glass-card mb-4 rounded-[26px] border-0">
        <div class="flex items-end justify-between gap-3 p-5">
          <div>
            <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">{{ metric.label }}</p>
            <el-statistic :value="metric.value" class="mt-4" />
            <p class="mt-2 text-sm text-slate-400">{{ metric.help }}</p>
          </div>
          <div class="h-14 w-14 rounded-full border border-cyan/30 bg-cyan/10 shadow-neon"></div>
        </div>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup>
defineProps({
  metrics: {
    type: Array,
    default: () => []
  }
});
</script>
