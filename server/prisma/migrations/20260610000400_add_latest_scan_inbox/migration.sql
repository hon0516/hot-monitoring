CREATE TABLE "LatestScanInbox" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "scanJobId" TEXT,
    "trigger" TEXT,
    "scannedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "LatestScanInboxItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "inboxId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LatestScanInboxItem_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "LatestScanInbox" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LatestScanInboxItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HotspotEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LatestScanInboxItem_inboxId_eventId_key" ON "LatestScanInboxItem"("inboxId", "eventId");
CREATE INDEX "LatestScanInboxItem_inboxId_isRead_idx" ON "LatestScanInboxItem"("inboxId", "isRead");
CREATE INDEX "LatestScanInboxItem_capturedAt_idx" ON "LatestScanInboxItem"("capturedAt");
