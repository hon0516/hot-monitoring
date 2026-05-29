import cors from 'cors';
import express from 'express';
import { configState, env } from './config/env.js';
import { hotspotRouter } from './routes/hotspots.js';
import { keywordRouter } from './routes/keywords.js';
import { notificationRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: ['http://localhost:5173', env.allowedOrigin]
    })
  );
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      configState
    });
  });

  app.use('/api/keywords', keywordRouter);
  app.use('/api/hotspots', hotspotRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/notifications', notificationRouter);

  app.use((error, _req, res, _next) => {
    const status = error.code === 'P2002' ? 409 : 400;
    res.status(status).json({
      message: error.message || '服务器错误'
    });
  });

  return app;
}

