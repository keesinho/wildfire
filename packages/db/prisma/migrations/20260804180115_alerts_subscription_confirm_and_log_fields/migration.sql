-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "unsubscribeToken" TEXT NOT NULL DEFAULT substr(md5(random()::text), 1, 25),
ADD COLUMN     "confirmToken" TEXT;

-- Drop the temporary default now that existing rows (there are none yet) have a value;
-- new rows get their token from Prisma's cuid() default going forward.
ALTER TABLE "Subscription" ALTER COLUMN "unsubscribeToken" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "severity" INTEGER,
ADD COLUMN     "distanceKm" DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_unsubscribeToken_key" ON "Subscription"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_confirmToken_key" ON "Subscription"("confirmToken");
