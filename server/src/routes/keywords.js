import express from 'express';
import { createKeyword, deleteKeyword, listKeywords, updateKeyword } from '../services/keywordService.js';

export const keywordRouter = express.Router();

keywordRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listKeywords());
  } catch (error) {
    next(error);
  }
});

keywordRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createKeyword(req.body));
  } catch (error) {
    next(error);
  }
});

keywordRouter.put('/:id', async (req, res, next) => {
  try {
    res.json(await updateKeyword(Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

keywordRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteKeyword(Number(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

