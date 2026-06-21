import { env } from '../config/env.js';

export function buildQueryVariants({ keyword, scope }) {
  const variants = [keyword, [keyword, scope].filter(Boolean).join(' ')];

  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))].sort((left, right) => right.length - left.length);
}

const INTERNATIONAL_ALIAS_MAP = [
  {
    match: (value, normalized) => normalized.includes('ai编程') || (/\bai\b/i.test(value) && /编程|代码|开发/u.test(value)),
    aliases: ['AI programming', 'AI coding', 'AI-assisted coding', 'coding with AI']
  },
  {
    match: (_value, normalized) => normalized.includes('智能体') || normalized.includes('aiagent'),
    aliases: ['AI agent', 'AI agents', 'agentic AI']
  },
  {
    match: (_value, normalized) => normalized.includes('大模型') || normalized.includes('llm'),
    aliases: ['LLM', 'large language model']
  }
];

function normalizeAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？、；：“”‘’（）【】《》—]+/g, '');
}

function expandInternationalAliases(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  const normalized = normalizeAliasKey(raw);
  const aliases = INTERNATIONAL_ALIAS_MAP.flatMap((entry) => (entry.match(raw, normalized) ? entry.aliases : []));
  return [...new Set(aliases.map((item) => item.trim()).filter(Boolean))];
}

export function buildInternationalQueryVariants({ keyword, scope }) {
  const localVariants = buildQueryVariants({ keyword, scope });
  const keywordAliases = expandInternationalAliases(keyword);
  const scopeAliases = expandInternationalAliases(scope);
  const aliasScope = scopeAliases[0] || '';
  const englishVariants = keywordAliases.flatMap((alias) => {
    const variants = [alias];
    if (aliasScope && aliasScope.toLowerCase() !== alias.toLowerCase()) {
      variants.push(`${alias} ${aliasScope}`);
    }
    return variants;
  });

  return [...new Set([...localVariants, ...englishVariants].map((item) => item.trim()).filter(Boolean))].sort(
    (left, right) => right.length - left.length
  );
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function parsePublishedAt(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterRecentSourceItems(items, maxAgeDays = env.sourceMaxAgeDays) {
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
