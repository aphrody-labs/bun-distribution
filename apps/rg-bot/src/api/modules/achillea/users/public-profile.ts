import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

export interface LinkedPublicProfile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
}

/** A claimed RG profile is the public identity of a linked Discord player. */
export async function findLinkedPublicProfile(
  db: Kysely<Database> | Transaction<Database>,
  discordId: string,
): Promise<LinkedPublicProfile | null> {
  const result = await sql<LinkedPublicProfile>`
		select distinct p.id::text as id, p.username, p.avatar_url, p.bio
		from public.account a
		join public.profiles p on p.id::text = a.user_id
		where a.provider_id = 'discord' and a.account_id = ${discordId}
		  and p.claimed_at is not null
		  and (p.discord_id is null or p.discord_id = a.account_id)
		limit 2
	`.execute(db);
  return uniqueLinkedPublicProfile(result.rows);
}

export function uniqueLinkedPublicProfile(profiles: readonly LinkedPublicProfile[]): LinkedPublicProfile | null {
  return profiles.length === 1 ? (profiles[0] ?? null) : null;
}

export function projectPublicIdentity(
  profile: LinkedPublicProfile | null,
  legacy: { username: string; avatar: string | null; bio: string | null },
) {
  return {
    username: profile?.username || legacy.username,
    avatar: profile?.avatar_url || legacy.avatar,
    bio: profile ? profile.bio : legacy.bio,
    ...(profile?.username ? { rgProfileUsername: profile.username } : {}),
  };
}
