import express from 'express';
import { getCollectionStatus, getHotspotById, listHotspots, triggerCollection } from '../services/hotspotService.js';
import { getDashboardSummary } from '../services/dashboardService.js';

export const hotspotRouter = express.Router();

hotspotRouter.get('/', async (req, res, next) => {
  try {
    const data = await listHotspots(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

hotspotRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await getDashboardSummary());
  } catch (error) {
    next(error);
  }
});

hotspotRouter.get('/:id', async (req, res, next) => {
  try {
    const item = await getHotspotById(Number(req.params.id));
    if (!item) {
      res.status(404).json({ message: '热点不存在' });
      return;
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
});

hotspotRouter.post('/search', async (_req, res, next) => {
  try {
    const result = triggerCollection({ trigger: 'manual' });
    res.status(result.accepted ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

hotspotRouter.get('/search/status', async (_req, res, next) => {
  try {
    res.json(getCollectionStatus());
  } catch (error) {
    next(error);
  }
});
