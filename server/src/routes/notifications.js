import express from 'express';
import { prisma } from '../db/prisma.js';
import { getLatestScanInbox, markLatestScanInboxItemRead } from '../services/latestScanInboxService.js';

export const notificationRouter = express.Router();

notificationRouter.get('/', async (_req, res, next) => {
  try {
    const [legacyItems, eventItems] = await Promise.all([
      prisma.notificationLog.findMany({
        include: { hotspot: true },
        orderBy: { sentAt: 'desc' },
        take: 50
      }),
      prisma.eventNotificationLog.findMany({
        include: { event: true },
        orderBy: { sentAt: 'desc' },
        take: 50
      })
    ]);
    const items = [
      ...legacyItems,
      ...eventItems.map((item) => ({
        ...item,
        hotspotId: null,
        hotspot: {
          id: item.event.id,
          title: item.event.title,
          url: item.event.primaryUrl,
          sourceType: item.event.primarySourceType
        }
      }))
    ]
      .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())
      .slice(0, 50);

    res.json(items);
  } catch (error) {
    next(error);
  }
});

notificationRouter.get('/latest-scan', async (_req, res, next) => {
  try {
    res.json(await getLatestScanInbox());
  } catch (error) {
    next(error);
  }
});

notificationRouter.post('/latest-scan/items/:itemId/read', async (req, res, next) => {
  try {
    res.json(await markLatestScanInboxItemRead(req.params.itemId));
  } catch (error) {
    next(error);
  }
});
