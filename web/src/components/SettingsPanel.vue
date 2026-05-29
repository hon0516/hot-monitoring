<template>
  <section class="glass-card rounded-[30px] p-5">
    <div class="mb-6">
      <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">控制中心</p>
      <h3 class="mt-2 font-display text-xl text-white">策略与通知</h3>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        这里定义监控范围、触发阈值和通知通道。建议先把浏览器推送跑通，再补上邮件通知。
      </p>
    </div>

    <div class="mb-5 grid gap-3 md:grid-cols-3">
      <div class="rounded-[24px] border border-acid/15 bg-acid/[0.05] px-4 py-4">
        <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">模型接入</p>
        <p class="mt-3 text-sm text-white">{{ aiProviderTitle }}</p>
        <p class="mt-1 text-sm" :class="settings.aiProviderAvailable ? 'text-acid' : 'text-ember'">
          {{ settings.aiProviderAvailable ? 'AI 分析可用' : '当前提供方未就绪' }}
        </p>
      </div>
      <div class="rounded-[24px] border border-cyan/15 bg-cyan/[0.05] px-4 py-4">
        <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">来源接入</p>
        <p class="mt-3 text-sm text-white">Twitter 接口</p>
        <p class="mt-1 text-sm" :class="twitterStatusClass">
          {{ twitterStatusText }}
        </p>
      </div>
      <div class="rounded-[24px] border border-ember/15 bg-ember/[0.05] px-4 py-4">
        <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">通知投递</p>
        <p class="mt-3 text-sm text-white">SMTP 邮件</p>
        <p class="mt-1 text-sm" :class="settings.hasSmtpConfig ? 'text-acid' : 'text-ember'">
          {{ settings.hasSmtpConfig ? '邮件联调就绪' : '仍需补 SMTP 配置' }}
        </p>
      </div>
    </div>

    <el-form class="space-y-5" label-position="top" @submit.prevent="submit">
      <section class="rounded-[26px] border border-white/5 bg-white/[0.03] p-4">
        <div class="mb-4">
          <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">AI 提供方</p>
          <p class="mt-2 text-sm text-slate-400">手动切换热点分析所使用的模型提供方。当前版本仅保留腾讯 TokenHub 与 OpenRouter。</p>
        </div>

        <div class="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
          <el-form-item label="当前 AI 提供方" class="mb-0">
            <el-select v-model="form.aiProvider" class="w-full">
              <el-option value="tencent-tokenhub" label="腾讯 TokenHub" />
              <el-option value="openrouter" label="OpenRouter" />
            </el-select>
          </el-form-item>

          <div class="grid gap-3 md:grid-cols-2">
            <div
              v-for="provider in aiProviderCards"
              :key="provider.key"
              class="rounded-2xl border px-4 py-4"
              :class="provider.active ? 'border-cyan/35 bg-cyan/[0.05]' : 'border-white/5 bg-slate-950/40'"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm text-white">{{ provider.title }}</p>
                <el-tag size="small" round :type="provider.available ? 'success' : 'danger'">
                  {{ provider.available ? '已就绪' : '缺失密钥' }}
                </el-tag>
              </div>
              <p class="mt-2 text-xs leading-5 text-slate-500">{{ provider.description }}</p>
              <p class="mt-2 text-[11px]" :class="provider.active ? 'text-cyan' : 'text-slate-500'">
                {{ provider.active ? '当前选中' : '可在上方切换' }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-[26px] border border-white/5 bg-white/[0.03] p-4">
        <div class="mb-4">
          <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">扫描节奏</p>
          <p class="mt-2 text-sm text-slate-400">设置系统自动扫描热点的间隔。保存后后端会立即按新的频率重载定时任务。</p>
        </div>

        <div class="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
          <el-form-item label="自动扫描频率" class="mb-0">
            <el-select v-model="form.scanIntervalMinutes" class="w-full">
              <el-option
                v-for="minutes in scanIntervalOptions"
                :key="minutes"
                :value="minutes"
                :label="`${minutes} 分钟`"
              />
            </el-select>
          </el-form-item>

          <div class="rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-4">
            <p class="text-sm text-white">当前自动扫描</p>
            <p class="mt-2 text-lg text-cyan">每 {{ form.scanIntervalMinutes }} 分钟一次</p>
            <p class="mt-2 text-xs leading-5 text-slate-500">
              服务重启后会继续读取这个配置；当前生效中的后端定时器频率是 {{ settings.schedulerIntervalMinutes || form.scanIntervalMinutes }} 分钟。
            </p>
          </div>
        </div>
      </section>

      <section class="rounded-[26px] border border-white/5 bg-white/[0.03] p-4">
        <div class="mb-4">
          <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">范围与阈值</p>
          <p class="mt-2 text-sm text-slate-400">设定监控话题范围，以及什么样的结果值得打断你。</p>
        </div>

        <el-form-item label="监控范围" class="mb-0">
          <el-input v-model="form.scope" placeholder="例如 AI 编程 / Agent / 多模态" />
        </el-form-item>

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <el-form-item label="相关性阈值" class="mb-0">
            <el-input-number v-model.number="form.relevanceThreshold" min="0" max="100" controls-position="right" class="w-full" />
          </el-form-item>
          <el-form-item label="重要度阈值" class="mb-0">
            <el-select v-model="form.importanceThreshold" class="w-full">
              <el-option value="low" label="低" />
              <el-option value="medium" label="中" />
              <el-option value="high" label="高" />
              <el-option value="urgent" label="紧急" />
            </el-select>
          </el-form-item>
        </div>
      </section>

      <section class="rounded-[26px] border border-white/5 bg-white/[0.03] p-4">
        <div class="mb-4">
          <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">搜索来源</p>
          <p class="mt-2 text-sm text-slate-400">按需启用或停用各搜索源，停用后扫描时会直接跳过该来源。</p>
        </div>

        <div class="space-y-4">
          <div>
            <p class="mb-3 text-xs uppercase tracking-[0.28em] text-slate-500">关键词搜索源</p>
            <div class="grid gap-4 md:grid-cols-2">
              <div
                v-for="source in searchSourceCards"
                :key="source.key"
                class="flex items-start justify-between rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-4"
              >
                <div>
                  <p class="text-sm text-white">{{ source.title }}</p>
                  <p class="mt-1 text-xs leading-5 text-slate-500">{{ source.description }}</p>
                  <p v-if="source.hint" class="mt-2 text-[11px] text-slate-500">{{ source.hint }}</p>
                </div>
                <el-switch v-model="form[source.key]" :disabled="source.disabled" />
              </div>
            </div>
          </div>

        </div>
      </section>

      <section class="rounded-[26px] border border-white/5 bg-white/[0.03] p-4">
        <div class="mb-4">
          <p class="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">通知渠道</p>
          <p class="mt-2 text-sm text-slate-400">浏览器推送适合即时追踪，邮件适合保留高价值热点留痕。</p>
        </div>

        <el-form-item label="通知邮箱" class="mb-0">
          <el-input v-model="form.recipientEmail" type="email" placeholder="请输入接收通知的邮箱" />
        </el-form-item>

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div class="flex items-start justify-between rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-4">
            <div>
              <p class="text-sm text-white">浏览器推送</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">实时把新热点推到当前打开的监控面板。</p>
            </div>
            <el-switch v-model="form.websocketEnabled" />
          </div>
          <div class="flex items-start justify-between rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-4">
            <div>
              <p class="text-sm text-white">邮件通知</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">仅建议在 SMTP 配好后开启，用来接收高价值热点快照。</p>
            </div>
            <el-switch v-model="form.emailEnabled" />
          </div>
        </div>

        <el-alert
          v-if="!settings.hasSmtpConfig"
          class="mt-4"
          title="SMTP 还没接通，补齐主机、端口、账号、密码和发件邮箱后，就可以把邮件通知一起联调。"
          type="warning"
          :closable="false"
          show-icon
        />
      </section>

      <div class="rounded-[24px] border border-white/5 bg-white/[0.03] p-4">
        <p class="font-mono text-xs uppercase tracking-[0.35em] text-slate-500">配置状态</p>
        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl border border-white/5 px-3 py-3 text-sm text-slate-300">
            {{ aiProviderTitle }}：
            <span :class="settings.aiProviderAvailable ? 'text-acid' : 'text-ember'">
              {{ settings.aiProviderAvailable ? ' 已就绪' : ' 缺失' }}
            </span>
          </div>
          <div class="rounded-2xl border border-white/5 px-3 py-3 text-sm text-slate-300">
            Twitter 接口：
            <span :class="twitterStatusClass">
              {{ twitterConfigLabel }}
            </span>
          </div>
          <div class="rounded-2xl border border-white/5 px-3 py-3 text-sm text-slate-300">
            SMTP：
            <span :class="settings.hasSmtpConfig ? 'text-acid' : 'text-ember'">
              {{ settings.hasSmtpConfig ? ' 已就绪' : ' 缺失' }}
            </span>
          </div>
        </div>
      </div>

      <el-button type="primary" round native-type="submit">保存设置</el-button>
    </el-form>
  </section>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['save']);

