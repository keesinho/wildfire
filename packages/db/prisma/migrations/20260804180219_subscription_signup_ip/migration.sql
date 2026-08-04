-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "signupIp" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_signupIp_createdAt_idx" ON "Subscription"("signupIp", "createdAt");
