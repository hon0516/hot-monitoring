import crypto from 'node:crypto';
import { normalizeTitle } from '../utils/normalize.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'from',
  '发布', '宣布', '报道', '最新', '消息', '正式', '一个', '关于', '进行', '推出'
]);

function eventTokens(title) {
  return normalizeTitle(title)
    .split(/\s+/u)
    .flatMap((token) => (/[\u4e00-\u9fff]/u.test(token) && token.length > 2 ? [token, ...Array.from(token)] : [token]))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export function titleSimilarity(left, right) {
  const leftSet = new Set(eventTokens(left));
  const rightSet = new Set(eventTokens(right));
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

export function buildEventFingerprint(title) {
  const signature = [...new Set(eventTokens(title))].sort().slice(0, 16).join('|') || normalizeTitle(title);
  return crypto.createHash('sha256').update(signature).digest('hex');
}

export function findBestEventCluster(title, events, threshold = 0.58) {
  let best = null;
  for (const event of events) {
    const similarity = titleSimilarity(title, event.title);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { event, similarity };
    }
  }
  return best;
}
