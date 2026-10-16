-- Backfill Achillea identity into the claimed Rose Griffon profile.
-- Apply against the unified rg database before deploying the public profile
-- projection: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/website/sql/migrations/20260923_achillea_profile_identity_backfill.sql
-- This migration is idempotent. Existing RG fields always win; ambiguous
-- Discord links, bios over 500 characters and colliding usernames are left
-- untouched for manual review. The old Achillea columns remain available for
-- Discord-only accounts and are never deleted by this migration.

begin;

with linked as (
  select p.id as profile_id,
         p.username as profile_username,
         p.avatar_url as profile_avatar,
         p.bio as profile_bio,
         u.id as discord_id,
         u.username as achillea_username,
         u.display_name as achillea_display_name,
         u.avatar as achillea_avatar,
         u.bio as achillea_bio,
         row_number() over (partition by p.id order by a.created_at desc, a.id) as account_rank,
         count(*) over (partition by u.id) as profile_count
    from public.profiles p
    join public.account a on a.user_id = p.id::text and a.provider_id = 'discord'
    join achillea."user" u on u.id = a.account_id
   where p.claimed_at is not null
     and (p.discord_id is null or p.discord_id = a.account_id)
), normalized as (
  select profile_id, profile_username, profile_avatar, profile_bio,
         case when length(btrim(achillea_bio)) <= 500
              then nullif(btrim(achillea_bio), '') end as bio_candidate,
         case
           when achillea_avatar ~ '^https://' then achillea_avatar
           when discord_id ~ '^[0-9]{15,25}$'
            and achillea_avatar ~ '^(a_)?[A-Za-z0-9_]{8,128}$'
           then 'https://cdn.discordapp.com/avatars/' || discord_id || '/' || achillea_avatar ||
                case when left(achillea_avatar, 2) = 'a_' then '.gif' else '.png' end
           else null
         end as avatar_candidate,
         left(
           btrim(regexp_replace(lower(coalesce(nullif(btrim(achillea_username), ''),
                                               nullif(btrim(achillea_display_name), ''))),
                                '[^a-z0-9_]+', '_', 'g'), '_'),
           20
         ) as username_candidate
    from linked
   where account_rank = 1 and profile_count = 1
), ranked as (
  select *, row_number() over (partition by username_candidate order by profile_id) as username_rank
    from normalized
), ready as (
  select r.profile_id,
         case when nullif(btrim(r.profile_bio), '') is null then r.bio_candidate end as bio_to_copy,
         case when nullif(btrim(r.profile_avatar), '') is null then r.avatar_candidate end as avatar_to_copy,
         case when nullif(btrim(r.profile_username), '') is null
                   and length(r.username_candidate) between 3 and 20
                   and r.username_rank = 1
                   and not exists (
                     select 1 from public.profiles other
                      where lower(other.username) = r.username_candidate and other.id <> r.profile_id
                   )
              then r.username_candidate end as username_to_copy
    from ranked r
)
update public.profiles p
   set bio = coalesce(r.bio_to_copy, p.bio),
       avatar_url = coalesce(r.avatar_to_copy, p.avatar_url),
       username = coalesce(r.username_to_copy, p.username),
       updated_at = now()
  from ready r
 where p.id = r.profile_id
   and (r.bio_to_copy is not null or r.avatar_to_copy is not null or r.username_to_copy is not null);

commit;
