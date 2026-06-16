import { buildHotspotSummary } from '../services/aiService.js';
import { calculateHeatScore, getHeatLabel } from '../utils/heat.js';

function buildRealtimeSummary(hotspot) {
  const keyword = hotspot.keywords?.[0]?.keyword?.term || hotspot.keywords?.[0]?.term || null;
  return buildHotspotSummary({
    value: hotspot.aiSummary,
    item: {
      title: hotspot.title,
      snippet: hotspot.snippet
    },
    keyword
  });
}

class SocketHub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  attach(wss) {
    this.wss = wss;

    wss.on('connection', (socket) => {
      socket.subscriptions = new Set();
      this.clients.add(socket);

      socket.send(JSON.stringify({ event: 'notification', payload: { message: '实时连接已建立' } }));

      socket.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.event === 'subscribe' && Array.isArray(message.payload?.keywords)) {
            socket.subscriptions = new Set(message.payload.keywords.map((item) => String(item).trim()).filter(Boolean));
          }
          if (message.event === 'unsubscribe' && Array.isArray(message.payload?.keywords)) {
            message.payload.keywords.forEach((keyword) => socket.subscriptions.delete(String(keyword).trim()));
          }
        } catch {
          // 忽略无效消息
        }
      });

      socket.on('close', () => {
        this.clients.delete(socket);
      });
    });
  }

  serializeHotspot(hotspot) {
    const heatScore = calculateHeatScore(hotspot);

    return {
      hotspotId: hotspot.id,
      title: hotspot.title,
      sourceType: hotspot.sourceType,
      sourceAuthor: hotspot.sourceAuthor || '',
      sourcePublishedAt: hotspot.sourcePublishedAt || null,
      engagementJson: hotspot.engagementJson || null,
      isReal: hotspot.aiIsReal ?? null,
      importance: hotspot.aiImportance || null,
      heatScore,
      heatLabel: getHeatLabel(heatScore),
      relevance: hotspot.aiRelevance ?? null,
      auditStatus: hotspot.auditStatus || null,
      aiConfidence: hotspot.aiConfidence ?? null,
      trustScore: hotspot.trustScore ?? null,
      sourceQualityScore: hotspot.sourceQualityScore ?? null,
      evidenceScore: hotspot.evidenceScore ?? null,
      corroborationScore: hotspot.corroborationScore ?? null,
      contradictionScore: hotspot.contradictionScore ?? null,
      independentSourceCount: hotspot.independentSourceCount ?? hotspot.corroborationCount ?? 0,
      hasOfficialSource: Boolean(hotspot.hasOfficialSource),
      verificationStatus: hotspot.verificationStatus || null,
      auditFlagsJson: hotspot.auditFlagsJson || null,
      auditVersion: hotspot.auditVersion || null,
      corroborationCount: hotspot.corroborationCount ?? 0,
      summary: buildRealtimeSummary(hotspot),
      evidence: hotspot.aiEvidence || '',
      url: hotspot.url,
      discoveredAt: hotspot.discoveredAt,
      keywords: hotspot.keywords?.map((item) => item.keyword?.term || item.term).filter(Boolean) || []
    };
  }

  shouldDeliver(socket, payload) {
    if (!socket.subscriptions?.size) {
      return true;
    }

    return payload.keywords.some((keyword) => socket.subscriptions.has(keyword));
  }

  broadcast(event, hotspot) {
    const payload = this.serializeHotspot(hotspot);
    const message = JSON.stringify({ event, payload });

    this.clients.forEach((socket) => {
      if (socket.readyState !== 1) {
        return;
      }

      if (!this.shouldDeliver(socket, payload)) {
        return;
      }

      socket.send(message);
    });
  }

  notify(message, hotspot) {
    const payload = hotspot ? this.serializeHotspot(hotspot) : {};
    const packet = JSON.stringify({
      event: 'notification',
      payload: {
        ...payload,
        message
      }
    });

    this.clients.forEach((socket) => {
      if (socket.readyState === 1) {
        socket.send(packet);
      }
    });
  }

  publishLatestScan(inbox) {
    const packet = JSON.stringify({
      event: 'scan:latest',
      payload: {
        scanJobId: inbox.scanJobId,
        trigger: inbox.trigger,
        scannedAt: inbox.scannedAt,
        unreadCount: inbox.unreadCount,
        total: inbox.total
      }
    });

    this.clients.forEach((socket) => {
      if (socket.readyState === 1) {
        socket.send(packet);
      }
    });
  }
}

export const socketHub = new SocketHub();
