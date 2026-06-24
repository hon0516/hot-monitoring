import { defineStore } from 'pinia';
import { api } from '../services/api';
import { createSocketHandlers } from '../services/socket';

const sourceLabels = {
  bing: '必应',
  'google-news': '谷歌资讯',
  'hacker-news': 'Hacker News',
  twitter: '推特',
  bilibili: '哔哩哔哩',
  weibo: '微博',
  'weibo-hot': '微博热搜',
  sogou: '搜狗'
};

function createSourceCounts(overrides = {}) {
  return {
    all: 0,
    bing: 0,
    'google-news': 0,
    'hacker-news': 0,
    twitter: 0,
    bilibili: 0,
    weibo: 0,
    'weibo-hot': 0,
    sogou: 0,
    ...overrides
  };
}

function sortHotspotsByDiscoveredAt(collection) {
  collection.sort((left, right) => {
    const heatDiff = Number(right?.heatScore ?? -1) - Number(left?.heatScore ?? -1);
    if (heatDiff !== 0) {
      return heatDiff;
    }

    const relevanceDiff = Number(right?.aiRelevance ?? -1) - Number(left?.aiRelevance ?? -1);
    if (relevanceDiff !== 0) {
      return relevanceDiff;
    }

    const rightTime = new Date(right?.discoveredAt || 0).getTime();
    const leftTime = new Date(left?.discoveredAt || 0).getTime();
    const discoveredDiff = rightTime - leftTime;
    if (discoveredDiff !== 0) {
      return discoveredDiff;
    }

    return Number(right?.id || 0) - Number(left?.id || 0);
  });
}

function mergeRealtimeHotspot(collection, payload) {
  const existing = collection.find((item) => item.id === payload.hotspotId);
  if (existing) {
    Object.assign(existing, {
      title: payload.title,
      sourceType: payload.sourceType,
      sourceAuthor: payload.sourceAuthor,
      sourcePublishedAt: payload.sourcePublishedAt,
      engagementJson: payload.engagementJson,
      aiIsReal: payload.isReal,
      aiImportance: payload.importance,
      heatScore: payload.heatScore,
      heatLabel: payload.heatLabel,
      matchedKeywords: payload.matchedKeywords || [],
      relevanceReason: payload.relevanceReason || '',
      keywordMentioned: payload.keywordMentioned ?? null,
      aiRelevance: payload.relevance,
      auditStatus: payload.auditStatus,
      aiConfidence: payload.aiConfidence,
      trustScore: payload.trustScore,
      sourceQualityScore: payload.sourceQualityScore,
      sourceAuthorityScore: payload.sourceAuthorityScore,
      authorityReason: payload.authorityReason,
      bodyAvailable: payload.bodyAvailable,
      feedbackSummary: payload.feedbackSummary,
      evidenceScore: payload.evidenceScore,
      corroborationScore: payload.corroborationScore,
      contradictionScore: payload.contradictionScore,
      independentSourceCount: payload.independentSourceCount,
      hasOfficialSource: payload.hasOfficialSource,
      verificationStatus: payload.verificationStatus,
      auditFlagsJson: payload.auditFlagsJson,
      auditVersion: payload.auditVersion,
      corroborationCount: payload.corroborationCount,
      aiSummary: payload.summary,
      aiEvidence: payload.evidence,
      url: payload.url,
      discoveredAt: payload.discoveredAt,
      keywords: payload.keywords.map((term) => ({ keyword: { term } }))
    });
    sortHotspotsByDiscoveredAt(collection);
    return { inserted: false, sourceType: payload.sourceType };
  }

  collection.push({
    id: payload.hotspotId,
    title: payload.title,
    sourceType: payload.sourceType,
    sourceAuthor: payload.sourceAuthor,
    sourcePublishedAt: payload.sourcePublishedAt,
    engagementJson: payload.engagementJson,
    aiIsReal: payload.isReal,
    aiImportance: payload.importance,
    heatScore: payload.heatScore,
    heatLabel: payload.heatLabel,
    matchedKeywords: payload.matchedKeywords || [],
    relevanceReason: payload.relevanceReason || '',
    keywordMentioned: payload.keywordMentioned ?? null,
    aiRelevance: payload.relevance,
    auditStatus: payload.auditStatus,
    aiConfidence: payload.aiConfidence,
    trustScore: payload.trustScore,
    sourceQualityScore: payload.sourceQualityScore,
    sourceAuthorityScore: payload.sourceAuthorityScore,
    authorityReason: payload.authorityReason,
    bodyAvailable: payload.bodyAvailable,
    feedbackSummary: payload.feedbackSummary,
    evidenceScore: payload.evidenceScore,
    corroborationScore: payload.corroborationScore,
    contradictionScore: payload.contradictionScore,
    independentSourceCount: payload.independentSourceCount,
    hasOfficialSource: payload.hasOfficialSource,
    verificationStatus: payload.verificationStatus,
    auditFlagsJson: payload.auditFlagsJson,
    auditVersion: payload.auditVersion,
    corroborationCount: payload.corroborationCount,
    aiSummary: payload.summary,
    aiEvidence: payload.evidence,
    url: payload.url,
    discoveredAt: payload.discoveredAt,
    keywords: payload.keywords.map((term) => ({ keyword: { term } })),
    notifications: []
  });
  sortHotspotsByDiscoveredAt(collection);
  return { inserted: true, sourceType: payload.sourceType };
}

