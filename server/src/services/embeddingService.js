import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_EMBED_CHARS = 1600;

let extractorPromise = null;
let embeddingDisabled = false;
const referenceCache = new Map();

function isEnabled() {
  return env.embeddingEnabled && !embeddingDisabled;
}

async function getExtractor() {
  if (extractorPromise) {
    return extractorPromise;
  }

  extractorPromise = (async () => {
    const { pipeline, env: hfEnv } = await import('@huggingface/transformers');
    hfEnv.cacheDir = path.resolve(__dirname, '../../.cache/transformers');
    if (env.embeddingOffline) {
      hfEnv.allowRemoteModels = false;
    }
    // 量化模型体积/内存远小于 fp32，用于相关性闸足够
    return pipeline('feature-extraction', env.embeddingModel, { dtype: env.embeddingDtype });
  })().catch((error) => {
    embeddingDisabled = true;
    extractorPromise = null;
    console.error('[embedding] 模型加载失败，已退回非语义模式', error.message);
    throw error;
  });

  return extractorPromise;
}

function truncate(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_EMBED_CHARS ? normalized.slice(0, MAX_EMBED_CHARS) : normalized;
}

async function embed(text, prefix) {
  if (!isEnabled()) {
    return null;
  }

  const content = truncate(text);
  if (!content) {
    return null;
  }

  try {
    const extractor = await getExtractor();
    const output = await extractor(`${prefix}${content}`, { pooling: 'mean', normalize: true });
    const vector = typeof output?.tolist === 'function' ? output.tolist()[0] : Array.from(output?.data || []);
    return Array.isArray(vector) && vector.length ? vector : null;
  } catch (error) {
    console.error('[embedding] 向量计算失败', error.message);
    return null;
  }
}

// e5 系列模型要求查询用 "query:"、被检索文本用 "passage:" 前缀
export function embedQuery(text) {
  return embed(text, 'query: ');
}

export function embedPassage(text) {
  return embed(text, 'passage: ');
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) {
    return null;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return null;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getReferenceVector(referenceText) {
  const key = String(referenceText || '').trim().toLowerCase();
  if (!key) {
    return null;
  }

  if (referenceCache.has(key)) {
    return referenceCache.get(key);
  }

  const vector = await embedQuery(referenceText);
  if (vector) {
    referenceCache.set(key, vector);
  }
  return vector;
}

function similarityToScore(similarity) {
  if (similarity === null) {
    return null;
  }

  const { floor, ceil } = env.embeddingSimilarityRange;
  const ratio = (similarity - floor) / Math.max(1e-6, ceil - floor);
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/**
 * 计算「监控语境(关键词/scope)」与「候选内容」的语义相关性，返回 0-100。
 * 当语义模型不可用时返回 null，调用方需自行回退到非语义判断。
 */
export async function semanticRelevanceScore(referenceText, candidateText) {
  if (!isEnabled()) {
    return null;
  }

  const referenceVector = await getReferenceVector(referenceText);
  const candidateVector = await embedPassage(candidateText);
  if (!referenceVector || !candidateVector) {
    return null;
  }

  return similarityToScore(cosineSimilarity(referenceVector, candidateVector));
}

export function isEmbeddingEnabled() {
  return isEnabled();
}

export function resetEmbeddingCacheForTest() {
  referenceCache.clear();
}
