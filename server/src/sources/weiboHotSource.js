import { dedupeSourceItems, filterRecentSourceItems } from './sourceQuery.js';
import { fetchText, normalizeText, parseCount, safeJsonStringify, toIsoString } from './sourceClient.js';

const WEIBO_HOT_README_URL = 'https://raw.githubusercontent.com/v5tech/weibo-trending-hot-search/master/README.md';

function compactKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？、；：“”‘’（）【】《》—]+/g, '');
}

function buildFallbackUrl(title) {
  const keyword = String(title || '').trim();
  if (!keyword) {
    return 'https://s.weibo.com/top/summary?cate=realtimehot';
  }

  return `https://s.weibo.com/weibo?q=${encodeURIComponent(keyword)}`;
}

export function parseWeiboHotMarkdown(markdown) {
  const content = String(markdown || '');
  if (!content.trim()) {
    return [];
  }

  const updateMatch = content.match(/最后更新时间[:：]\s*([^\n]+)/u);
  const sourcePublishedAt = toIsoString(updateMatch?.[1] || '');
  const linePattern = /^\s*\d+\.\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*(\d+(?:\.\d+)?[万亿w]?|\d+)?\s*$/gimu;
  const items = [];

  for (const match of content.matchAll(linePattern)) {
    const title = normalizeText(match[1]);
    if (!title) {
      continue;
    }

    items.push({
      title,
      snippet: `微博热搜榜热门话题：${title}`,
      url: match[2] || buildFallbackUrl(title),
      sourceType: 'weibo-hot',
      sourceAuthor: '微博热搜',
      sourcePublishedAt,
      engagementJson: safeJsonStringify({
        hot: parseCount(match[3] || '')
      })
    });
  }

  return items;
}

function createKeywordMatcher(keyword) {
  const fullCompactKeyword = compactKeyword(keyword);
  const tokens = String(keyword || '')
    .split(/[\s/,+|]+/u)
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item) => item.length >= 2);
  const compactTokens = tokens.map((item) => compactKeyword(item)).filter(Boolean);

  if (!tokens.length && !compactTokens.length) {
    return () => true;
  }

  return (item) => {
    const haystack = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
    const compactHaystack = compactKeyword(haystack);
    if (fullCompactKeyword && compactHaystack.includes(fullCompactKeyword)) {
      return true;
    }

    if (compactTokens.length > 1) {
      return compactTokens.every((token) => compactHaystack.includes(token));
    }

    return tokens.some((token) => haystack.includes(token)) || compactTokens.some((token) => compactHaystack.includes(token));
  };
}

export async function searchWeiboHot({ keyword } = {}) {
  const markdown = await fetchText(WEIBO_HOT_README_URL, {
    headers: {
      Referer: 'https://github.com/v5tech/weibo-trending-hot-search'
    }
  });

  const matcher = createKeywordMatcher(keyword);
  return dedupeSourceItems(filterRecentSourceItems(parseWeiboHotMarkdown(markdown).filter(matcher))).slice(0, 10);
}
