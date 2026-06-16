import express from 'express';
import { listSourceHealth } from '../services/sourceHealthService.js';

export const sourceRouter = express.Router();

sourceRouter.get('/health', async (_req, res, next) => {
  try {
    res.json(await listSourceHealth());
  } catch (error) {
    next(error);
  }
});
