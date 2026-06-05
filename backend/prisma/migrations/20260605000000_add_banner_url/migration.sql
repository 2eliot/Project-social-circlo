-- Add banner_url column to groups table
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "banner_url" TEXT;
