import { prisma } from '../db/prisma.js';
import { projectEvent } from './deepVerificationService.js';

const INBOX_ID = 1;
const VISIBLE_STATUSES = new Set(['trusted', 'needs_review']);

function uniqueVisibleEventIds(items = []) {
  return [
    ...new Set(
      items
        .filter((item) => VISIBLE_STATUSES.has(item?.verificationStatus))
        .map((item) => Number(item.id))
        .filter(Number.isInteger)
    )
  ];
}

function serializeInbox(inbox) {
  const items = (inbox?.items || []).map((item) => ({
    id: item.id,
    isRead: item.isRead,
    capturedAt: item.capturedAt,
    event: projectEvent(item.event)
  }));

  return {
    scanJobId: inbox?.scanJobId || null,
    trigger: inbox?.trigger || null,
    scannedAt: inbox?.scannedAt || null,
    unreadCount: items.filter((item) => !item.isRead).length,
    total: items.length,
    items
  };
}

const inboxInclude = {
  items: {
    include: {
      event: {
        include: {
          keywords: { include: { keyword: true } },
          sourceItems: { orderBy: { discoveredAt: 'asc' } },
          claims: true
        }
      }
    },
    orderBy: [
      { event: { trustScore: 'desc' } },
      { event: { relevanceScore: 'desc' } },
      { capturedAt: 'desc' }
    ]
  }
};

export async function replaceLatestScanInbox({ scanJobId, trigger, scannedAt = new Date(), items = [] }) {
  const eventIds = uniqueVisibleEventIds(items);

  await prisma.$transaction(async (tx) => {
    await tx.latestScanInbox.upsert({
      where: { id: INBOX_ID },
      update: {
        scanJobId: String(scanJobId || ''),
        trigger,
        scannedAt
      },
      create: {
        id: INBOX_ID,
        scanJobId: String(scanJobId || ''),
        trigger,
        scannedAt
      }
    });

    await tx.latestScanInboxItem.deleteMany({
      where: { inboxId: INBOX_ID }
    });

    if (eventIds.length) {
      await tx.latestScanInboxItem.createMany({
        data: eventIds.map((eventId) => ({
          inboxId: INBOX_ID,
          eventId,
          capturedAt: scannedAt,
          isRead: false
        }))
      });
    }
  });

  return getLatestScanInbox();
}

export async function getLatestScanInbox() {
  const inbox = await prisma.latestScanInbox.findUnique({
    where: { id: INBOX_ID },
    include: inboxInclude
  });

  return serializeInbox(inbox);
}

export async function markLatestScanInboxItemRead(itemId) {
  await prisma.latestScanInboxItem.updateMany({
    where: {
      id: Number(itemId),
      inboxId: INBOX_ID,
      isRead: false
    },
    data: { isRead: true }
  });

  return getLatestScanInbox();
}
