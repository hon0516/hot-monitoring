const IMPORTANCE_BASE_SCORES = {
  low: 0,
  medium: 8,
  high: 16,
  urgent: 22
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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

function calculateFreshnessBonus(hotspot, now) {
  const rawTimestamp = hotspot.sourcePublishedAt || hotspot.discoveredAt;
  const timestamp = new Date(rawTimestamp || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  const ageHours = Math.max(0, (now.getTime() - timestamp) / (1000 * 60 * 60));
  return clamp(10 - ageHours / 12, 0, 10);
}

function calculateEngagementBonus(engagementJson) {
  const engagement = parseEngagement(engagementJson);
  if (!engagement) {
    return 0;
  }

  const views = numericValue(engagement.views || engagement.reads);
  const reactions =
    numericValue(engagement.likes) +
    numericValue(engagement.points) +
    numericValue(engagement.comments) * 2 +
    numericValue(engagement.replies) * 2 +
    numericValue(engagement.retweets) * 1.5;

  return clamp(Math.log10(views + 1) * 1.5 + Math.log10(reactions + 1) * 2, 0, 10);
}

export function calculateHeatScore(hotspot, { now = new Date() } = {}) {
  const importanceBonus = IMPORTANCE_BASE_SCORES[hotspot?.aiImportance] ?? 0;
  const relevanceScore = numericValue(hotspot?.aiRelevance) * 0.35;
  const trustScore = numericValue(hotspot?.trustScore) * 0.25;
  const sourceQualityScore = numericValue(hotspot?.sourceQualityScore) * 0.1;
  const credibilityAdjustment = hotspot?.aiIsReal === false || hotspot?.auditStatus === 'noise' ? -12 : 0;

  return Math.round(
    clamp(
      relevanceScore +
        trustScore +
        sourceQualityScore +
        importanceBonus +
        calculateFreshnessBonus(hotspot || {}, now) +
        calculateEngagementBonus(hotspot?.engagementJson) +
        credibilityAdjustment,
      0,
      100
    )
  );
}

export function getHeatLabel(score) {
  const value = numericValue(score);
  if (value >= 80) return '爆';
  if (value >= 60) return '热';
  if (value >= 40) return '温';
  return '冷';
}
