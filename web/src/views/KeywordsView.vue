<template>
  <el-scrollbar class="page-scroll h-full">
    <div class="grid min-h-full gap-6 pr-1 xl:grid-cols-[minmax(0,1fr)_360px]">
      <KeywordTable
        :items="store.keywords"
        :suggestions="['GPT-5', 'OpenAI', 'Claude 4', 'Gemini 2.5']"
        @add="store.addKeyword"
        @toggle="store.toggleKeyword"
        @rename="({ keyword, term }) => store.renameKeyword(keyword, term)"
        @remove="store.removeKeyword"
      />
      <section class="glass-card rounded-[10px] p-5">
        <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">运营提示</p>
        <h3 class="mt-2 font-display text-xl text-white">监控建议</h3>
        <ul class="mt-6 space-y-4 text-sm leading-7 text-slate-300/80">
          <li>优先添加品牌名、模型名、产品代号和发布事件组合词。</li>
          <li>对泛词保持克制，范围过宽会增加低价值噪音。</li>
          <li>暂停而不是删除历史关键词，有利于保留监控策略。</li>
          <li>首轮建议只保留 1-2 个测试词，先观察采集和 AI 分析的输出质量。</li>
        </ul>
      </section>
    </div>
  </el-scrollbar>
</template>

<script setup>
import { useMonitorStore } from '../stores/monitor';
import KeywordTable from '../components/KeywordTable.vue';

const store = useMonitorStore();
</script>
