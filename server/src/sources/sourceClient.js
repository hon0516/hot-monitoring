const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`请求超时: ${timeoutMs}ms`)), timeoutMs);

  return {
    controller,
    clear() {
      clearTimeout(timeoutId);
    }
  };
}

export async function fetchText(url, { headers = {}, timeoutMs = 12000 } = {}) {
  const { controller, clear } = createTimeoutController(timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': pickUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers
      }
    });

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }

    return await response.text();
  } finally {
    clear();
  }
}

export async function fetchJson(url, { headers = {}, timeoutMs = 12000 } = {}) {
  const { controller, clear } = createTimeoutController(timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': pickUserAgent(),
        Accept: 'application/json,text/plain,*/*',
        ...headers
      }
    });

    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }

    return await response.json();
  } finally {
    clear();
  }
}

export function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function isChallengePage(content) {
  const text = String(content || '');
  return /(visitor system|验证码|安全验证|请完成验证|访问受限|sina visitor system)/iu.test(text);
}

export function parseCount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const numeric = Number(raw.replace(/,/g, ''));
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const match = raw.match(/^([\d.]+)\s*([万亿w])$/iu);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = match[2].toLowerCase();
  if (unit === '亿') {
    return Math.round(amount * 100000000);
  }

  return Math.round(amount * 10000);
}

export function toIsoString(value) {
  if (!value && value !== 0) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const now = new Date();
  let match = text.match(/^(\d+)\s*分钟前$/u);
  if (match) {
    return new Date(now.getTime() - Number(match[1]) * 60 * 1000).toISOString();
  }

  match = text.match(/^(\d+)\s*小时前$/u);
  if (match) {
    return new Date(now.getTime() - Number(match[1]) * 60 * 60 * 1000).toISOString();
  }

  match = text.match(/^今天\s*(\d{1,2}):(\d{1,2})$/u);
  if (match) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(match[1]),
      Number(match[2]),
      0,
      0
    ).toISOString();
  }

  match = text.match(/^昨天\s*(\d{1,2}):(\d{1,2})$/u);
  if (match) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      Number(match[1]),
      Number(match[2]),
      0,
      0
    ).toISOString();
  }

  match = text.match(/^(\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/u);
  if (match) {
    return new Date(
      now.getFullYear(),
      Number(match[1]) - 1,
      Number(match[2]),
      Number(match[3] || 0),
      Number(match[4] || 0),
      0,
      0
    ).toISOString();
  }

  match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/u);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      0
    ).toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
