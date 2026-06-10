-- AlterTable: add fcm_token and platform to push_subscriptions
ALTER TABLE "push_subscriptions" 
  ADD COLUMN IF NOT EXISTS "fcm_token" TEXT,
  ADD COLUMN IF NOT EXISTS "platform" VARCHAR(20);

-- Make endpoint/p256dh/auth nullable (they're only used for web-push, not FCM)
ALTER TABLE "push_subscriptions" 
  ALTER COLUMN "endpoint" DROP NOT NULL,
  ALTER COLUMN "p256dh" DROP NOT NULL,
  ALTER COLUMN "auth" DROP NOT NULL;

-- Add unique constraint for fcm_token per user
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_user_id_fcm_token_key" 
  ON "push_subscriptions"("user_id", "fcm_token");
