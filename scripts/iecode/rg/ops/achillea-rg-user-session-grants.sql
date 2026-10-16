-- The unified RG API exchanges a Better Auth identity for an Achillea session.
-- Its rg database role already reads achillea.user, but the copied Supabase
-- ACL/RLS only permits writes from the legacy Achillea roles. Keep this grant
-- limited to the user row and the columns the exchange route actually updates.
GRANT INSERT (
    id, created_at, updated_at, last_interact, role, username, avatar,
    display_name, normalized_display_name, blacklist_id, bio, twitch_url
) ON achillea."user" TO rg;
GRANT UPDATE (updated_at, last_interact, username, avatar)
    ON achillea."user" TO rg;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'achillea' AND tablename = 'user'
          AND policyname = 'rg_session_user_insert'
    ) THEN
        CREATE POLICY rg_session_user_insert ON achillea."user"
            FOR INSERT TO rg WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'achillea' AND tablename = 'user'
          AND policyname = 'rg_session_user_update'
    ) THEN
        CREATE POLICY rg_session_user_update ON achillea."user"
            FOR UPDATE TO rg USING (true) WITH CHECK (true);
    END IF;
END
$$;
