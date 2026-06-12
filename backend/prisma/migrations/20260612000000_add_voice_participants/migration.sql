-- CreateTable: voice_participants
CREATE TABLE IF NOT EXISTS "voice_participants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "channel_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "mic_muted" BOOLEAN NOT NULL DEFAULT true,
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_participants_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "voice_participants"
  ADD CONSTRAINT "voice_participants_channel_id_fkey"
  FOREIGN KEY ("channel_id")
  REFERENCES "channels"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_participants"
  ADD CONSTRAINT "voice_participants_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddUniqueConstraint
ALTER TABLE "voice_participants"
  ADD CONSTRAINT "voice_participants_channel_id_user_id_key"
  UNIQUE ("channel_id", "user_id");

-- CreateIndex
CREATE INDEX "voice_participants_channel_id_idx"
  ON "voice_participants"("channel_id");

-- CreateIndex
CREATE INDEX "voice_participants_user_id_idx"
  ON "voice_participants"("user_id");
