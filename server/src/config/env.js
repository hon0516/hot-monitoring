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

const firstNonEmpty = (...values) =>
  values.map((value) => String(value || '').trim()).find(Boolean) || '';

export const env = {
  port: toInt(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  tencentTokenHubApiKey: process.env.TENCENT_TOKENHUB_API_KEY || '',
  tencentTokenHubBaseUrl: process.env.TENCENT_TOKENHUB_BASE_URL || 'https://tokenhub.tencentmaas.com/v1',
  tencentTokenHubModel: process.env.TENCENT_TOKENHUB_MODEL || 'deepseek-v4-pro-202606',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  aiReviewMode: ['cost_saver', 'balanced'].includes(String(process.env.AI_REVIEW_MODE || '').trim())
    ? String(process.env.AI_REVIEW_MODE || '').trim()
    : 'cost_saver',
  aiAnalysisTimeoutMs: Math.min(120000, Math.max(5000, toInt(process.env.AI_ANALYSIS_TIMEOUT_MS, 30000))),
  aiAnalysisMaxItemsPerRun: Math.min(500, Math.max(10, toInt(process.env.AI_ANALYSIS_MAX_ITEMS_PER_RUN, 80))),
  aiAnalysisManualMaxItemsPerRun: Math.min(500, Math.max(5, toInt(process.env.AI_ANALYSIS_MANUAL_MAX_ITEMS_PER_RUN, 30))),
  aiAnalysisConcurrency: Math.min(8, Math.max(1, toInt(process.env.AI_ANALYSIS_CONCURRENCY, 3))),
  aiAnalysisManualConcurrency: Math.min(8, Math.max(1, toInt(process.env.AI_ANALYSIS_MANUAL_CONCURRENCY, 4))),
  corroborationMaxQueries: Math.min(8, Math.max(1, toInt(process.env.CORROBORATION_MAX_QUERIES, 5))),
  corroborationMaxArticles: Math.min(10, Math.max(1, toInt(process.env.CORROBORATION_MAX_ARTICLES, 6))),
  corroborationFetchTimeoutMs: Math.min(15000, Math.max(3000, toInt(process.env.CORROBORATION_FETCH_TIMEOUT_MS, 8000))),
  quickScanCorroborationMinRelevance: Math.min(100, Math.max(0, toInt(process.env.QUICK_SCAN_CORROBORATION_MIN_RELEVANCE, 75))),
  sourceMaxAgeDays: Math.min(30, Math.max(1, toInt(process.env.SOURCE_MAX_AGE_DAYS, 3))),
  hotspotMaxAgeDays: Math.min(30, Math.max(1, toInt(process.env.HOTSPOT_MAX_AGE_DAYS, 3))),
  twitterApiKey: process.env.TWITTERAPI_IO_KEY || '',
  twitterSourceEnabled: toBoolean(process.env.TWITTER_SOURCE_ENABLED, true),
  bilibiliCookie: process.env.BILIBILI_COOKIE || '',
  weiboCookie: process.env.WEIBO_COOKIE || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: toInt(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  outboundHttpProxy:
    firstNonEmpty(process.env.OUTBOUND_HTTP_PROXY, process.env.HTTP_PROXY, process.env.http_proxy, process.env.OUTBOUND_PROXY_URL),
  outboundHttpsProxy:
    firstNonEmpty(process.env.OUTBOUND_HTTPS_PROXY, process.env.HTTPS_PROXY, process.env.https_proxy, process.env.OUTBOUND_PROXY_URL),
  outboundNoProxy: firstNonEmpty(process.env.OUTBOUND_NO_PROXY, process.env.NO_PROXY, process.env.no_proxy),
  allowedOrigin: process.env.VITE_API_BASE ? new URL(process.env.VITE_API_BASE).origin : 'http://localhost:5173',
  embeddingEnabled: toBoolean(process.env.EMBEDDING_ENABLED, true),
  embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/multilingual-e5-small',
  embeddingDtype: process.env.EMBEDDING_DTYPE || 'q8',
  embeddingOffline: toBoolean(process.env.EMBEDDING_OFFLINE, false),
  embeddingSimilarityRange: {
    floor: Number.isFinite(Number.parseFloat(process.env.EMBEDDING_SIMILARITY_FLOOR))
      ? Number.parseFloat(process.env.EMBEDDING_SIMILARITY_FLOOR)
      : 0.78,
    ceil: Number.isFinite(Number.parseFloat(process.env.EMBEDDING_SIMILARITY_CEIL))
      ? Number.parseFloat(process.env.EMBEDDING_SIMILARITY_CEIL)
      : 0.9
  }
};

export const configState = {
  hasTencentTokenHubKey: Boolean(env.tencentTokenHubApiKey),
  hasOpenRouterKey: Boolean(env.openRouterApiKey),
  hasTwitterApiKey: Boolean(env.twitterApiKey),
  hasBilibiliCookie: Boolean(env.bilibiliCookie),
  hasWeiboCookie: Boolean(env.weiboCookie),
  twitterSourceRuntimeEnabled: env.twitterSourceEnabled,
  hasSmtpConfig: Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFrom),
  outboundProxyConfigured: Boolean(env.outboundHttpProxy || env.outboundHttpsProxy)
};
