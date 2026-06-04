-- AlterTable: add per-user hidden timestamps to direct_conversations
ALTER TABLE "direct_conversations" ADD COLUMN "user_a_hidden_at" TIMESTAMPTZ(6);
ALTER TABLE "direct_conversations" ADD COLUMN "user_b_hidden_at" TIMESTAMPTZ(6);
