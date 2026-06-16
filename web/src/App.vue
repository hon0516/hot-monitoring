<template>
  <AppFrame
    :socket-state="store.socketState"
    :live-message="store.liveMessage"
    :loading="store.loading"
    :latest-scan-inbox="store.latestScanInbox"
    @run-search="store.runSearch"
    @read-latest-scan-item="store.markLatestScanInboxItemRead"
  >
    <RouterView />
  </AppFrame>
</template>

<script setup>
import { onMounted } from 'vue';
import AppFrame from './components/AppFrame.vue';
import { useMonitorStore } from './stores/monitor';

const store = useMonitorStore();

onMounted(() => {
  store.bootstrap();
});
</script>
