import { prisma } from '../db/prisma.js';

const VISIBLE_SOURCE_WHERE = {
  sourceType: {
    notIn: ['weibo', 'weibo-hot']
  }
};

export async function getDashboardSummary() {
  const [
    totalHotspots,
    verifiedHotspots,
    urgentHotspots,
    activeKeywords,
    latestHotspot,
    totalSourceItems,
    fetchedSourceItems,
    falsePositiveFeedbackCount,
    blockedSourceCount,
    rateLimitedSourceCount
  ] = await Promise.all([
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
    }),
    prisma.hotspotSourceItem.count(),
    prisma.hotspotSourceItem.count({ where: { fetchStatus: 'fetched' } }),
    prisma.verificationFeedback.count({ where: { type: 'false_positive' } }),
    prisma.sourceHealth.count({ where: { status: 'blocked' } }),
    prisma.sourceHealth.count({ where: { status: 'rate_limited' } })
  ]);
  const trustedRate = totalHotspots ? Math.round((verifiedHotspots / totalHotspots) * 100) : 0;
  const bodyFetchSuccessRate = totalSourceItems ? Math.round((fetchedSourceItems / totalSourceItems) * 100) : 0;

  return {
    totalHotspots,
    verifiedHotspots,
    urgentHotspots,
    activeKeywords,
    latestDiscoveredAt: latestHotspot?.lastSeenAt || null,
    trustedRate,
    bodyFetchSuccessRate,
    falsePositiveFeedbackCount,
    blockedSourceCount,
    rateLimitedSourceCount
  };
}
