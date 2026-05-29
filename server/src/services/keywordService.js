import { prisma } from '../db/prisma.js';

export async function listKeywords() {
  return prisma.keyword.findMany({
    orderBy: { createdAt: 'desc' }
  });
}

export async function createKeyword(payload) {
  const term = payload.term?.trim();
  if (!term) {
    throw new Error('关键词不能为空');
  }

  return prisma.keyword.create({
    data: {
      term,
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true
    }
  });
}

export async function updateKeyword(id, payload) {
  const data = {};
  if (typeof payload.term === 'string') {
    const term = payload.term.trim();
    if (!term) {
      throw new Error('关键词不能为空');
    }
    data.term = term;
  }
  if (typeof payload.enabled === 'boolean') {
    data.enabled = payload.enabled;
  }

  return prisma.keyword.update({
    where: { id },
    data
  });
}

export async function deleteKeyword(id) {
  return prisma.keyword.delete({
    where: { id }
  });
}

