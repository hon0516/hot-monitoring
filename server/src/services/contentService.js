import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { normalizeUrl } from '../utils/normalize.js';
import { stripHtml } from '../sources/sourceClient.js';
import { assessSourceAuthority, matchOfficialSource } from '../config/verificationConfig.js';

const MAX_BODY_CHARS = 18000;
const MIN_BODY_CHARS = 180;
const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const AGGREGATOR_DOMAINS = new Set(['news.google.com', 'bing.com', 'www.bing.com']);
const GENERIC_PAGE_TITLES = new Set(['google news', 'msn', 'bing', 'microsoft start']);
const METADATA_FALLBACK_SOURCES = new Set(['twitter', 'weibo', 'weibo-hot', 'bilibili', 'hacker-news']);
const TWITTER_DOMAINS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

function isPrivateIpv4(hostname) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(hostname);
}

function validatePublicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('仅支持公开 HTTP/HTTPS 原文');
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname) || isPrivateIpv4(hostname)) {
    throw new Error('拒绝访问本地或私有网络地址');
  }
  return url;
}

async function decodeGoogleNewsUrl(value) {
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'news.google.com' || parts.at(-2) !== 'articles') return value;

  const id = parts.at(-1);
  const bytes = Buffer.from(id, 'base64url');
  const prefix = Buffer.from([0x08, 0x13, 0x22]);
  const suffix = Buffer.from([0xd2, 0x01, 0x00]);
  let payload = bytes;
  if (payload.subarray(0, prefix.length).equals(prefix)) payload = payload.subarray(prefix.length);
  if (payload.subarray(-suffix.length).equals(suffix)) payload = payload.subarray(0, -suffix.length);
  const length = payload[0];
  const offset = length >= 0x80 ? 2 : 1;
  const decoded = payload.subarray(offset, offset + (length >= 0x80 ? (length & 0x7f) : length)).toString();
  if (decoded.startsWith('http')) return decoded;

  const requestData =
    '[[["Fbv4je","[\\"garturlreq\\",[[\\"en-US\\",\\"US\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],null,null,1,1,\\"US:en\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],\\"en-US\\",\\"US\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"' +
    id +
    '\\"]",null,"generic"]]]';
  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      Referer: 'https://news.google.com/'
    },
    body: `f.req=${encodeURIComponent(requestData)}`
  });
  if (!response.ok) throw new Error(`Google News 原始链接解析失败: ${response.status}`);
  const text = await response.text();
  const header = '[\\"garturlres\\",\\"';
  const startIndex = text.indexOf(header);
  if (startIndex < 0) throw new Error('Google News 原始链接响应缺少结果');
  const remainder = text.slice(startIndex + header.length);
  const endIndex = remainder.indexOf('\\",');
  if (endIndex < 0) throw new Error('Google News 原始链接响应不完整');
  return JSON.parse(`"${remainder.slice(0, endIndex)}"`);
}

async function resolveSourceUrl(value) {
  try {
    return await decodeGoogleNewsUrl(value);
  } catch {
    return value;
  }
}

function metaContent($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).first().attr('content') || $(selector).first().text();
    if (value?.trim()) return stripHtml(value);
  }
  return '';
}

function extractArticleText($) {
  $('script, style, noscript, nav, header, footer, aside, form, svg').remove();
  const candidates = [
    $('article').first(),
    $('[itemprop="articleBody"]').first(),
    $('.article-content, .article-body, .post-content, .entry-content, main').first(),
    $('body').first()
  ];

  for (const node of candidates) {
    const text = stripHtml(node.text()).replace(/\s+/g, ' ').trim();
    if (text.length >= MIN_BODY_CHARS) {
      return text.slice(0, MAX_BODY_CHARS);
    }
  }
  return '';
}

export function getPublisherDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isOfficialDomain(domain) {
  if (AGGREGATOR_DOMAINS.has(domain)) return false;
  return matchOfficialSource({ domain }).isOfficial;
}

function metadataBody(item) {
  const text = stripHtml([item?.snippet, item?.title].filter(Boolean).join(' '));
  return text.length >= 40 ? text.slice(0, MAX_BODY_CHARS) : '';
}

function isTwitterSource(item, domain) {
  return item?.sourceType === 'twitter' || TWITTER_DOMAINS.has(String(domain || '').toLowerCase());
}

function isTwitterPageTitle(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized.endsWith(' on x') || normalized.endsWith(' / x');
}

function authorityFor({ item, publisherDomain, url, isOfficial, officialEntity, fetchStatus }) {
  const authority = assessSourceAuthority({
    sourceType: item?.sourceType,
    publisherDomain,
    canonicalUrl: url,
    resolvedUrl: url,
    isOfficial,
    officialEntity,
    fetchStatus
  });
  return {
    sourceAuthorityScore: authority.score,
    authorityReason: authority.reason
  };
}

