import nodemailer from 'nodemailer';
import { configState, env } from '../config/env.js';
import { calculateHeatScore, getHeatLabel } from '../utils/heat.js';

let transporter = null;

function getTransporter() {
  if (!configState.hasSmtpConfig) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });
  }

  return transporter;
}

export async function sendHotspotEmail({ recipient, hotspot, keywords }) {
  const client = getTransporter();
  if (!client) {
    throw new Error('SMTP 未配置');
  }

  const heatScore = calculateHeatScore(hotspot);
  const heatText = `${getHeatLabel(heatScore)} ${heatScore}`;

  return client.sendMail({
    from: env.smtpFrom,
    to: recipient,
    subject: `[热点监控] ${hotspot.title}`,
    text: `
发现新热点

标题：${hotspot.title}
来源：${hotspot.sourceType}
关键词：${keywords.join(', ')}
热度：${heatText}
相关性：${hotspot.aiRelevance ?? 'unknown'}
摘要：${hotspot.aiSummary || hotspot.snippet || '暂无'}
判断依据：${hotspot.aiEvidence || '暂无'}
链接：${hotspot.url}
    `.trim(),
    html: `
      <h2>发现新热点</h2>
      <p><strong>标题：</strong>${hotspot.title}</p>
      <p><strong>来源：</strong>${hotspot.sourceType}</p>
      <p><strong>关键词：</strong>${keywords.join(', ')}</p>
      <p><strong>热度：</strong>${heatText}</p>
      <p><strong>相关性：</strong>${hotspot.aiRelevance ?? 'unknown'}</p>
      <p><strong>摘要：</strong>${hotspot.aiSummary || hotspot.snippet || '暂无'}</p>
      <p><strong>判断依据：</strong>${hotspot.aiEvidence || '暂无'}</p>
      <p><a href="${hotspot.url}">查看原文</a></p>
    `
  });
}
