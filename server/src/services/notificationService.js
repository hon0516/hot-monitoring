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
