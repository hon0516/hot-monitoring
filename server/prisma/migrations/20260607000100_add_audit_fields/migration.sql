ALTER TABLE "Hotspot" ADD COLUMN "auditStatus" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "aiConfidence" INTEGER;
ALTER TABLE "Hotspot" ADD COLUMN "trustScore" INTEGER;
ALTER TABLE "Hotspot" ADD COLUMN "sourceQualityScore" INTEGER;
ALTER TABLE "Hotspot" ADD COLUMN "auditFlagsJson" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "auditVersion" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "corroborationCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Hotspot_auditStatus_idx" ON "Hotspot"("auditStatus");
CREATE INDEX "Hotspot_trustScore_idx" ON "Hotspot"("trustScore");
