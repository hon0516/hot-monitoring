import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : rootEnvPath });
dotenv.config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

export const env = {
  port: toInt(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  tencentTokenHubApiKey: process.env.TENCENT_TOKENHUB_API_KEY || '',
  tencentTokenHubBaseUrl: process.env.TENCENT_TOKENHUB_BASE_URL || 'https://tokenhub.tencentmaas.com/v1',
  tencentTokenHubModel: process.env.TENCENT_TOKENHUB_MODEL || 'deepseek-v4-pro-202606',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  aiAnalysisTimeoutMs: Math.min(120000, Math.max(5000, toInt(process.env.AI_ANALYSIS_TIMEOUT_MS, 30000))),
  aiAnalysisMaxItemsPerRun: Math.min(500, Math.max(10, toInt(process.env.AI_ANALYSIS_MAX_ITEMS_PER_RUN, 80))),
  twitterApiKey: process.env.TWITTERAPI_IO_KEY || '',
  twitterSourceEnabled: toBoolean(process.env.TWITTER_SOURCE_ENABLED, true),
  bilibiliCookie: process.env.BILIBILI_COOKIE || '',
  weiboCookie: process.env.WEIBO_COOKIE || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: toInt(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  allowedOrigin: process.env.VITE_API_BASE ? new URL(process.env.VITE_API_BASE).origin : 'http://localhost:5173'
};

export const configState = {
  hasTencentTokenHubKey: Boolean(env.tencentTokenHubApiKey),
  hasOpenRouterKey: Boolean(env.openRouterApiKey),
  hasTwitterApiKey: Boolean(env.twitterApiKey),
  hasBilibiliCookie: Boolean(env.bilibiliCookie),
  hasWeiboCookie: Boolean(env.weiboCookie),
  twitterSourceRuntimeEnabled: env.twitterSourceEnabled,
  hasSmtpConfig: Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFrom)
};
