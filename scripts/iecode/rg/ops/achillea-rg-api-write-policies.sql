-- The unified RG API uses the rg PostgreSQL role for authenticated Achillea
-- staff operations. Legacy Supabase RLS has read policies for inherited roles,
-- but no write policy for rg on these tables. Route handlers enforce staff or
-- ownership before SQL. This migration only enables their required writes.
GRANT SELECT, INSERT, UPDATE, DELETE ON achillea.player_note TO rg;
GRANT INSERT, UPDATE ON achillea.wallet TO rg;
GRANT INSERT ON achillea.transaction TO rg;
GRANT INSERT, UPDATE ON achillea.sanction TO rg;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'achillea' AND tablename = 'player_note' AND policyname = 'rg_api_player_note') THEN
        CREATE POLICY rg_api_player_note ON achillea.player_note
            FOR ALL TO rg USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'achillea' AND tablename = 'wallet' AND policyname = 'rg_api_wallet_insert') THEN
        CREATE POLICY rg_api_wallet_insert ON achillea.wallet
            FOR INSERT TO rg WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'achillea' AND tablename = 'wallet' AND policyname = 'rg_api_wallet_update') THEN
        CREATE POLICY rg_api_wallet_update ON achillea.wallet
            FOR UPDATE TO rg USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'achillea' AND tablename = 'transaction' AND policyname = 'rg_api_transaction_insert') THEN
        CREATE POLICY rg_api_transaction_insert ON achillea.transaction
            FOR INSERT TO rg WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'achillea' AND tablename = 'sanction' AND policyname = 'rg_api_sanction_insert') THEN
        CREATE POLICY rg_api_sanction_insert ON achillea.sanction
            FOR INSERT TO rg WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'achillea' AND tablename = 'sanction' AND policyname = 'rg_api_sanction_update') THEN
        CREATE POLICY rg_api_sanction_update ON achillea.sanction
            FOR UPDATE TO rg USING (true) WITH CHECK (true);
    END IF;
END
$$;
