-- Run AFTER `prisma migrate dev` to convert `messages` into a partitioned table.
-- This is OPTIONAL for development; recommended for production scale.
--
-- Strategy: rename existing table, create partitioned parent with same shape,
-- attach monthly partitions, copy data, drop old table.
--
-- Usage:
--   psql "$DATABASE_URL" -f prisma/sql/partition-messages.sql

BEGIN;

ALTER TABLE messages RENAME TO messages_legacy;

CREATE TABLE messages (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    channel_id   UUID NOT NULL,
    author_id    UUID,
    parent_id    UUID,
    content      TEXT,
    attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
    reactions    JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
    is_edited    BOOLEAN NOT NULL DEFAULT FALSE,
    status       "MessageStatus" NOT NULL DEFAULT 'PUBLISHED',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 12 monthly partitions starting 2026-01
DO $$
DECLARE
  start_date DATE := DATE '2026-01-01';
  i INT;
  pstart DATE;
  pend DATE;
BEGIN
  FOR i IN 0..11 LOOP
    pstart := start_date + (i || ' month')::INTERVAL;
    pend   := pstart + INTERVAL '1 month';
    EXECUTE format(
      'CREATE TABLE messages_%s PARTITION OF messages FOR VALUES FROM (%L) TO (%L);',
      to_char(pstart, 'YYYY_MM'), pstart, pend
    );
  END LOOP;
END $$;

INSERT INTO messages SELECT * FROM messages_legacy;
DROP TABLE messages_legacy CASCADE;

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC)
  WHERE deleted_at IS NULL AND status = 'PUBLISHED';
CREATE INDEX idx_messages_author ON messages(author_id);

ALTER TABLE messages
  ADD CONSTRAINT messages_channel_id_fkey FOREIGN KEY (channel_id)
    REFERENCES channels(id) ON DELETE CASCADE,
  ADD CONSTRAINT messages_author_id_fkey FOREIGN KEY (author_id)
    REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
