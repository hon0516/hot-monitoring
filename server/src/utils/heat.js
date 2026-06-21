function numericValue(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const match = normalized.match(/^([\d.]+)\s*([万亿wkmb]?)$/u);
    if (match) {
      const multipliers = {
        '': 1,
        w: 10000,
        万: 10000,
        k: 1000,
        m: 1000000,
        b: 1000000000,
        亿: 100000000
      };
      return Number(match[1]) * multipliers[match[2]];
    }
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampScore(value, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(max, Math.round(numeric)));
}

function parseEngagement(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function freshnessBonus(hotspot) {
  const timestamp = hotspot?.sourcePublishedAt || hotspot?.discoveredAt || hotspot?.firstSeenAt || hotspot?.lastSeenAt;
  if (!timestamp) {
    return 0;
  }

  const publishedAt = new Date(timestamp);
  const ageHours = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return 0;
  }

  if (ageHours <= 6) return 12;
  if (ageHours <= 24) return 8;
  if (ageHours <= 72) return 4;
  return 0;
}

function calculateFallbackHeat(hotspot, engagement) {
  const replies = numericValue(engagement?.replies);
  const quotes = numericValue(engagement?.quotes);
  const followers = numericValue(engagement?.authorFollowers);
  const rawHeat = replies * 0.18 + quotes * 0.35 + Math.log10(followers + 1) * 4 + freshnessBonus(hotspot);
  return clampScore(rawHeat, 45);
}

export function calculateEngagementHeat(engagementJson, hotspot = {}) {
  const engagement = parseEngagement(engagementJson);
  if (!engagement) {
    return calculateFallbackHeat(hotspot, null);
  }

  const likes = numericValue(engagement.likes) + numericValue(engagement.points);
  const retweets =
    numericValue(engagement.retweets) +
    numericValue(engagement.shares) +
    numericValue(engagement.reposts);
  const views =
    numericValue(engagement.views) +
    numericValue(engagement.reads) +
    numericValue(engagement.play);

  if (likes > 0 || retweets > 0 || views > 0) {
    const rawHeat = likes * 1.0 + retweets * 0.65 + Math.log10(views + 1) * 20;
    return clampScore(rawHeat / 10);
  }

  return calculateFallbackHeat(hotspot, engagement);
}

export function calculateHeatScore(hotspot) {
  const computed = calculateEngagementHeat(hotspot?.engagementJson, hotspot);
  if (computed > 0) {
    return computed;
  }

  if (Number.isFinite(Number(hotspot?.heatScore))) {
    return clampScore(hotspot.heatScore);
  }

  return 0;
}

export function getHeatLabel(score) {
  const value = numericValue(score);
  if (value >= 80) return '爆';
  if (value >= 60) return '热';
  if (value >= 40) return '温';
  return '冷';
}
