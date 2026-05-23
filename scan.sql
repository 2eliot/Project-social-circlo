\echo === feed_posts
SELECT id, attachments FROM feed_posts WHERE attachments::text ~ '127\.0\.0\.1|localhost' LIMIT 20;
\echo === messages
SELECT id, attachments FROM messages WHERE attachments::text ~ '127\.0\.0\.1|localhost' LIMIT 20;
\echo === direct_messages
SELECT id, attachments FROM direct_messages WHERE attachments::text ~ '127\.0\.0\.1|localhost' LIMIT 20;
\echo === users
SELECT id, display_name, avatar_url FROM users WHERE avatar_url ~ '127\.0\.0\.1|localhost' LIMIT 20;
\echo === groups
SELECT id, name, icon_url FROM groups WHERE icon_url ~ '127\.0\.0\.1|localhost' LIMIT 20;