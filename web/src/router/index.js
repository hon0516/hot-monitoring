import { createRouter, createWebHistory } from 'vue-router';
import HotspotsView from '../views/HotspotsView.vue';
import KeywordsView from '../views/KeywordsView.vue';
import SettingsView from '../views/SettingsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/hotspots' },
    { path: '/hotspots', component: HotspotsView, meta: { title: '热点流' } },
    { path: '/keywords', component: KeywordsView, meta: { title: '关键词' } },
    { path: '/settings', component: SettingsView, meta: { title: '系统设置' } }
  ]
});

export default router;
