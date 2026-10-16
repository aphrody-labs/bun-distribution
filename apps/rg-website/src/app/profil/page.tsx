import { createPostgresClient } from "@rosegriffon/db/service";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth-helpers";

// Simple redirection vers l'espace du membre connecté : rien à indexer.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function ProfilPage() {
  const supabase = createPostgresClient();
  const user = await getServerUser();

  if (!user) {
    redirect("/login?redirect=/profil");
  }

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();

  if (profile?.username) {
    redirect(`/profil/${encodeURIComponent(profile.username)}`);
  } else {
    redirect("/settings");
  }
}
