import http from 'node:http';
import { WebSocketServer } from 'ws';
import { env } from './config/env.js';
import { configureFetchProxy } from './config/fetchProxy.js';
import { prisma } from './db/prisma.js';
import { createApp } from './app.js';
import { ensureSettings } from './services/settingsService.js';
import { startCollectionScheduler } from './services/schedulerService.js';
import { socketHub } from './ws/socketHub.js';

configureFetchProxy();

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

socketHub.attach(wss);

async function bootstrap() {
  const settings = await ensureSettings();
  const scanIntervalMinutes = startCollectionScheduler(settings.scanIntervalMinutes);

  server.listen(env.port, () => {
    console.log(`Hot monitoring server listening on http://localhost:${env.port}`);
    console.log(`[cron] 自动扫描已启动，每 ${scanIntervalMinutes} 分钟执行一次`);
  });
}

bootstrap().catch(async (error) => {
  console.error('启动失败', error);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
