-- DropIndex
DROP INDEX "Detection_geom_idx";

-- DropIndex
DROP INDEX "FireEvent_geomCentroid_idx";

-- DropIndex
DROP INDEX "FireEvent_geomHull_idx";

-- DropIndex
DROP INDEX "Region_geom_idx";

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "signupIp" TEXT;

-- CreateIndex
CREATE INDEX "ApiKey_signupIp_createdAt_idx" ON "ApiKey"("signupIp", "createdAt");
