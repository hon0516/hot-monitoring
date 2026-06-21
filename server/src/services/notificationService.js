import { prisma } from '../db/prisma.js';
import { configState } from '../config/env.js';
import { sendHotspotEmail } from './mailerService.js';
import { socketHub } from '../ws/socketHub.js';

export async function logNotification({ hotspotId, channel, status, recipient = null, errorMessage = null }) {
  return prisma.notificationLog.create({
    data: {
      hotspotId,
      channel,
      status,
      recipient,
      errorMessage
    }
  });
}

export async function dispatchNotifications({ hotspot, settings, trigger = 'schedule' }) {
  const keywords = hotspot.keywords.map((item) => item.keyword.term);

  if (settings.websocketEnabled && trigger !== 'manual') {
    socketHub.broadcast('hotspot:new', hotspot);
    socketHub.notify(`发现高价值热点：${hotspot.title}`, hotspot);
    await logNotification({
      hotspotId: hotspot.id,
      channel: 'websocket',
      status: 'sent'
    });
  }

  if (settings.emailEnabled && settings.recipientEmail) {
    try {
      if (!configState.hasSmtpConfig) {
        throw new Error('SMTP 未配置');
      }

      await sendHotspotEmail({
        recipient: settings.recipientEmail,
        hotspot,
        keywords
      });

      await logNotification({
        hotspotId: hotspot.id,
        channel: 'email',
        status: 'sent',
        recipient: settings.recipientEmail
      });
    } catch (error) {
      await logNotification({
        hotspotId: hotspot.id,
        channel: 'email',
        status: 'failed',
        recipient: settings.recipientEmail,
        errorMessage: error.message
      });
    }
  }
}

export async function dispatchEventNotifications({ event, hotspot, settings, trigger = 'schedule' }) {
  const keywords = hotspot.keywords.map((item) => item.keyword?.term || item.term).filter(Boolean);
  const blockingFeedbackCount = await prisma.verificationFeedback.count({
    where: {
      eventId: event.id,
      type: { in: ['false_positive', 'cluster_error', 'evidence_error'] }
    }
  });

  if (blockingFeedbackCount > 0) {
    return;
  }

  const existing = await prisma.eventNotificationLog.findMany({
    where: {
      eventId: event.id,
      status: 'sent'
    },
    select: { channel: true }
  });
  const sentChannels = new Set(existing.map((item) => item.channel));

  if (settings.websocketEnabled && trigger !== 'manual' && !sentChannels.has('websocket')) {
    socketHub.broadcast('hotspot:new', hotspot);
    socketHub.notify(`发现相关热点：${hotspot.title}`, hotspot);
    await prisma.eventNotificationLog.create({
      data: { eventId: event.id, channel: 'websocket', status: 'sent' }
    });
  }

  if (settings.emailEnabled && settings.recipientEmail && !sentChannels.has('email')) {
    try {
      if (!configState.hasSmtpConfig) throw new Error('SMTP 未配置');
      await sendHotspotEmail({
        recipient: settings.recipientEmail,
        hotspot,
        keywords
      });
      await prisma.eventNotificationLog.create({
        data: {
          eventId: event.id,
          channel: 'email',
          status: 'sent',
          recipient: settings.recipientEmail
        }
      });
    } catch (error) {
      await prisma.eventNotificationLog.create({
        data: {
          eventId: event.id,
          channel: 'email',
          status: 'failed',
          recipient: settings.recipientEmail,
          errorMessage: error.message
        }
      });
    }
  }
}
