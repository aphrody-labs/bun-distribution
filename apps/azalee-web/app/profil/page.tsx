import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Raccourci « mon profil », symétrique de celui de `rosegriffon.fr`.
 *
 * Azalee n'exposait que `/profil/[username]` : la barre latérale et le menu de
 * compte partagés entre les deux apps pointent pourtant vers `/profil`, qui
 * tombait donc en 404 ici. Cette page ne fait que rediriger vers l'espace du
 * membre connecté.
 */
// Simple redirection vers l'espace du membre connecté : rien à indexer.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function ProfilPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login?redirect=/profil");
  }

  // Le pseudonyme fait partie des colonnes fermées à `anon` depuis la
  // fermeture PII : la lecture se fait en service-role, filtrée sur l'id de la
  // session vérifiée juste au-dessus.
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("username").eq("id", session.user.id).maybeSingle();

  const username = typeof profile?.username === "string" ? profile.username : "";
  redirect(username ? `/profil/${username}` : "/settings");
}
