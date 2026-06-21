CREATE TABLE "KeywordExpansion" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "normalizedKeyword" TEXT NOT NULL,
  "originalKeyword" TEXT NOT NULL,
  "expandedKeywordsJson" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "source" TEXT NOT NULL DEFAULT 'rule_fallback',
  "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "KeywordExpansion_normalizedKeyword_key" ON "KeywordExpansion"("normalizedKeyword");
CREATE INDEX "KeywordExpansion_lastUsedAt_idx" ON "KeywordExpansion"("lastUsedAt");

ALTER TABLE "HotspotEvent" ADD COLUMN "heatScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HotspotEvent" ADD COLUMN "matchedKeywordsJson" TEXT;
ALTER TABLE "HotspotEvent" ADD COLUMN "relevanceReason" TEXT;
CREATE INDEX "HotspotEvent_heatScore_idx" ON "HotspotEvent"("heatScore");

UPDATE "HotspotEvent"
SET
  "verificationStatus" = CASE
    WHEN "verificationStatus" = 'needs_review' AND "relevanceScore" >= 60 THEN 'trusted'
    ELSE "verificationStatus"
  END,
  "verifiedAt" = CASE
    WHEN "verificationStatus" = 'needs_review' AND "relevanceScore" >= 60 THEN COALESCE("verifiedAt", CURRENT_TIMESTAMP)
    ELSE "verifiedAt"
  END,
  "trustScore" = CASE
    WHEN "verificationStatus" = 'needs_review' AND "relevanceScore" >= 60 THEN 0
    ELSE "trustScore"
  END,
  "relevanceReason" = CASE
    WHEN "relevanceReason" IS NULL AND "relevanceScore" >= 60 THEN '历史数据按相关度阈值回填为可展示热点'
    ELSE "relevanceReason"
  END
WHERE "verificationStatus" = 'needs_review';
