CREATE TABLE "EventNotificationLog" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "recipient" TEXT,
  "errorMessage" TEXT,
  "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventNotificationLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HotspotEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "EventNotificationLog_eventId_channel_status_idx" ON "EventNotificationLog"("eventId", "channel", "status");
CREATE INDEX "EventNotificationLog_sentAt_idx" ON "EventNotificationLog"("sentAt");
