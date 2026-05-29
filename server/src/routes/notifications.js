import express from 'express';
import { prisma } from '../db/prisma.js';

export const notificationRouter = express.Router();

notificationRouter.get('/', async (_req, res, next) => {
  try {
    const items = await prisma.notificationLog.findMany({
      include: {
        hotspot: true
      },
      orderBy: {
        sentAt: 'desc'
      },
      take: 50
    });

    res.json(items);
  } catch (error) {
    next(error);
  }
});

