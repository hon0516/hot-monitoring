import * as cheerio from 'cheerio';
import { configState, env } from '../config/env.js';
import { buildQueryVariants, dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';
import { fetchText, isChallengePage, parseCount, safeJsonStringify, stripHtml, toIsoString } from './sourceClient.js';
import { searchWeiboHot } from './weiboHotSource.js';

function resolveWeiboUrl(href) {
  if (!href) {
    return null;
  }

  if (href.startsWith('//')) {
    return `https:${href}`;
  }

  try {
    return new URL(href, 'https://s.weibo.com').toString();
  } catch {
    return href;
  }
}

function parseStatText(value) {
  const text = stripHtml(value).replace(/[^\d万亿w.]/giu, '');
  return parseCount(text);
}

export function parseWeiboRealtimePage(html) {
  if (!html || isChallengePage(html) || /<title>\s*登录\s*-\s*微博\s*<\/title>/iu.test(html)) {
    return [];
  }

  const $ = cheerio.load(html);
  const results = [];

  $('.card-wrap[action-type="feed_list_item"], .card-wrap[mid]').each((_, element) => {
    const contentNode =
      $(element).find('p[node-type="feed_list_content_full"]').first().length
        ? $(element).find('p[node-type="feed_list_content_full"]').first()
        : $(element).find('p[node-type="feed_list_content"]').first();
    const contentText = stripHtml(contentNode.html() || contentNode.text());
    const authorAnchor = $(element).find('.info .name, .info a[nick-name], a[namecard]').first();
    const author = stripHtml(authorAnchor.text());
    const title = contentText.slice(0, 120);
    const timeAnchor = $(element).find('.from a').first();
    const timeText = stripHtml(timeAnchor.text());
    const url = resolveWeiboUrl(timeAnchor.attr('href')) || resolveWeiboUrl(authorAnchor.attr('href'));
    const statNodes = $(element).find('.card-act ul li');

    if (!title || !url) {
      return;
    }

    const engagement = {
      comments: parseStatText($(statNodes[1]).text()),
      likes: parseStatText($(statNodes[2]).text()),
      reposts: parseStatText($(statNodes[0]).text())
    };

    results.push({
      title,
      snippet: contentText,
      url,
      sourceType: 'weibo',
      sourceAuthor: author || '微博搜索',
      sourcePublishedAt: toIsoString(timeText),
      engagementJson: safeJsonStringify(engagement)
    });
  });

  return results;
}

async function searchWeiboRealtimePage(query) {
  const url = new URL('https://s.weibo.com/weibo');
  url.searchParams.set('q', query);
  url.searchParams.set('rd', 'realtime');
  url.searchParams.set('tw', 'realtime');
  url.searchParams.set('Refer', 'weibo_realtime');
  url.searchParams.set('page', '1');

  const html = await fetchText(url, {
    headers: {
      Referer: 'https://s.weibo.com/',
      Cookie: env.weiboCookie || ''
    }
  });

  return parseWeiboRealtimePage(html);
}

export async function searchWeibo({ keyword, scope }) {
  const queryVariants = buildQueryVariants({ keyword, scope });
  if (!queryVariants.length) {
    return [];
  }

  const results = [];

  for (const query of queryVariants) {
    try {
      const realtimeResults = await searchWeiboRealtimePage(query);
      results.push(...realtimeResults);
      if (results.length >= 10) {
        break;
      }
    } catch (error) {
      if (configState.hasWeiboCookie) {
        console.warn(`[weibo] 实时搜索页抓取失败: ${error.message}`);
      }
    }
  }

  const dedupedResults = dedupeSourceItems(filterRecentSourceItems(results)).slice(0, 10);
  if (dedupedResults.length > 0) {
    return dedupedResults;
  }

  try {
    return await searchWeiboHot({ keyword });
  } catch (error) {
    console.warn(`[weibo] 热搜回退失败: ${error.message}`);
    return [];
  }
}
