import { prisma } from '../db/prisma.js';

export async function getDashboardSummary() {
  const analyzedWhere = {
    aiImportance: {
      not: null
    },
    aiRelevance: {
      not: null
    }
  };

  const [totalHotspots, verifiedHotspots, urgentHotspots, activeKeywords, latestHotspot] = await Promise.all([
    prisma.hotspot.count(),
    prisma.hotspot.count({
      where: {
        ...analyzedWhere,
        aiIsReal: true
      }
    }),
    prisma.hotspot.count({
      where: {
        ...analyzedWhere,
        aiImportance: {
          in: ['high', 'urgent']
        }
      }
    }),
    prisma.keyword.count({
      where: {
        enabled: true
      }
    }),
    prisma.hotspot.findFirst({
      orderBy: {
        discoveredAt: 'desc'
      }
    })
  ]);

  return {
    totalHotspots,
    verifiedHotspots,
    urgentHotspots,
    activeKeywords,
    latestDiscoveredAt: latestHotspot?.discoveredAt || null
  };
}
