-- CreateTable
CREATE TABLE "user_muted_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "muted_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_muted_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_muted_settings_user_id_muted_user_id_key" ON "user_muted_settings"("user_id", "muted_user_id");

-- CreateIndex
CREATE INDEX "user_muted_settings_user_id_idx" ON "user_muted_settings"("user_id");

-- AddForeignKey
ALTER TABLE "user_muted_settings" ADD CONSTRAINT "user_muted_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_muted_settings" ADD CONSTRAINT "user_muted_settings_muted_user_id_fkey" FOREIGN KEY ("muted_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
