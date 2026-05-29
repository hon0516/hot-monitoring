import express from 'express';
import { getSettingsWithState, updateSettings } from '../services/settingsService.js';

export const settingsRouter = express.Router();

settingsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getSettingsWithState());
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/', async (req, res, next) => {
  try {
    res.json(await updateSettings(req.body));
  } catch (error) {
    next(error);
  }
});

