import { createPostgresClient } from "@rosegriffon/db/service";
import { type AccountSession, type AccountTabId, resolveAccountTab } from "@rosegriffon/ui";
import { redirect } from "next/navigation";

import { getPgPool } from "@/lib/db/pg";
import { getServerSession } from "@/lib/auth-helpers";

import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

const TABS: readonly AccountTabId[] = ["profile", "address", "connections", "security"];

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }
  const user = session.user;

  const { tab } = await searchParams;

  // Service-role : la page édite des colonnes hors liste blanche publique
  // (adresse postale, nom complet). Depuis la fermeture PII du 11/8/2026 un
  // client anon échoue en 42501 sur `profiles`, ce qui renvoyait un profil
  // `null` et affichait un formulaire vide. La session est vérifiée ci-dessus
  // et la requête est filtrée sur l'identifiant de session.
  const admin = createPostgresClient();
  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[compte] lecture du profil impossible", profileError);
  }

  const profile = (profileRow ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof profile[key] === "string" ? (profile[key] as string) : "");

  const { data: accountRows } = await admin
    .from("account")
    .select("id, provider_id, created_at, scope")
    .eq("user_id", user.id);

  // N'envoyer que les identifiants au composant client. Les jetons de session
  // servent à authentifier et restent exclusivement côté serveur.
  // Lecture directe : `auth.api.listSessions` exige une session « fraîche »
  // (moins d'un jour) et laissait la liste vide à presque tous les membres.
  let sessions: AccountSession[] = [];
  try {
    const { rows } = await getPgPool().query<{
      id: string;
      created_at: Date | string;
      expires_at: Date | string | null;
      ip_address: string | null;
      user_agent: string | null;
    }>(
      `SELECT id, created_at, expires_at, ip_address, user_agent
         FROM session
        WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC`,
      [user.id],
    );
    sessions = rows.map(s => ({
      createdAt: new Date(s.created_at).toISOString(),
      current: s.id === session.session.id,
      expiresAt: s.expires_at ? new Date(s.expires_at).toISOString() : null,
      ipAddress: s.ip_address ?? null,
      id: s.id,
      userAgent: s.user_agent ?? null,
    }));
  } catch (error) {
    console.error("[compte] liste des sessions indisponible", error);
  }

  const username = str("username");

  return (
    <AccountClient
      userId={user.id}
      email={user.email}
      initialTab={resolveAccountTab(tab, TABS)}
      backHref={username ? `/profil/${encodeURIComponent(username)}` : "/"}
      avatarUrl={str("avatar_url") || null}
      username={username || null}
      role={str("role") || null}
      twoFactorEnabled={Boolean((user as { twoFactorEnabled?: boolean }).twoFactorEnabled)}
      profile={{
        badges: Array.isArray(profile.badges) ? (profile.badges as string[]) : [],
        banner_position: Number(profile.banner_position ?? 50) || 50,
        poste: str("poste") || null,
        banner_url: str("banner_url"),
        bio: str("bio"),
        full_name: str("full_name"),
        twitter_handle: str("twitter_handle"),
        username,
        website: str("website"),
      }}
      address={{
        address_line1: str("address_line1"),
        address_line2: str("address_line2"),
        city: str("city"),
        country: str("country"),
        postal_code: str("postal_code"),
      }}
      accounts={(accountRows ?? []).map((row: unknown) => {
        const r = row as {
          id: string;
          provider_id: string;
          created_at: string;
          scope: string | null;
        };
        return {
          id: r.id,
          createdAt: r.created_at,
          provider: r.provider_id,
          scope: r.scope,
        };
      })}
      sessions={sessions}
    />
  );
}
