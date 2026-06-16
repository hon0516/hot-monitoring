CREATE TABLE "HotspotEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventFingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "primaryUrl" TEXT,
  "primarySourceType" TEXT,
  "primarySourceAuthor" TEXT,
  "sourcePublishedAt" DATETIME,
  "contentType" TEXT NOT NULL DEFAULT 'news',
  "verificationStatus" TEXT NOT NULL DEFAULT 'needs_review',
  "relevanceScore" INTEGER NOT NULL DEFAULT 0,
  "evidenceScore" INTEGER NOT NULL DEFAULT 0,
  "corroborationScore" INTEGER NOT NULL DEFAULT 0,
  "contradictionScore" INTEGER NOT NULL DEFAULT 0,
  "sourceQualityScore" INTEGER NOT NULL DEFAULT 0,
  "trustScore" INTEGER NOT NULL DEFAULT 0,
  "importance" TEXT NOT NULL DEFAULT 'low',
  "independentSourceCount" INTEGER NOT NULL DEFAULT 0,
  "hasOfficialSource" BOOLEAN NOT NULL DEFAULT false,
  "riskFlagsJson" TEXT,
  "auditEvidenceJson" TEXT,
  "auditVersion" TEXT NOT NULL DEFAULT 'deep-verify-v1',
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL,
  "verifiedAt" DATETIME
);

CREATE TABLE "HotspotEventKeyword" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" INTEGER NOT NULL,
  "keywordId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HotspotEventKeyword_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HotspotEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HotspotEventKeyword_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "HotspotSourceItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "snippet" TEXT,
  "bodyText" TEXT,
  "bodyHash" TEXT,
  "originalUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "publisherDomain" TEXT,
  "publisherName" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceAuthor" TEXT,
  "sourcePublishedAt" DATETIME,
  "engagementJson" TEXT,
  "fetchStatus" TEXT NOT NULL DEFAULT 'metadata_only',
  "fetchError" TEXT,
  "isOfficial" BOOLEAN NOT NULL DEFAULT false,
  "isSyndicated" BOOLEAN NOT NULL DEFAULT false,
  "sourceGroup" TEXT,
  "evidenceFlagsJson" TEXT,
  "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL,
  CONSTRAINT "HotspotSourceItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HotspotEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EventClaim" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" INTEGER NOT NULL,
  "claimKey" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unverified',
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "EventClaim_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HotspotEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ClaimEvidence" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "claimId" INTEGER NOT NULL,
  "sourceItemId" INTEGER NOT NULL,
  "stance" TEXT NOT NULL,
  "excerpt" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "EventClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClaimEvidence_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "HotspotSourceItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SourceHealth" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "sourceType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "lastAttemptAt" DATETIME,
  "lastSuccessAt" DATETIME,
  "durationMs" INTEGER,
  "httpStatus" INTEGER,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "filteredCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "updatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "HotspotEvent_eventFingerprint_key" ON "HotspotEvent"("eventFingerprint");
CREATE INDEX "HotspotEvent_verificationStatus_idx" ON "HotspotEvent"("verificationStatus");
CREATE INDEX "HotspotEvent_trustScore_idx" ON "HotspotEvent"("trustScore");
CREATE INDEX "HotspotEvent_relevanceScore_idx" ON "HotspotEvent"("relevanceScore");
CREATE INDEX "HotspotEvent_sourcePublishedAt_idx" ON "HotspotEvent"("sourcePublishedAt");
CREATE INDEX "HotspotEvent_lastSeenAt_idx" ON "HotspotEvent"("lastSeenAt");
CREATE UNIQUE INDEX "HotspotEventKeyword_eventId_keywordId_key" ON "HotspotEventKeyword"("eventId", "keywordId");
CREATE INDEX "HotspotEventKeyword_keywordId_idx" ON "HotspotEventKeyword"("keywordId");
CREATE UNIQUE INDEX "HotspotSourceItem_eventId_canonicalUrl_key" ON "HotspotSourceItem"("eventId", "canonicalUrl");
CREATE INDEX "HotspotSourceItem_canonicalUrl_idx" ON "HotspotSourceItem"("canonicalUrl");
CREATE INDEX "HotspotSourceItem_publisherDomain_idx" ON "HotspotSourceItem"("publisherDomain");
CREATE INDEX "HotspotSourceItem_sourceType_idx" ON "HotspotSourceItem"("sourceType");
CREATE INDEX "HotspotSourceItem_bodyHash_idx" ON "HotspotSourceItem"("bodyHash");
CREATE UNIQUE INDEX "EventClaim_eventId_claimKey_key" ON "EventClaim"("eventId", "claimKey");
CREATE INDEX "EventClaim_status_idx" ON "EventClaim"("status");
CREATE UNIQUE INDEX "ClaimEvidence_claimId_sourceItemId_key" ON "ClaimEvidence"("claimId", "sourceItemId");
CREATE INDEX "ClaimEvidence_stance_idx" ON "ClaimEvidence"("stance");
CREATE UNIQUE INDEX "SourceHealth_sourceType_key" ON "SourceHealth"("sourceType");
