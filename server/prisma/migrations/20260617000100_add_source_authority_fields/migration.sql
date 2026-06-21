-- Add source authority and provenance fields for HotspotSourceItem
ALTER TABLE "HotspotSourceItem" ADD COLUMN "discoverySourceType" TEXT;
ALTER TABLE "HotspotSourceItem" ADD COLUMN "sourceAuthorityScore" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "HotspotSourceItem" ADD COLUMN "authorityReason" TEXT;
ALTER TABLE "HotspotSourceItem" ADD COLUMN "officialEntity" TEXT;
ALTER TABLE "HotspotSourceItem" ADD COLUMN "independenceGroup" TEXT;

CREATE INDEX "HotspotSourceItem_discoverySourceType_idx" ON "HotspotSourceItem"("discoverySourceType");
CREATE INDEX "HotspotSourceItem_independenceGroup_idx" ON "HotspotSourceItem"("independenceGroup");
