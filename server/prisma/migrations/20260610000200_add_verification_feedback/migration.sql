CREATE TABLE "VerificationFeedback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationFeedback_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HotspotEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "VerificationFeedback_eventId_type_idx" ON "VerificationFeedback"("eventId", "type");
