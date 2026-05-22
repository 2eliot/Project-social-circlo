-- AlterTable
ALTER TABLE "direct_messages"
ADD COLUMN "parent_id" UUID;

-- CreateTable
CREATE TABLE "direct_message_hidden" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_hidden_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateIndex
CREATE INDEX "direct_message_hidden_user_id_idx" ON "direct_message_hidden"("user_id");
CREATE INDEX "direct_messages_parent_id_idx" ON "direct_messages"("parent_id");

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "direct_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_message_hidden" ADD CONSTRAINT "direct_message_hidden_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_message_hidden" ADD CONSTRAINT "direct_message_hidden_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
