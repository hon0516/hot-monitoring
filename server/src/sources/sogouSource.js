import * as cheerio from 'cheerio';
import { buildQueryVariants, dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';
import { fetchText, isChallengePage, parseCount, safeJsonStringify, stripHtml, toIsoString } from './sourceClient.js';

function resolveSogouLink(href) {
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, 'https://www.sogou.com');
    return url.toString();
  } catch {
    return href;
  }
}

function extractPublishTime(text) {
  const match = String(text || '').match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{1,2})?|\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{1,2})?)/u);
  return toIsoString(match?.[1] || null);
}

export function parseSogouSearchResults(html) {
  if (!html || isChallengePage(html)) {
    return [];
  }

  const $ = cheerio.load(html);
  const results = [];

  $('.vrwrap, .results > div').each((_, element) => {
    let anchor = $(element).find('h3 a').first();
    if (!anchor.length) {
      anchor = $(element).find('a[data-url]').first();
    }
    if (!anchor.length) {
      anchor = $(element).find('a[href]').first();
    }
    const title = stripHtml(anchor.html() || anchor.text());
    const url = resolveSogouLink(anchor.attr('data-url') || anchor.attr('href'));
    const snippet = stripHtml($(element).find('.str-text-info, .text-layout, .text-info, p').first().html());
    const metaText = stripHtml($(element).find('.s-p, .news-from, .attribute, .info').text());
    const heatMatch = metaText.match(/(?:热度|浏览|阅读)[：:\s]*([\d.]+[万亿w]?)/u);

    if (!title || !url || /javascript:/i.test(url)) {
      return;
    }

    results.push({
      title,
      snippet,
      url,
      sourceType: 'sogou',
      sourceAuthor: '搜狗搜索',
      sourcePublishedAt: extractPublishTime(metaText),
      engagementJson: safeJsonStringify({
        reads: parseCount(heatMatch?.[1] || null),
        meta: metaText || null
      })
    });
  });

  return results;
}

export async function searchSogou({ keyword, scope }) {
  const results = [];
  const queries = buildQueryVariants({ keyword, scope });

  for (const query of queries) {
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
    const html = await fetchText(url, {
      headers: {
        Referer: 'https://www.sogou.com/'
      }
    });

    results.push(...parseSogouSearchResults(html));
    if (results.length >= 10) {
      break;
    }
  }

  return dedupeSourceItems(filterRecentSourceItems(results)).slice(0, 10);
}
