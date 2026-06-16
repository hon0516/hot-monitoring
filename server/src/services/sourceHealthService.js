import { prisma } from '../db/prisma.js';

function statusFromError(error) {
  const message = String(error?.message || '');
  if (/429|rate limit|too many requests/iu.test(message)) return 'rate_limited';
  if (/401|403|412|验证码|blocked|访问受限/iu.test(message)) return 'blocked';
  return 'error';
}

export async function recordSourceHealth({
  sourceType,
  startedAt,
  candidateCount = 0,
  filteredCount = 0,
  error = null
}) {
  const now = new Date();
  const durationMs = Math.max(0, now.getTime() - new Date(startedAt).getTime());
  const status = error ? statusFromError(error) : candidateCount > 0 ? 'healthy' : 'empty';

  return prisma.sourceHealth.upsert({
    where: { sourceType },
    update: {
      status,
      lastAttemptAt: now,
      lastSuccessAt: error ? undefined : now,
      durationMs,
      candidateCount,
      filteredCount,
      errorMessage: error ? String(error.message || error).slice(0, 500) : null
    },
    create: {
      sourceType,
      status,
      lastAttemptAt: now,
      lastSuccessAt: error ? null : now,
      durationMs,
      candidateCount,
      filteredCount,
      errorMessage: error ? String(error.message || error).slice(0, 500) : null
    }
  });
}

export function listSourceHealth() {
  return prisma.sourceHealth.findMany({
    orderBy: { sourceType: 'asc' }
  });
}
