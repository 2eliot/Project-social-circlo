-- CreateEnum
CREATE TYPE "DirectConversationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ModerationAction" ADD VALUE IF NOT EXISTS 'REPORT';

-- AlterTable
ALTER TABLE "direct_conversations"
ADD COLUMN "status" "DirectConversationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "initiator_id" UUID,
ADD COLUMN "accepted_at" TIMESTAMPTZ,
ADD COLUMN "rejected_at" TIMESTAMPTZ;

-- Backfill accepted status for existing conversations
UPDATE "direct_conversations"
SET "status" = 'ACCEPTED',
    "accepted_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
    "initiator_id" = "user_a_id"
WHERE "status" = 'PENDING';

-- AlterTable
ALTER TABLE "direct_conversations"
ALTER COLUMN "initiator_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "user_follows" (
    "follower_id" UUID NOT NULL,
    "following_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("follower_id","following_id")
);

-- CreateIndex
CREATE INDEX "user_follows_following_id_idx" ON "user_follows"("following_id");

-- AddForeignKey
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
