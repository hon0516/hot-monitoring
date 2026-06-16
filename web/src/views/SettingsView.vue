<template>
  <el-scrollbar class="page-scroll h-full">
    <div class="grid min-h-full gap-6 pr-1 xl:grid-cols-[minmax(0,1fr)_360px]">
      <SettingsPanel
        v-if="store.settings"
        :settings="store.settings"
        :source-health="store.sourceHealth"
        @save="handleSave"
      />
      <NotificationRail :items="store.notifications.slice(0, 6)" />
    </div>
  </el-scrollbar>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { useMonitorStore } from '../stores/monitor';
import NotificationRail from '../components/NotificationRail.vue';
import SettingsPanel from '../components/SettingsPanel.vue';

const store = useMonitorStore();

async function handleSave(payload) {
  try {
    await store.saveSettings(payload);
    ElMessage.success('设置已保存');
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  }
}
</script>
