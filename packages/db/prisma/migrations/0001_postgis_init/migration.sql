-- ============================================================
-- 0. PostGIS extensie
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "HotspotSource" AS ENUM ('VIIRS_SNPP', 'VIIRS_NOAA20', 'VIIRS_NOAA21', 'MODIS');
CREATE TYPE "Confidence"    AS ENUM ('LOW', 'NOMINAL', 'HIGH');
CREATE TYPE "EventStatus"   AS ENUM ('CANDIDATE', 'ACTIVE', 'COOLING', 'CLOSED');
CREATE TYPE "Trend"         AS ENUM ('GROWING', 'STABLE', 'DECLINING', 'UNKNOWN');
CREATE TYPE "WarnLevel"     AS ENUM ('YELLOW', 'ORANGE', 'RED');
CREATE TYPE "SubChannel"    AS ENUM ('EMAIL', 'WEBHOOK');

-- ============================================================
-- 2. Tabellen
-- ============================================================

-- Region (eerst, want FireEvent en Warning verwijzen er naar)
CREATE TABLE "Region" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "level"       INTEGER NOT NULL,
  CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- FireEvent
CREATE TABLE "FireEvent" (
  "id"             TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "name"           TEXT,
  "centroidLat"    DOUBLE PRECISION NOT NULL,
  "centroidLon"    DOUBLE PRECISION NOT NULL,
  "firstSeen"      TIMESTAMP(3) NOT NULL,
  "lastSeen"       TIMESTAMP(3) NOT NULL,
  "detectionCount" INTEGER NOT NULL DEFAULT 0,
  "totalFrp"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxFrp"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "estAreaHa"      DOUBLE PRECISION,
  "trend"          "Trend" NOT NULL DEFAULT 'UNKNOWN',
  "status"         "EventStatus" NOT NULL DEFAULT 'CANDIDATE',
  "severity"       INTEGER NOT NULL DEFAULT 0,
  "countryCode"    TEXT,
  "regionId"       TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FireEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FireEvent_slug_key"              ON "FireEvent"("slug");
CREATE INDEX        "FireEvent_status_lastSeen_idx"   ON "FireEvent"("status", "lastSeen");
CREATE INDEX        "FireEvent_countryCode_idx"       ON "FireEvent"("countryCode");

-- Detection
CREATE TABLE "Detection" (
  "id"           TEXT NOT NULL,
  "source"       "HotspotSource" NOT NULL,
  "lat"          DOUBLE PRECISION NOT NULL,
  "lon"          DOUBLE PRECISION NOT NULL,
  "acquiredAt"   TIMESTAMP(3) NOT NULL,
  "confidence"   "Confidence" NOT NULL,
  "frp"          DOUBLE PRECISION,
  "brightness"   DOUBLE PRECISION,
  "daynight"     TEXT,
  "filtered"     BOOLEAN NOT NULL DEFAULT false,
  "filterReason" TEXT,
  "eventId"      TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Detection_source_acquiredAt_lat_lon_key"
  ON "Detection"("source", "acquiredAt", "lat", "lon");
CREATE INDEX "Detection_acquiredAt_idx" ON "Detection"("acquiredAt");
CREATE INDEX "Detection_eventId_idx"    ON "Detection"("eventId");

-- Warning
CREATE TABLE "Warning" (
  "id"            TEXT NOT NULL,
  "externalId"    TEXT NOT NULL,
  "countryCode"   TEXT NOT NULL,
  "awarenessType" TEXT NOT NULL,
  "level"         "WarnLevel" NOT NULL,
  "onset"         TIMESTAMP(3) NOT NULL,
  "expires"       TIMESTAMP(3) NOT NULL,
  "headline"      TEXT,
  "regionId"      TEXT,
  "raw"           JSONB NOT NULL,
  "fetchedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Warning_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Warning_externalId_key"           ON "Warning"("externalId");
CREATE INDEX        "Warning_countryCode_expires_idx"  ON "Warning"("countryCode", "expires");
CREATE INDEX        "Warning_awarenessType_level_idx"  ON "Warning"("awarenessType", "level");

-- DangerReading
CREATE TABLE "DangerReading" (
  "id"        TEXT NOT NULL,
  "cellLat"   DOUBLE PRECISION NOT NULL,
  "cellLon"   DOUBLE PRECISION NOT NULL,
  "date"      DATE NOT NULL,
  "fwiClass"  TEXT NOT NULL,
  "fwiValue"  DOUBLE PRECISION,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DangerReading_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DangerReading_cellLat_cellLon_date_key"
  ON "DangerReading"("cellLat", "cellLon", "date");

-- StaticHeatSource
CREATE TABLE "StaticHeatSource" (
  "id"      TEXT NOT NULL,
  "lat"     DOUBLE PRECISION NOT NULL,
  "lon"     DOUBLE PRECISION NOT NULL,
  "radiusM" INTEGER NOT NULL DEFAULT 750,
  "type"    TEXT NOT NULL,
  "note"    TEXT,
  CONSTRAINT "StaticHeatSource_pkey" PRIMARY KEY ("id")
);

-- Place (GeoNames subset)
CREATE TABLE "Place" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "lat"         DOUBLE PRECISION NOT NULL,
  "lon"         DOUBLE PRECISION NOT NULL,
  "population"  INTEGER NOT NULL,
  "countryCode" TEXT NOT NULL,
  "admin1"      TEXT,
  CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Place_countryCode_idx" ON "Place"("countryCode");

-- ApiKey
CREATE TABLE "ApiKey" (
  "id"        TEXT NOT NULL,
  "keyHash"   TEXT NOT NULL,
  "ownerMail" TEXT NOT NULL,
  "plan"      TEXT NOT NULL DEFAULT 'free',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- Subscription
CREATE TABLE "Subscription" (
  "id"          TEXT NOT NULL,
  "channel"     "SubChannel" NOT NULL,
  "target"      TEXT NOT NULL,
  "label"       TEXT,
  "lat"         DOUBLE PRECISION NOT NULL,
  "lon"         DOUBLE PRECISION NOT NULL,
  "radiusKm"    INTEGER NOT NULL DEFAULT 30,
  "minSeverity" INTEGER NOT NULL DEFAULT 20,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "apiKeyId"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- NotificationLog
CREATE TABLE "NotificationLog" (
  "id"             TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventId"        TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationLog_subscriptionId_eventId_idx"
  ON "NotificationLog"("subscriptionId", "eventId");

-- ApiUsage
CREATE TABLE "ApiUsage" (
  "id"       TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "date"     DATE NOT NULL,
  "count"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiUsage_apiKeyId_date_key" ON "ApiUsage"("apiKeyId", "date");

-- ============================================================
-- 3. Foreign keys
-- ============================================================
ALTER TABLE "FireEvent"      ADD CONSTRAINT "FireEvent_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Detection"      ADD CONSTRAINT "Detection_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "FireEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Warning"        ADD CONSTRAINT "Warning_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApiUsage"       ADD CONSTRAINT "ApiUsage_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 4. Geometry kolommen (Prisma kent geen native geometry-type)
-- ============================================================
ALTER TABLE "Detection" ADD COLUMN "geom"          geometry(Point,4326);
ALTER TABLE "FireEvent" ADD COLUMN "geomCentroid"  geometry(Point,4326);
ALTER TABLE "FireEvent" ADD COLUMN "geomHull"      geometry(Polygon,4326);
ALTER TABLE "Region"    ADD COLUMN "geom"          geometry(MultiPolygon,4326);

-- ============================================================
-- 5. GIST-indexen op geometry-kolommen
-- ============================================================
CREATE INDEX "Detection_geom_idx"         ON "Detection" USING GIST ("geom");
CREATE INDEX "FireEvent_geomCentroid_idx" ON "FireEvent" USING GIST ("geomCentroid");
CREATE INDEX "FireEvent_geomHull_idx"     ON "FireEvent" USING GIST ("geomHull");
CREATE INDEX "Region_geom_idx"            ON "Region"    USING GIST ("geom");

-- ============================================================
-- 6. Triggers: vul geom automatisch uit lat/lon
-- ============================================================

-- Detection
CREATE OR REPLACE FUNCTION fill_detection_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lon IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_detection_geom
  BEFORE INSERT OR UPDATE OF lat, lon
  ON "Detection"
  FOR EACH ROW EXECUTE FUNCTION fill_detection_geom();

-- FireEvent centroid
CREATE OR REPLACE FUNCTION fill_fire_event_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."centroidLat" IS NOT NULL AND NEW."centroidLon" IS NOT NULL THEN
    NEW."geomCentroid" = ST_SetSRID(ST_MakePoint(NEW."centroidLon", NEW."centroidLat"), 4326);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fire_event_geom
  BEFORE INSERT OR UPDATE OF "centroidLat", "centroidLon"
  ON "FireEvent"
  FOR EACH ROW EXECUTE FUNCTION fill_fire_event_geom();
