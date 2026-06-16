import { prisma } from '../db/prisma.js';

const VISIBLE_SOURCE_WHERE = {
  sourceType: {
    notIn: ['weibo', 'weibo-hot']
  }
};

export async function getDashboardSummary() {
  const [totalHotspots, verifiedHotspots, urgentHotspots, activeKeywords, latestHotspot] = await Promise.all([
    prisma.hotspotEvent.count(),
    prisma.hotspotEvent.count({ where: { verificationStatus: 'trusted' } }),
    prisma.hotspotEvent.count({
      where: {
        verificationStatus: 'trusted',
        importance: { in: ['high', 'urgent'] }
      }
    }),
    prisma.keyword.count({
      where: {
        enabled: true
      }
    }),
    prisma.hotspotEvent.findFirst({
      orderBy: {
        lastSeenAt: 'desc'
      }
    })
  ]);

  return {
    totalHotspots,
    verifiedHotspots,
    urgentHotspots,
    activeKeywords,
    latestDiscoveredAt: latestHotspot?.lastSeenAt || null
  };
}
