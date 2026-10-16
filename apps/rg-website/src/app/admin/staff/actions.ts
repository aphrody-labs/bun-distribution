"use server";

import { revalidatePath } from "next/cache";
import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import { createPostgresClient } from "@rosegriffon/db/service";
import type { Database } from "@rosegriffon/db";

import { logAdminAction } from "@/lib/admin-logger";
import { getServerUser } from "@/lib/auth-helpers";

import {
  avecNomEquipe,
  BUCKET_IMAGES,
  construireCheminImage,
  construireUrlPubliqueAsset,
  comparerMembres,
  premierMessage,
  schemaIdentifiant,
  schemaMembre,
  schemaMiseAJourMembre,
  SOURCE_ADMIN,
  validerFichierImage,
} from "./staff-schema";
import type { EntreeMembre } from "./staff-schema";

export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

export type TeamMemberInput = EntreeMembre;

/** Pages publiques qui affichent des membres du staff. */
const CHEMINS_A_REVALIDER = ["/notre-equipe", "/community", "/admin/staff"];

function revaliderPagesStaff(): void {
  for (const chemin of CHEMINS_A_REVALIDER) {
    revalidatePath(chemin);
  }
}

/**
 * Garde d'administration partagée par toutes les actions de ce module.
 *
 * Les actions vérifiaient le rôle avec `profiles.role === "admin"` sur un
 * `eq("id", user.id)` brut. Deux pannes : le mappage identité Better Auth →
 * profil (par `discord_id`, puis e-mail) était court-circuité, et le rôle
 * attendu était plus strict que celui de la garde de page
 * (`AdminLayout` → `requireAdmin` → `ADMIN_ROLES`). Un `moderator` ou un
 * `editor` accédait donc à la page puis se voyait refuser chaque action.
 */
async function exigerAdmin(): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await getServerUser();
  if (!user) {
    return { message: "Non authentifié", ok: false };
  }

  const admin = createPostgresClient();
  const profil = await resolveProfile(admin, user);

  if (!profil || !isAdmin(profil.role)) {
    return { message: "Permissions insuffisantes", ok: false };
  }

  return { ok: true };
}

/**
 * Récupère tous les membres d'équipe, actifs comme inactifs.
 *
 * La lecture passe par le client PostgreSQL service, derrière la garde admin,
 * afin d'inclure les membres désactivés et les imports en attente.
 */
export async function getAllTeamMembers(): Promise<{
  data: TeamMember[] | null;
  error: string | null;
}> {
  try {
    const garde = await exigerAdmin();
    if (!garde.ok) {
      return { data: null, error: garde.message };
    }

    const admin = createPostgresClient();
    const { data, error } = await admin.from("team_members").select("*");

    if (error) {
      console.error("[staff] échec de lecture des membres :", error);
      return { data: null, error: error.message };
    }

    // Tri appliqué ici plutôt qu'en SQL : c'est exactement le comparateur du
    // site public (`display_index` croissant, NULL en dernier, puis nom).
    const membres = ((data ?? []) as TeamMember[]).toSorted(comparerMembres);

    return { data: membres, error: null };
  } catch (error) {
    console.error("[staff] erreur inattendue à la lecture des membres :", error);
    return { data: null, error: "Une erreur inattendue est survenue" };
  }
}

/**
 * Crée un nouveau membre d'équipe.
 */
export async function createTeamMember(input: TeamMemberInput): Promise<{
  data: TeamMember | null;
  error: string | null;
}> {
  try {
    const garde = await exigerAdmin();
    if (!garde.ok) {
      return { data: null, error: garde.message };
    }

    const analyse = schemaMembre.safeParse(input);
    if (!analyse.success) {
      return { data: null, error: premierMessage(analyse.error) };
    }

    const valeurs = { ...avecNomEquipe(analyse.data), source: SOURCE_ADMIN };

    const admin = createPostgresClient();
    const { data, error } = await admin.from("team_members").insert(valeurs).select().single();

    if (error) {
      console.error("[staff] échec de création d'un membre :", error);
      return { data: null, error: error.message };
    }

    await logAdminAction("create", "team_member", String(data.id), valeurs);
    revaliderPagesStaff();

    return { data: data as TeamMember, error: null };
  } catch (error) {
    console.error("[staff] erreur inattendue à la création d'un membre :", error);
    return { data: null, error: "Une erreur inattendue est survenue" };
  }
}

/**
 * Met à jour un membre d'équipe.
 */
