-- Cambiar dueño de TODAS las tablas a user (incluyendo las que faltan)
ALTER TABLE invitation_codes OWNER TO "user";
ALTER TABLE invitation_redemptions OWNER TO "user";
ALTER TABLE moderation_logs OWNER TO "user";
ALTER TABLE user_blocks OWNER TO "user";
ALTER TABLE user_follows OWNER TO "user";
ALTER TABLE user_notifications OWNER TO "user";
ALTER TABLE users OWNER TO "user";

-- Cambiar dueño de todas las secuencias
DO $$
DECLARE
  seq_name TEXT;
BEGIN
  FOR seq_name IN
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I OWNER TO "user"', seq_name);
  END LOOP;
END
$$;
