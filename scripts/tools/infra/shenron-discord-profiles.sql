-- SPDX-License-Identifier: Apache-2.0
-- Private Shenron bot profile cache. Applied by Aphrody Infra against shenron_site.
BEGIN;
SET LOCAL ROLE shenron;
CREATE TABLE IF NOT EXISTS bot.discord_user_profiles (
  user_id text PRIMARY KEY,
  username text,
  avatar_hash text,
  updated_at bigint NOT NULL,
  source_id text NOT NULL,
  CONSTRAINT discord_user_profiles_snowflake CHECK (user_id ~ '^[0-9]{17,20}$'),
  CONSTRAINT discord_user_profiles_updated_at CHECK (updated_at >= 0)
);
COMMIT;
