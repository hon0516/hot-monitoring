PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS "NotificationLog";
DROP TABLE IF EXISTS "HotspotKeyword";
DROP TABLE IF EXISTS "Hotspot";
DROP TABLE IF EXISTS "Setting";
DROP TABLE IF EXISTS "Keyword";

CREATE TABLE "Keyword" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "term" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Setting" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "scope" TEXT NOT NULL DEFAULT 'AI 编程',
  "aiProvider" TEXT NOT NULL DEFAULT 'openrouter',
  "scanIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "autoScanEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "websocketEnabled" BOOLEAN NOT NULL DEFAULT true,
  "recipientEmail" TEXT,
  "relevanceThreshold" INTEGER NOT NULL DEFAULT 70,
  "importanceThreshold" TEXT NOT NULL DEFAULT 'high',
  "bingSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "googleNewsSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "hackerNewsSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "twitterSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "bilibiliSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "weiboSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sogouSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Hotspot" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" TEXT NOT NULL,
  "snippet" TEXT,
  "url" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceAuthor" TEXT,
  "sourcePublishedAt" DATETIME,
  "engagementJson" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "titleNormalized" TEXT NOT NULL,
  "aiIsReal" BOOLEAN,
  "aiRelevance" INTEGER,
  "aiImportance" TEXT,
  "aiSummary" TEXT,
  "aiEvidence" TEXT,
  "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "HotspotKeyword" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "hotspotId" INTEGER NOT NULL,
  "keywordId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("hotspotId") REFERENCES "Hotspot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("keywordId") REFERENCES "Keyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "hotspotId" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "recipient" TEXT,
  "errorMessage" TEXT,
  "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("hotspotId") REFERENCES "Hotspot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Keyword_term_key" ON "Keyword"("term");
CREATE UNIQUE INDEX "Hotspot_dedupeKey_key" ON "Hotspot"("dedupeKey");
CREATE INDEX "Hotspot_discoveredAt_idx" ON "Hotspot"("discoveredAt");
CREATE INDEX "Hotspot_sourceType_idx" ON "Hotspot"("sourceType");
CREATE INDEX "Hotspot_aiImportance_idx" ON "Hotspot"("aiImportance");
CREATE INDEX "Hotspot_aiIsReal_idx" ON "Hotspot"("aiIsReal");
CREATE INDEX "Hotspot_titleNormalized_idx" ON "Hotspot"("titleNormalized");
CREATE INDEX "Hotspot_canonicalUrl_idx" ON "Hotspot"("canonicalUrl");
CREATE UNIQUE INDEX "HotspotKeyword_hotspotId_keywordId_key" ON "HotspotKeyword"("hotspotId", "keywordId");
CREATE INDEX "NotificationLog_channel_status_idx" ON "NotificationLog"("channel", "status");
CREATE INDEX "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");

PRAGMA foreign_keys=ON;
