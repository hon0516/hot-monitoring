-- CreateTable
CREATE TABLE "Keyword" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "term" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL DEFAULT 'AI 编程',
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "websocketEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recipientEmail" TEXT,
    "relevanceThreshold" INTEGER NOT NULL DEFAULT 70,
    "importanceThreshold" TEXT NOT NULL DEFAULT 'high',
    "bingSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "googleNewsSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hackerNewsSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "twitterSourceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "HotspotKeyword" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hotspotId" INTEGER NOT NULL,
    "keywordId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotspotKeyword_hotspotId_fkey" FOREIGN KEY ("hotspotId") REFERENCES "Hotspot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HotspotKeyword_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hotspotId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipient" TEXT,
    "errorMessage" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_hotspotId_fkey" FOREIGN KEY ("hotspotId") REFERENCES "Hotspot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_term_key" ON "Keyword"("term");

-- CreateIndex
CREATE UNIQUE INDEX "Hotspot_dedupeKey_key" ON "Hotspot"("dedupeKey");

-- CreateIndex
CREATE INDEX "Hotspot_discoveredAt_idx" ON "Hotspot"("discoveredAt");

-- CreateIndex
CREATE INDEX "Hotspot_sourceType_idx" ON "Hotspot"("sourceType");

-- CreateIndex
CREATE INDEX "Hotspot_aiImportance_idx" ON "Hotspot"("aiImportance");

-- CreateIndex
CREATE INDEX "Hotspot_aiIsReal_idx" ON "Hotspot"("aiIsReal");

-- CreateIndex
CREATE INDEX "Hotspot_titleNormalized_idx" ON "Hotspot"("titleNormalized");

-- CreateIndex
CREATE INDEX "Hotspot_canonicalUrl_idx" ON "Hotspot"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "HotspotKeyword_hotspotId_keywordId_key" ON "HotspotKeyword"("hotspotId", "keywordId");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_status_idx" ON "NotificationLog"("channel", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");
