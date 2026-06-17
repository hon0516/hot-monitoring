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

  // 来源权威度（替代写死的 SOURCE_QUALITY）。信任度仍以「独立来源 + 官方一手 + 事实支持」为主导，
  // 该表仅作来源质量分的兜底权重。
  sourceAuthority: {
    'google-news': 82,
    bing: 78,
    'hacker-news': 74,
    twitter: 52,
    bilibili: 45,
    sogou: 35,
    default: 50,
    official: 98
  },

  // 不作为可信热点直接通过的内容类型。
  blockedContentTypes: ['tutorial', 'opinion', 'marketing', 'collection', 'search_noise']
};

export function getSourceAuthority(sourceType, { isOfficial = false } = {}) {
  if (isOfficial) {
    return verificationConfig.sourceAuthority.official;
  }
  return verificationConfig.sourceAuthority[sourceType] ?? verificationConfig.sourceAuthority.default;
}
