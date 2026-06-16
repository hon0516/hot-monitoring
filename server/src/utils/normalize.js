const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
  'ref_src',
  'source'
]);

export function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();

    [...url.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    });

    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.pathname = pathname;
    url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildDedupeFields(item) {
  const canonicalUrl = normalizeUrl(item.url);
  const titleNormalized = normalizeTitle(item.title);
  const dedupeKey = canonicalUrl || `title:${titleNormalized}`;

  return {
    canonicalUrl,
    titleNormalized,
    dedupeKey
  };
}

export function parseImportanceRank(value) {
  const ranks = {
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4
  };

  return ranks[(value || '').toLowerCase()] || 0;
}

export function meetsNotificationThreshold(hotspot, settings) {
  if (hotspot.auditStatus) {
    return Boolean(
      hotspot.auditStatus === 'trusted' &&
        Number(hotspot.trustScore || 0) >= 75 &&
        Number(hotspot.aiRelevance || 0) >= settings.relevanceThreshold &&
        parseImportanceRank(hotspot.aiImportance) >= parseImportanceRank(settings.importanceThreshold)
    );
  }

  return Boolean(
    hotspot.aiIsReal &&
      Number(hotspot.aiRelevance || 0) >= settings.relevanceThreshold &&
      parseImportanceRank(hotspot.aiImportance) >= parseImportanceRank(settings.importanceThreshold)
  );
}