export async function updateTeamMember(
  id: string,
  input: Partial<TeamMemberInput>,
): Promise<{
  data: TeamMember | null;
  error: string | null;
}> {
  try {
    const garde = await exigerAdmin();
    if (!garde.ok) {
      return { data: null, error: garde.message };
    }

    const identifiant = schemaIdentifiant.safeParse(id);
    if (!identifiant.success) {
      return { data: null, error: premierMessage(identifiant.error) };
    }

    const analyse = schemaMiseAJourMembre.safeParse(input);
    if (!analyse.success) {
      return { data: null, error: premierMessage(analyse.error) };
    }

    if (Object.keys(analyse.data).length === 0) {
      return { data: null, error: "Aucune modification à enregistrer." };
    }

    const valeurs = avecNomEquipe(analyse.data);

    const admin = createPostgresClient();
    const { data, error } = await admin
      .from("team_members")
      .update(valeurs)
      .eq("id", identifiant.data)
      .select()
      .single();

    if (error) {
      console.error("[staff] échec de mise à jour d'un membre :", error);
      return { data: null, error: error.message };
    }

    await logAdminAction("update", "team_member", identifiant.data, valeurs);
    revaliderPagesStaff();

    return { data: data as TeamMember, error: null };
  } catch (error) {
    console.error("[staff] erreur inattendue à la mise à jour d'un membre :", error);
    return { data: null, error: "Une erreur inattendue est survenue" };
  }
}

/**
 * Active ou désactive un membre — la seule mutation déclenchée d'un clic.
 *
 * Action dédiée plutôt qu'un `updateTeamMember` partiel : le client n'a alors
 * aucun moyen d'envoyer une charge utile arbitraire depuis un bouton.
 */
export async function setTeamMemberActive(
  id: string,
  actif: boolean,
): Promise<{ data: TeamMember | null; error: string | null }> {
  return updateTeamMember(id, { is_active: actif });
}

/**
 * Supprime un membre d'équipe.
 */
export async function deleteTeamMember(id: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const garde = await exigerAdmin();
    if (!garde.ok) {
      return { error: garde.message, success: false };
    }

    const identifiant = schemaIdentifiant.safeParse(id);
    if (!identifiant.success) {
      return { error: premierMessage(identifiant.error), success: false };
    }

    const admin = createPostgresClient();
    const { error } = await admin.from("team_members").delete().eq("id", identifiant.data);

    if (error) {
      console.error("[staff] échec de suppression d'un membre :", error);
      return { error: error.message, success: false };
    }

    await logAdminAction("delete", "team_member", identifiant.data, {});
    revaliderPagesStaff();

    return { error: null, success: true };
  } catch (error) {
    console.error("[staff] erreur inattendue à la suppression d'un membre :", error);
    return { error: "Une erreur inattendue est survenue", success: false };
  }
}

/**
 * Envoie une photo de membre dans le bucket Storage `assets`.
 *
 * L'URL renvoyée est reconstruite sur une origine publique : `getPublicUrl()`
 * du client service s'appuie sur `SUPABASE_INTERNAL_URL`
 * (`http://127.0.0.1:8811`), une adresse qu'aucun navigateur ne peut atteindre
 * et qui n'est pas déclarée dans `images.remotePatterns` — `next/image` refusait
 * donc de l'afficher.
 */
export async function uploadTeamMemberImage(file: File): Promise<{
  url: string | null;
  error: string | null;
}> {
  try {
    const garde = await exigerAdmin();
    if (!garde.ok) {
      return { error: garde.message, url: null };
    }

    if (!(file instanceof File)) {
      return { error: "Aucun fichier reçu.", url: null };
    }

    const controle = validerFichierImage(file);
    if (!controle.ok) {
      return { error: controle.message, url: null };
    }

    const graine = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const chemin = construireCheminImage(file.type, graine);

    const admin = createPostgresClient();
    const { error: erreurEnvoi } = await admin.storage.from(BUCKET_IMAGES).upload(chemin, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

    if (erreurEnvoi) {
      console.error("[staff] échec d'envoi de l'image :", erreurEnvoi);
      return { error: erreurEnvoi.message, url: null };
    }

    const url = construireUrlPubliqueAsset(chemin, [
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_BASE_URL,
      process.env.BETTER_AUTH_URL,
    ]);

    return { error: null, url };
  } catch (error) {
    console.error("[staff] erreur inattendue à l'envoi de l'image :", error);
    return { error: "Une erreur inattendue est survenue", url: null };
  }
}
