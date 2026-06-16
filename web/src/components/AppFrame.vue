<template>
  <div class="app-shell relative">
    <el-container class="mx-auto box-border h-full max-w-[1600px] px-4 py-4 lg:px-5">
      <el-main class="flex h-full min-w-0 flex-1 flex-col gap-3 overflow-hidden p-0">
        <header class="app-shell__header flex flex-col gap-3">
          <section class="glass-card scanline hero-banner rounded-[10px] px-5 py-3.5 lg:px-7 lg:py-4">
            <div class="hero-banner__glow"></div>
            <div class="hero-banner__frame"></div>
            <div class="hero-banner__content relative z-[1]">
              <p class="hero-banner__eyebrow font-mono uppercase text-cyan/80">Pulse Forge Command Matrix</p>
              <h1 class="hero-banner__title mt-2.5 font-display font-semibold text-white">实时热点监控系统</h1>
            </div>
          </section>

          <section class="glass-card rounded-[10px] px-4 py-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <nav class="app-tabs flex flex-wrap gap-2">
                <RouterLink
                  v-for="item in navItems"
                  :key="item.to"
                  :to="item.to"
                  class="app-tab"
                  :class="{ 'app-tab--active': route.path === item.to }"
                >
                  <span class="font-mono text-[11px] uppercase tracking-[0.32em] text-slate-500">{{ item.code }}</span>
                  <span class="font-display text-sm text-slate-100">{{ item.label }}</span>
                </RouterLink>
              </nav>

              <div class="flex items-center gap-2 lg:justify-end">
                <LatestScanBell :inbox="latestScanInbox" @read-item="$emit('read-latest-scan-item', $event)" />
                <el-button class="nav-action self-start lg:self-auto" type="primary" :loading="loading" round @click="$emit('run-search')">
                  {{ loading ? '扫描中...' : '立即扫描' }}
                </el-button>
              </div>
            </div>
          </section>
        </header>

        <section class="min-h-0 flex-1 overflow-hidden">
          <slot />
        </section>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';
import LatestScanBell from './LatestScanBell.vue';

const props = defineProps({
  socketState: {
    type: String,
    default: 'connecting'
  },
  liveMessage: {
    type: String,
    default: '等待实时数据'
  },
  loading: {
    type: Boolean,
    default: false
  },
  latestScanInbox: {
    type: Object,
    default: () => ({
      scanJobId: null,
      trigger: null,
      scannedAt: null,
      unreadCount: 0,
      total: 0,
      items: []
    })
  }
});

defineEmits(['run-search', 'read-latest-scan-item']);

const route = useRoute();

const navItems = [
  { to: '/hotspots', label: '热点流', code: '01' },
  { to: '/keywords', label: '关键词', code: '02' },
  { to: '/search', label: '搜索', code: '03' },
  { to: '/settings', label: '系统设置', code: '04' }
];

</script>