export async function fetchArticleContent(item, { timeoutMs = 15000 } = {}) {
  const sourceUrl = validatePublicUrl(await resolveSourceUrl(item.url));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HotMonitoring/1.0; +https://localhost)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) {
      throw new Error(`原文请求失败: ${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '');
    if (!contentType.includes('text/html')) {
      throw new Error(`原文不是 HTML: ${contentType || 'unknown'}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const resolvedUrl = response.url || item.url;
    const resolvedDomain = getPublisherDomain(resolvedUrl);
    if (AGGREGATOR_DOMAINS.has(resolvedDomain)) {
      const fetchStatus = 'metadata_only';
      const official = { isOfficial: false, officialEntity: null };
      return {
        title: item.title,
        snippet: item.snippet || '',
        bodyText: '',
        bodyHash: null,
        originalUrl: item.url,
        canonicalUrl: normalizeUrl(item.url),
        resolvedUrl: item.url,
        publisherDomain: null,
        publisherName: item.sourceAuthor || '',
        sourceAuthor: item.sourceAuthor || '',
        sourcePublishedAt: item.sourcePublishedAt || null,
        fetchStatus,
        fetchError: '聚合链接未解析到原始媒体地址',
        isOfficial: official.isOfficial,
        officialEntity: official.officialEntity,
        ...authorityFor({
          item,
          publisherDomain: null,
          url: item.url,
          isOfficial: official.isOfficial,
          officialEntity: official.officialEntity,
          fetchStatus
        }),
        evidenceFlags: ['aggregator_url_unresolved', 'body_unavailable']
      };
    }
    const canonicalHref = $('link[rel="canonical"]').first().attr('href');
    const canonicalUrl = normalizeUrl(canonicalHref ? new URL(canonicalHref, resolvedUrl).toString() : resolvedUrl);
    const extractedTitle =
      metaContent($, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'h1', 'title']) ||
      item.title;
    const sourceIsTwitter = isTwitterSource(item, resolvedDomain);
    const title =
      sourceIsTwitter || GENERIC_PAGE_TITLES.has(String(extractedTitle || '').trim().toLowerCase()) || isTwitterPageTitle(extractedTitle)
        ? item.title
        : extractedTitle;
    const extractedSnippet =
      metaContent($, ['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']) ||
      item.snippet ||
      '';
    const snippet = sourceIsTwitter ? item.snippet || extractedSnippet : extractedSnippet;
    const author = sourceIsTwitter
      ? item.sourceAuthor || ''
      : metaContent($, ['meta[name="author"]', '[rel="author"]', '[itemprop="author"]']) || item.sourceAuthor || '';
    const publishedAt =
      metaContent($, [
        'meta[property="article:published_time"]',
        'meta[name="date"]',
        'meta[name="pubdate"]',
        'time[datetime]'
      ]) || item.sourcePublishedAt || null;
    const publisherName = sourceIsTwitter
      ? 'X'
      : metaContent($, ['meta[property="og:site_name"]', 'meta[name="application-name"]']) || item.sourceAuthor || '';
    const extractedBodyText = extractArticleText($);
    const bodyText = sourceIsTwitter ? extractedBodyText || metadataBody(item) : extractedBodyText;
    const publisherDomain = resolvedDomain;
    const official = matchOfficialSource({
      domain: publisherDomain,
      url: resolvedUrl
    });
    const fetchStatus = bodyText ? 'fetched' : 'metadata_only';
    const evidenceFlags = [];
    if (!bodyText) evidenceFlags.push('body_unavailable');
    if (!publishedAt) evidenceFlags.push('published_at_missing');
    if (bodyText && bodyText.length < 600) evidenceFlags.push('body_too_short');

    return {
      title,
      snippet,
      bodyText,
      bodyHash: bodyText ? crypto.createHash('sha256').update(bodyText).digest('hex') : null,
      originalUrl: item.url,
      canonicalUrl: canonicalUrl || normalizeUrl(item.url),
      resolvedUrl,
      publisherDomain,
      publisherName,
      sourceAuthor: author,
      sourcePublishedAt: publishedAt,
      fetchStatus,
      fetchError: null,
      isOfficial: official.isOfficial,
      officialEntity: official.officialEntity,
      ...authorityFor({
        item,
        publisherDomain,
        url: resolvedUrl,
        isOfficial: official.isOfficial,
        officialEntity: official.officialEntity,
        fetchStatus
      }),
      evidenceFlags
    };
  } catch (error) {
    const publisherDomain = getPublisherDomain(item.url);
    const official = matchOfficialSource({ domain: publisherDomain, url: item.url });
    const fallbackBody = METADATA_FALLBACK_SOURCES.has(item.sourceType) ? metadataBody(item) : '';
    const fetchStatus = fallbackBody ? 'metadata_only' : 'failed';
    const bodyHash = fallbackBody ? crypto.createHash('sha256').update(fallbackBody).digest('hex') : null;
    return {
      title: item.title,
      snippet: item.snippet || '',
      bodyText: fallbackBody,
      bodyHash,
      originalUrl: item.url,
      canonicalUrl: normalizeUrl(item.url),
      resolvedUrl: item.url,
      publisherDomain,
      publisherName: item.sourceAuthor || '',
      sourceAuthor: item.sourceAuthor || '',
      sourcePublishedAt: item.sourcePublishedAt || null,
      fetchStatus,
      fetchError: error?.name === 'AbortError' ? '原文请求超时' : error.message,
      isOfficial: official.isOfficial,
      officialEntity: official.officialEntity,
      ...authorityFor({
        item,
        publisherDomain,
        url: item.url,
        isOfficial: official.isOfficial,
        officialEntity: official.officialEntity,
        fetchStatus
      }),
      evidenceFlags: [
        'body_unavailable',
        ...(fallbackBody ? ['metadata_fallback'] : []),
        ...(!item.sourcePublishedAt ? ['published_at_missing'] : [])
      ]
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
