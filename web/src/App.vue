<template>
  <AppFrame :socket-state="store.socketState" :live-message="store.liveMessage" :loading="store.loading" @run-search="store.runSearch">
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
