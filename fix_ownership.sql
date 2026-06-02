-- Cambiar dueño de todas las tablas a user
ALTER TABLE _prisma_migrations OWNER TO "user";
ALTER TABLE auth_sessions OWNER TO "user";
ALTER TABLE channels OWNER TO "user";
ALTER TABLE direct_conversations OWNER TO "user";
ALTER TABLE direct_message_hidden OWNER TO "user";
ALTER TABLE direct_messages OWNER TO "user";
ALTER TABLE feed_posts OWNER TO "user";
ALTER TABLE group_audit_logs OWNER TO "user";
ALTER TABLE group_members OWNER TO "user";
ALTER TABLE groups OWNER TO "user";
ALTER TABLE moderation_logs OWNER TO "user";
ALTER TABLE user_blocks OWNER TO "user";
ALTER TABLE user_follows OWNER TO "user";
ALTER TABLE user_notifications OWNER TO "user";
ALTER TABLE users OWNER TO "user";

-- Cambiar dueño de todas las secuencias
ALTER SEQUENCE IF EXISTS users_id_seq OWNER TO "user";
ALTER SEQUENCE IF EXISTS groups_id_seq OWNER TO "user";
ALTER SEQUENCE IF EXISTS channels_id_seq OWNER TO "user";

-- Dar permisos por defecto para futuras tablas
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "user";
