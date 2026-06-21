import express from 'express';
import {
  getCollectionStatus,
  getHotspotById,
  listHotspots,
  searchHotspotsAcrossSources,
  triggerCollection
} from '../services/hotspotService.js';
import { getDashboardSummary } from '../services/dashboardService.js';
import {
  getVerifiedEvent,
  getVerifiedEventEvidence,
  listVerifiedEvents,
  saveVerificationFeedback
} from '../services/deepVerificationService.js';

export const hotspotRouter = express.Router();

hotspotRouter.get('/', async (req, res, next) => {
  try {
    const data = await listVerifiedEvents(req.query);
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
    const item = await getVerifiedEvent(Number(req.params.id));
    if (!item) {
      res.status(404).json({ message: '热点不存在' });
      return;
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
});

hotspotRouter.get('/:id/evidence', async (req, res, next) => {
  try {
    const item = await getVerifiedEventEvidence(Number(req.params.id));
    if (!item) {
      res.status(404).json({ message: '热点内容详情不存在' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
});

hotspotRouter.post('/:id/feedback', async (req, res, next) => {
  try {
    res.status(201).json(await saveVerificationFeedback(Number(req.params.id), req.body));
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

hotspotRouter.post('/explore', async (req, res, next) => {
  try {
    res.json(
      await searchHotspotsAcrossSources({
        query: req.body?.query
      })
    );
  } catch (error) {
    next(error);
  }
});