const form = reactive({
  scope: '',
  aiProvider: 'openrouter',
  scanIntervalMinutes: 30,
  emailEnabled: false,
  websocketEnabled: true,
  recipientEmail: '',
  relevanceThreshold: 70,
  importanceThreshold: 'high',
  bingSourceEnabled: true,
  googleNewsSourceEnabled: true,
  hackerNewsSourceEnabled: true,
  twitterSourceEnabled: true,
  bilibiliSourceEnabled: true,
  weiboSourceEnabled: true,
  sogouSourceEnabled: true
});

watch(
  () => props.settings,
  (value) => {
    Object.assign(form, {
      scope: value.scope,
      aiProvider: value.aiProvider || 'openrouter',
      scanIntervalMinutes: value.scanIntervalMinutes || 30,
      emailEnabled: value.emailEnabled,
      websocketEnabled: value.websocketEnabled,
      recipientEmail: value.recipientEmail || '',
      relevanceThreshold: value.relevanceThreshold,
      importanceThreshold: value.importanceThreshold,
      bingSourceEnabled: value.bingSourceEnabled,
      googleNewsSourceEnabled: value.googleNewsSourceEnabled,
      hackerNewsSourceEnabled: value.hackerNewsSourceEnabled,
      twitterSourceEnabled: value.twitterSourceEnabled,
      bilibiliSourceEnabled: value.bilibiliSourceEnabled,
      weiboSourceEnabled: value.weiboSourceEnabled,
      sogouSourceEnabled: value.sogouSourceEnabled
    });
  },
  { immediate: true }
);