function applyRealtimeCounts(store, sourceType, inserted, { isVerified = false } = {}) {
  if (!inserted) {
    return;
  }

  store.pagination.total = Number(store.pagination.total || 0) + 1;
  store.sourceCounts.all = Number(store.sourceCounts.all || 0) + 1;

  if (sourceType && sourceType in store.sourceCounts) {
    store.sourceCounts[sourceType] = Number(store.sourceCounts[sourceType] || 0) + 1;
  }

  store.latestScanInbox.total = Number(store.latestScanInbox.total || 0) + 1;

  if (isVerified) {
    store.summary.verifiedHotspots = Number(store.summary.verifiedHotspots || 0) + 1;
  }
}

export const useMonitorStore = defineStore('monitor', {
  state: () => ({
    keywords: [],
    hotspots: [],
    summary: {
      totalHotspots: 0,
      verifiedHotspots: 0,
      urgentHotspots: 0,
      activeKeywords: 0,
      latestDiscoveredAt: null
    },
    pagination: {
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1
    },
    sourceCounts: createSourceCounts(),
    settings: null,
    notifications: [],
    latestScanInbox: {
      scanJobId: null,
      trigger: null,
      scannedAt: null,
      unreadCount: 0,
      total: 0,
      items: []
    },
    systemHealth: null,
    sourceHealth: [],
    socketState: 'connecting',
    liveMessage: '等待连接实时通道',
    loading: false,
    scanStatus: {
      jobId: null,
      state: 'idle',
      running: false,
      trigger: null,
      startedAt: null,
      finishedAt: null,
      message: '',
      warning: '',
      error: null,
      result: null
    },
    latestScanToast: null,
    scanToastSequence: 0,
    socket: null,
    scanStatusPollTimer: null,
    searchPanel: {
      query: '',
      items: [],
      meta: {
        total: 0,
        sourceStats: {},
        searchedAt: null,
        enabledSources: [],
        expandedKeywords: []
      },
      loading: false
    },
    lastSourceStats: {
      bing: 0,
      'google-news': 0,
      'hacker-news': 0,
      twitter: 0,
      bilibili: 0,
      weibo: 0,
      'weibo-hot': 0,
      sogou: 0
    }
  }),
  actions: {
    async bootstrap() {
      await Promise.all([
        this.fetchKeywords(),
        this.fetchHotspots(),
        this.fetchSettings(),
        this.fetchNotifications(),
        this.fetchLatestScanInbox(),
        this.fetchSummary(),
        this.fetchHealth(),
        this.fetchSourceHealth(),
        this.fetchScanStatus()
      ]);

      if (this.scanStatus.running) {
        this.startScanStatusPolling();
      }

      if (!this.socket) {
        this.socket = createSocketHandlers({
          onHotspotNew: (payload) => {
            const result = mergeRealtimeHotspot(this.hotspots, payload);
            applyRealtimeCounts(this, result.sourceType, result.inserted, { isVerified: Boolean(payload.isReal) });
            this.summary.totalHotspots += result.inserted ? 1 : 0;
            this.liveMessage = `捕获新热点：${payload.title}`;
          },
          onScanItem: (payload) => {
            const isNewHotspot = payload.scanIsNew !== false;
            const result = mergeRealtimeHotspot(this.hotspots, payload);
            applyRealtimeCounts(this, result.sourceType, result.inserted && isNewHotspot, { isVerified: true });
            this.summary.totalHotspots += result.inserted && isNewHotspot ? 1 : 0;
            if (isNewHotspot && result.inserted) {
              this.scanToastSequence += 1;
              this.latestScanToast = {
                id: this.scanToastSequence,
                title: payload.title,
                scannedAt: payload.scannedAt || new Date().toISOString(),
                keywords: Array.isArray(payload.keywords) ? payload.keywords : []
              };
            }
            this.liveMessage = `新增相关热点：${payload.title}`;
          },
          onNotification: (payload) => {
            this.liveMessage = payload.message;
          },
          onLatestScan: async () => {
            await this.fetchLatestScanInbox();
          },
          onStateChange: (state) => {
            this.socketState = state;
          }
        });
      }
    },
    async fetchKeywords() {
      this.keywords = await api.getKeywords();
      this.socket?.subscribe(this.keywords.filter((item) => item.enabled).map((item) => item.term));
    },
    async addKeyword(term) {
      await api.createKeyword({ term });
      await this.fetchKeywords();
      await this.fetchSummary();
    },
    async toggleKeyword(keyword) {
      await api.updateKeyword(keyword.id, { enabled: !keyword.enabled });
      await this.fetchKeywords();
      await this.fetchSummary();
    },
    async renameKeyword(keyword, term) {
      await api.updateKeyword(keyword.id, { term });
      await this.fetchKeywords();
    },
    async removeKeyword(id) {
      await api.deleteKeyword(id);
      await this.fetchKeywords();
      await this.fetchSummary();
    },
    async fetchHotspots(params = {}) {
      const data = await api.getHotspots({
        page: this.pagination.page,
        pageSize: this.pagination.pageSize,
        status: 'all',
        ...params
      });
      this.hotspots = data.items;
      sortHotspotsByDiscoveredAt(this.hotspots);
      this.pagination = data.pagination;
      this.sourceCounts = createSourceCounts(data.meta?.sourceCounts || {});
    },
    async fetchSummary() {
      this.summary = await api.getSummary();
    },
    async fetchSettings() {
      this.settings = await api.getSettings();
    },
    async saveSettings(payload) {
      this.settings = await api.updateSettings(payload);
    },
    async fetchNotifications() {
      this.notifications = await api.getNotifications();
    },
    async fetchLatestScanInbox() {
      this.latestScanInbox = await api.getLatestScanInbox();
      return this.latestScanInbox;
    },
    async markLatestScanInboxItemRead(itemId) {
      const item = this.latestScanInbox.items.find((entry) => entry.id === itemId);
      if (!item || item.isRead) {
        return this.latestScanInbox;
      }

      item.isRead = true;
      this.latestScanInbox.unreadCount = Math.max(0, this.latestScanInbox.unreadCount - 1);

      try {
        this.latestScanInbox = await api.markLatestScanInboxItemRead(itemId);
        return this.latestScanInbox;
      } catch (error) {
        item.isRead = false;
        this.latestScanInbox.unreadCount += 1;
        throw error;
      }
    },
    async fetchHealth() {
      this.systemHealth = await api.getHealth();
    },
    async fetchSourceHealth() {
      this.sourceHealth = await api.getSourceHealth();
    },
    async searchAcrossSources(query) {
      const trimmedQuery = String(query || '').trim();
      if (!trimmedQuery) {
        throw new Error('请输入要搜索的关键词');
      }

      this.searchPanel.loading = true;
      try {
        const data = await api.exploreHotspots(trimmedQuery);
        this.searchPanel = {
          query: trimmedQuery,
          items: data.items || [],
          meta: {
            total: Number(data.meta?.total || 0),
            sourceStats: data.meta?.sourceStats || {},
            searchedAt: data.meta?.searchedAt || null,
            enabledSources: data.meta?.enabledSources || [],
            expandedKeywords: data.meta?.expandedKeywords || []
          },
          loading: false
        };
        this.liveMessage = `即时搜索完成，命中 ${this.searchPanel.meta.total} 条结果`;
        return data;
      } catch (error) {
        this.searchPanel.loading = false;
        throw error;
      }
    },
    async fetchScanStatus() {
      this.scanStatus = await api.getSearchStatus();
      this.loading = this.scanStatus.running;
      return this.scanStatus;
    },
    startScanStatusPolling() {
      if (this.scanStatusPollTimer) {
        return;
      }

      this.scanStatusPollTimer = setInterval(async () => {
        const previousState = this.scanStatus.state;
        const status = await this.fetchScanStatus();

        if (status.running) {
          this.liveMessage = status.message || '后台扫描进行中';
          return;
        }

        this.stopScanStatusPolling();

        if (previousState === 'running') {
          const result = status.result || {};
          this.lastSourceStats = {
            bing: Number(result.sourceStats?.bing || 0),
            'google-news': Number(result.sourceStats?.['google-news'] || 0),
            'hacker-news': Number(result.sourceStats?.['hacker-news'] || 0),
            twitter: Number(result.sourceStats?.twitter || 0),
            bilibili: Number(result.sourceStats?.bilibili || 0),
            weibo: Number(result.sourceStats?.weibo || 0),
            'weibo-hot': Number(result.sourceStats?.['weibo-hot'] || 0),
            sogou: Number(result.sourceStats?.sogou || 0)
          };

          if (status.state === 'succeeded') {
            const stats = Object.entries(result.sourceStats || {})
              .filter(([, count]) => count > 0)
              .map(([source, count]) => `${sourceLabels[source] || source}:${count}`)
              .join(' / ');
            const acceptedSummary =
              result.acceptedCount !== undefined ? `，展示 ${result.acceptedCount} 条` : '';
            const rejectedSummary =
              result.rejectedCount > 0 ? `，过滤 ${result.rejectedCount} 条低相关内容` : '';
            const providerSummary = result.aiProvider ? `，AI:${result.aiProvider}` : '';
            const warning = String(status.warning || '').trim();
            const resultSummary = `后台扫描完成，新增 ${result.createdCount || 0} 条热点${acceptedSummary}${rejectedSummary}${providerSummary}${stats ? `，来源 ${stats}` : ''}`;
            this.liveMessage = warning ? `${warning} ${resultSummary}` : resultSummary;
          } else if (status.state === 'failed') {
            this.liveMessage = status.error || '后台扫描失败';
          }

          await Promise.all([
            this.fetchHotspots(),
            this.fetchSummary(),
            this.fetchNotifications(),
            this.fetchLatestScanInbox(),
            this.fetchSourceHealth()
          ]);
        }
      }, 3000);
    },
    stopScanStatusPolling() {
      if (!this.scanStatusPollTimer) {
        return;
      }

      clearInterval(this.scanStatusPollTimer);
      this.scanStatusPollTimer = null;
    },
    async runSearch() {
      const result = await api.runSearch();
      this.scanStatus = result.status || this.scanStatus;
      this.loading = this.scanStatus.running;

      if (result.alreadyRunning) {
        this.liveMessage = this.scanStatus.message || '已有扫描任务在后台运行';
        this.startScanStatusPolling();
        return;
      }

      this.liveMessage = this.scanStatus.message || '已开始后台扫描';
      this.startScanStatusPolling();
    }
  }
});
