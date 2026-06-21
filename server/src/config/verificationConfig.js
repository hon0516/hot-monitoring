// 深度核验的可调参数集中在此，替代散落在代码中的写死规则与魔法数字。
// 这里的内容属于「数据/参数」而非算法逻辑，后续可外置到数据库或设置页。

export const verificationConfig = {
  // 语义相关性闸（基于本地 embedding）。模型不可用时这些阈值自动失效，流程回退到 LLM 判断。
  semantic: {
    // 低于该分（0-100）视为明显不相关，直接短路：不进入昂贵的多次 LLM 调用。
    hardFloorRelevance: 35,
    // 最终相关性 = LLM 相关性与语义相关性的加权融合，semanticWeight 为语义占比。
    semanticWeight: 0.4
  },

  // 信任分加权（finalizeDecision）。
  trustWeights: {
    relevance: 0.2,
    evidence: 0.25,
    corroboration: 0.4,
    sourceQuality: 0.15,
    contradictionPenalty: 0.55
  },

  // 判定阈值（finalizeDecision）。
  decisionThresholds: {
    trustedRelevance: 75,
    trustedTrust: 80,
    maxContradictionForTrusted: 25,
    rejectRelevance: 50,
    contradictedScore: 50,
    // 触发第二次独立裁决的 trustScore 区间。
    independentReviewTrustRange: [72, 88]
  },

  // 证据分构成（calculateRuleScores.evidenceScore）。
  evidenceWeights: {
    fetched: 45,
    dated: 20,
    authored: 10,
    official: 20,
    multiSourceBonus: 5
  },

  // 多源佐证分档（calculateRuleScores.corroborationScore）。
  corroborationTiers: {
    fourPlusDomains: 92,
    threeDomains: 82,
    twoDomains: 68,
    officialOnly: 62,
    single: 24,
    // corroboration = tier * (base + supportRatio * supportFactor)
    base: 0.55,
    supportFactor: 0.45
  },

  // 发现渠道只用于兜底，不能代表发布者权威。
  discoverySourceAuthority: {
    'google-news': 52,
    bing: 50,
    'hacker-news': 60,
    twitter: 38,
    bilibili: 36,
    weibo: 34,
    'weibo-hot': 28,
    sogou: 32,
    default: 42,
    official: 98
  },
  // 兼容旧测试和旧调用点；新逻辑优先使用 discoverySourceAuthority + domainAuthority。
  sourceAuthority: {
    'google-news': 52,
    bing: 50,
    'hacker-news': 60,
    twitter: 38,
    bilibili: 36,
    weibo: 34,
    'weibo-hot': 28,
    sogou: 32,
    default: 42,
    official: 98
  },

  // 发布域名权威度。未列出的域名走发现渠道兜底，并受正文可用性惩罚。
  domainAuthority: {
    'openai.com': 92,
    'anthropic.com': 92,
    'deepmind.google': 90,
    'googleblog.com': 88,
    'microsoft.com': 88,
    'apple.com': 88,
    'meta.com': 86,
    'nvidia.com': 86,
    'huggingface.co': 82,
    'github.blog': 78,
    'reuters.com': 88,
    'apnews.com': 88,
    'bloomberg.com': 84,
    'theverge.com': 76,
    'techcrunch.com': 74,
    '36kr.com': 70,
    'caixin.com': 80,
    'cloud.tencent.com': 82,
    'alibabacloud.com': 82
  },

  // 官方来源必须匹配实体规则；平台型域名不能只凭域名算官方。
  officialEntities: [
    { entity: 'OpenAI', domains: ['openai.com'], githubOrgs: ['openai'] },
    { entity: 'Anthropic', domains: ['anthropic.com'], githubOrgs: ['anthropics'] },
    { entity: 'Google DeepMind', domains: ['deepmind.google', 'googleblog.com'], githubOrgs: ['google-deepmind'] },
    { entity: 'Microsoft', domains: ['microsoft.com'], githubOrgs: ['microsoft'] },
    { entity: 'Apple', domains: ['apple.com'], githubOrgs: ['apple'] },
    { entity: 'Meta', domains: ['meta.com'], githubOrgs: ['facebookresearch', 'meta-llama'] },
    { entity: 'NVIDIA', domains: ['nvidia.com'], githubOrgs: ['nvidia'] },
    { entity: 'Hugging Face', domains: ['huggingface.co'], githubOrgs: ['huggingface'] },
    { entity: '腾讯云', domains: ['cloud.tencent.com'] },
    { entity: '阿里云', domains: ['alibabacloud.com'] }
  ],

  // 不作为可信热点直接通过的内容类型。
  blockedContentTypes: ['tutorial', 'opinion', 'marketing', 'collection', 'search_noise']
};

function clampScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 0;
}

function normalizeDomain(value) {
  return String(value || '').replace(/^www\./iu, '').toLowerCase();
}

function hostnameFromUrl(value) {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return '';
  }
}

function pathFromUrl(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return '';
  }
}

function domainMatches(domain, candidate) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedCandidate = normalizeDomain(candidate);
  return normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`);
}

function domainAuthorityScore(domain) {
  const normalizedDomain = normalizeDomain(domain);
  for (const [candidate, score] of Object.entries(verificationConfig.domainAuthority)) {
    if (domainMatches(normalizedDomain, candidate)) {
      return score;
    }
  }
  return undefined;
}

export function matchOfficialSource({ domain, url, entities = [] } = {}) {
  const host = normalizeDomain(domain) || hostnameFromUrl(url);
  const pathname = pathFromUrl(url);
  const entityHints = new Set(entities.map((item) => String(item || '').toLowerCase()).filter(Boolean));

  for (const rule of verificationConfig.officialEntities) {
    const entityName = String(rule.entity || '');
    const entityMatchesHint =
      !entityHints.size ||
      entityHints.has(entityName.toLowerCase()) ||
      [...entityHints].some((hint) => entityName.toLowerCase().includes(hint) || hint.includes(entityName.toLowerCase()));

    if (!entityMatchesHint) {
      continue;
    }

    if (rule.domains?.some((candidate) => domainMatches(host, candidate))) {
      return { isOfficial: true, officialEntity: entityName, reason: `匹配官方域名 ${host}` };
    }

    if (host === 'github.com' && Array.isArray(rule.githubOrgs)) {
      const org = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      if (org && rule.githubOrgs.map((item) => item.toLowerCase()).includes(org)) {
        return { isOfficial: true, officialEntity: entityName, reason: `匹配官方 GitHub 组织 ${org}` };
      }
    }
  }

  return { isOfficial: false, officialEntity: null, reason: host ? `未匹配官方实体规则: ${host}` : '缺少发布域名' };
}

export function assessSourceAuthority({
  sourceType,
  publisherDomain,
  canonicalUrl,
  resolvedUrl,
  isOfficial = false,
  officialEntity = null,
  fetchStatus = 'metadata_only',
  feedbackPenalty = 0
} = {}) {
  const domain = normalizeDomain(publisherDomain) || hostnameFromUrl(resolvedUrl) || hostnameFromUrl(canonicalUrl);
  const domainScore = domainAuthorityScore(domain);
  const fallbackScore =
    verificationConfig.discoverySourceAuthority[sourceType] ?? verificationConfig.discoverySourceAuthority.default;
  const baseScore = isOfficial ? verificationConfig.discoverySourceAuthority.official : domainScore ?? fallbackScore;
  const bodyPenalty = fetchStatus === 'fetched' ? 0 : fetchStatus === 'metadata_only' ? 8 : 16;
  const score = clampScore(baseScore - bodyPenalty - Number(feedbackPenalty || 0));
  const reason = isOfficial
    ? `官方来源${officialEntity ? `：${officialEntity}` : ''}`
    : domainScore !== undefined
      ? `发布域名权威分：${domain}`
      : `发现渠道兜底分：${sourceType || 'unknown'}`;

  return { score, reason, domain };
}

export function getSourceAuthority(sourceTypeOrSource, options = {}) {
  if (typeof sourceTypeOrSource === 'object' && sourceTypeOrSource !== null) {
    return assessSourceAuthority(sourceTypeOrSource).score;
  }

  if (options.isOfficial) {
    return verificationConfig.discoverySourceAuthority.official;
  }

  return (
    verificationConfig.discoverySourceAuthority[sourceTypeOrSource] ??
    verificationConfig.discoverySourceAuthority.default
  );
}
