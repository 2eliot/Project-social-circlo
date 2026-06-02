-- CreateTable user_reputation
CREATE TABLE "user_reputation" (
    "voter_id" uuid NOT NULL,
    "target_id" uuid NOT NULL,
    "vote_type" integer NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reputation_pkey" PRIMARY KEY ("voter_id","target_id")
);

-- CreateIndex
CREATE INDEX "user_reputation_target_id_idx" ON "user_reputation"("target_id");

-- AddForeignKey
ALTER TABLE "user_reputation" ADD CONSTRAINT "user_reputation_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reputation" ADD CONSTRAINT "user_reputation_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
