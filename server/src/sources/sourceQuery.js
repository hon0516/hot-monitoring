export function buildQueryVariants({ keyword, scope }) {
  const variants = [keyword, [keyword, scope].filter(Boolean).join(' ')];

  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))].sort((left, right) => right.length - left.length);
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_SOURCE_AGE_DAYS = 30;

function parsePublishedAt(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterRecentSourceItems(items, maxAgeDays = MAX_SOURCE_AGE_DAYS) {
  const cutoff = Date.now() - maxAgeDays * DAY_IN_MS;

  return items.filter((item) => {
    const publishedAt = parsePublishedAt(item.sourcePublishedAt);
    if (!publishedAt) {
      return true;
    }

    return publishedAt.getTime() >= cutoff;
  });
}

export function dedupeSourceItems(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.url || ''}::${item.title || ''}`.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