function submit() {
  emit('save', { ...form });
}

const scanIntervalOptions = computed(() => props.settings.allowedScanIntervals || [5, 10, 15, 30, 60]);

const aiProviderTitle = computed(() => {
  const labels = {
    'tencent-tokenhub': '腾讯 TokenHub',
    openrouter: 'OpenRouter'
  };

  return labels[form.aiProvider] || labels[props.settings.aiProvider] || 'AI';
});

const aiProviderCards = computed(() => [
  {
    key: 'tencent-tokenhub',
    title: '腾讯 TokenHub',
    description: '按 OpenAI 兼容接口接入腾讯 TokenHub，可单独配置 API Key、Base URL 和模型名。',
    available: props.settings.hasTencentTokenHubKey,
    active: form.aiProvider === 'tencent-tokenhub'
  },
  {
    key: 'openrouter',
    title: 'OpenRouter',
    description: '适合统一接不同模型，但会受当前余额与路由可用性影响。',
    available: props.settings.hasOpenRouterKey,
    active: form.aiProvider === 'openrouter'
  }
]);

const twitterStatusText = computed(() => {
  if (!props.settings.hasTwitterApiKey) {
    return '缺少接口密钥';
  }

  if (!props.settings.twitterSourceRuntimeEnabled) {
    return '环境变量已暂停';
  }

  return props.settings.twitterSourceEnabled ? '实时推文采集可用' : '采集已停用';
});

const twitterConfigLabel = computed(() => {
  if (!props.settings.hasTwitterApiKey) {
    return ' 缺失';
  }

  if (!props.settings.twitterSourceRuntimeEnabled) {
    return ' 环境已暂停';
  }

  return props.settings.twitterSourceEnabled ? ' 已就绪' : ' 已停用';
});

const twitterStatusClass = computed(() => {
  if (!props.settings.hasTwitterApiKey) {
    return 'text-ember';
  }

  if (!props.settings.twitterSourceRuntimeEnabled) {
    return 'text-slate-400';
  }

  return props.settings.twitterSourceEnabled ? 'text-cyan' : 'text-slate-400';
});

const searchSourceCards = computed(() => [
  {
    key: 'bingSourceEnabled',
    title: '必应资讯',
    description: '适合补充中文科技与门户新闻信号。',
    disabled: false,
    hint: ''
  },
  {
    key: 'googleNewsSourceEnabled',
    title: '谷歌资讯',
    description: '适合跨站聚合新闻，补充国际来源。',
    disabled: false,
    hint: ''
  },
  {
    key: 'hackerNewsSourceEnabled',
    title: 'Hacker News',
    description: '适合跟踪英文技术社区讨论与首发链接。',
    disabled: false,
    hint: ''
  },
  {
    key: 'twitterSourceEnabled',
    title: '推特 / X',
    description: '适合捕获更实时的讨论热度和作者动态。',
    disabled: !props.settings.hasTwitterApiKey || !props.settings.twitterSourceRuntimeEnabled,
    hint:
      !props.settings.hasTwitterApiKey
        ? '当前缺少 Twitter API 密钥，暂时无法启用。'
        : !props.settings.twitterSourceRuntimeEnabled
          ? '环境变量已暂停 Twitter 源，请先恢复后再启用。'
          : ''
  },
  {
    key: 'bilibiliSourceEnabled',
    title: '哔哩哔哩',
    description: '适合追踪中文视频社区里的 AI、产品和教程热度。',
    disabled: false,
    hint: '优先走公开接口，补充视频向内容。'
  },
  {
    key: 'weiboSourceEnabled',
    title: '微博搜索',
    description: '适合补充中文舆论场和热词匹配结果。',
    disabled: false,
    hint: '优先抓实时搜索页，提供微博 Cookie 时稳定性更好。'
  },
  {
    key: 'sogouSourceEnabled',
    title: '搜狗搜索',
    description: '适合补充中文网页搜索结果，扩大新闻和站点覆盖。',
    disabled: false,
    hint: '优先抓标准搜索结果块，不依赖站内热榜。'
  }
]);
</script>
