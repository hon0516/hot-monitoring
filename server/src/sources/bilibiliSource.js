import * as cheerio from 'cheerio';
import { env } from '../config/env.js';
import { dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';
import { fetchJson, fetchText, normalizeText, safeJsonStringify, stripHtml, toIsoString } from './sourceClient.js';

export function mapBilibiliSearchResults(items = []) {
  return items
    .filter((item) => item?.type === 'video' && item.arcurl && item.title)
    .map((item) => ({
      title: stripHtml(item.title),
      snippet: stripHtml(item.description || item.tag || ''),
      url: String(item.arcurl).replace(/^http:\/\//i, 'https://'),
      sourceType: 'bilibili',
      sourceAuthor: item.author || '哔哩哔哩',
      sourcePublishedAt: toIsoString(item.pubdate),
      engagementJson: safeJsonStringify({
        views: Number(item.play || 0),
        likes: Number(item.like || 0),
        comments: Number(item.review || 0),
        replies: Number(item.video_review || item.danmaku || 0),
        favorites: Number(item.favorites || 0)
      })
    }));
}

export function parseBilibiliSearchHtml(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a[href*="/video/BV"]').each((_, element) => {
    const href = $(element).attr('href');
    const rawTitle = $(element).attr('title') || $(element).text();
    const title = stripHtml(rawTitle);

    if (!href || !title) {
      return;
    }

    const normalizedUrl = String(href)
      .replace(/^\/\//, 'https://')
      .replace(/^http:\/\//i, 'https://')
      .replace(/^(?!https?:\/\/)/, 'https://search.bilibili.com');

    if (!/\/video\/BV/i.test(normalizedUrl) || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);

    const container = $(element).closest('li, .bili-video-card, .video-item, .search-all-list, .bili-video-card__wrap');
    const author =
      normalizeText(
        container.find('.up-name, .bili-video-card__info--author, .bili-video-card__info-owner, .author-name').first().text()
      ) || '哔哩哔哩';
    const snippet = normalizeText(
      container
        .find('.desc, .bili-video-card__info--desc, .bili-video-card__info--bottom, .hit-desc')
        .first()
        .text()
    );
    const publishedText = normalizeText(
      container
        .find('.time, .bili-video-card__info--date, .bili-video-card__stats__text, .so-icon.time')
        .first()
        .text()
    );

    items.push({
      title,
      snippet,
      url: normalizedUrl,
      sourceType: 'bilibili',
      sourceAuthor: author,
      sourcePublishedAt: toIsoString(publishedText),
      engagementJson: null
    });
  });

  return items;
}

function buildBilibiliHeaders() {
  return {
    Referer: 'https://search.bilibili.com/',
    Origin: 'https://search.bilibili.com',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    ...(env.bilibiliCookie ? { Cookie: env.bilibiliCookie } : {})
  };
}

function isBilibiliChallengePage(content) {
  const text = String(content || '');
  return /验证码_哔哩哔哩|错误号:\s*412|risk-captcha-app|出错啦!\s*-\s*bilibili\.com/iu.test(text);
}

export async function searchBilibili({ keyword, scope }) {
  const query = [keyword, scope].filter(Boolean).join(' ').trim();
  if (!query) {
    return [];
  }

  const attemptQueries = [...new Set([query, String(keyword || '').trim()].filter(Boolean))];
  let lastError = null;

  for (const attemptQuery of attemptQueries) {
    const apiUrl = new URL('https://api.bilibili.com/x/web-interface/search/type');
    apiUrl.searchParams.set('search_type', 'video');
    apiUrl.searchParams.set('keyword', attemptQuery);
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('order', 'pubdate');

    try {
      const payload = await fetchJson(apiUrl, { headers: buildBilibiliHeaders() });

      const results = Array.isArray(payload?.data?.result) ? payload.data.result : [];
      return dedupeSourceItems(filterRecentSourceItems(mapBilibiliSearchResults(results))).slice(0, 10);
    } catch (error) {
      lastError = error;
      const isPreconditionFailed = /412/.test(String(error?.message || ''));
      if (!isPreconditionFailed) {
        throw error;
      }

      try {
        const html = await fetchText(`https://search.bilibili.com/all?keyword=${encodeURIComponent(attemptQuery)}`, {
          headers: {
            ...buildBilibiliHeaders(),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate'
          }
        });

        if (isBilibiliChallengePage(html)) {
          continue;
        }

        const parsedItems = parseBilibiliSearchHtml(html);
        if (parsedItems.length > 0) {
          return dedupeSourceItems(filterRecentSourceItems(parsedItems)).slice(0, 10);
        }
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
  }

  if (/412/.test(String(lastError?.message || ''))) {
    return [];
  }

  throw lastError;
}
