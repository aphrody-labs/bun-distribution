"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import {
  createTierlist,
  deleteTierlistAdmin,
  getTierlistForAdmin,
  updateTierlistAdmin,
  type UpdateTierlistAdminInput,
} from "@/lib/tierlists";
import {
  sanitizeTiers,
  type OfficialTierlistPayload,
  type SaveTierlistResult,
} from "@/lib/tierlist-input";

/** Invalide le cache CDN/ISR de toutes les surfaces qui affichent des tier lists. */
function revalidateTierlistSurfaces(slug?: string | null): void {
  revalidatePath("/admin/tierlists");
  revalidatePath("/tierlists");
  revalidatePath("/");
  if (slug) revalidatePath(`/tierlists/${slug}`);
}

/**
 * Crée (sans `id`) ou met à jour (avec `id`) une tier list officielle depuis
 * l'éditeur admin. Renvoie un résultat typé que l'éditeur (client) affiche —
 * on ne `throw`/`redirect` pas ici pour garder l'UX inline.
 */
export async function saveOfficialTierlist(
  input: OfficialTierlistPayload,
): Promise<SaveTierlistResult> {
  const me = await requireAdmin();

  const title = (input.title ?? "").trim();
  if (title.length < 2) return { ok: false, error: "Donne un titre à la tier list." };

  const sane = sanitizeTiers(input.tiers);
  if (!sane) return { ok: false, error: "Tier list invalide (aucun tier ou trop de cartes)." };
  if (sane.totalItems === 0)
    return { ok: false, error: "Place au moins une carte dans un tier avant d'enregistrer." };

  const description = input.description?.trim() || null;
  // Depuis l'admin, une tier list est officielle par défaut.
  const official = input.official ?? true;
  const featured = input.featured ?? false;
  const published = input.published ?? true;

  try {
    if (input.id) {
      const existing = await getTierlistForAdmin(input.id);
      if (!existing) return { ok: false, error: "Tier list introuvable." };
      await updateTierlistAdmin(input.id, {
        title,
        description,
        tiers: sane.tiers,
        official,
        featured,
        published,
      });
      revalidateTierlistSurfaces(existing.slug);
      return { ok: true, slug: existing.slug };
    }

    const { slug } = await createTierlist({
      title,
      description,
      templateKey: input.templateKey ?? null,
      tiers: sane.tiers,
      authorId: me.user.id,
      official,
      featured,
      published,
    });
    revalidateTierlistSurfaces(slug);
    return { ok: true, slug };
  } catch (e) {
    console.error("saveOfficialTierlist failed:", e);
    return { ok: false, error: "Échec de l'enregistrement." };
  }
}

/**
 * Bascule un drapeau (`published`/`official`/`featured`) d'une tier list depuis
 * la liste de modération. Lié à un `<form action>` → reçoit un FormData.
 */
export async function toggleTierlistFlag(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const flag = String(formData.get("flag") ?? "");
  const value = String(formData.get("value") ?? "") === "true";
  if (!id) return;

  const patch: UpdateTierlistAdminInput = {};
  if (flag === "published") patch.published = value;
  else if (flag === "official") patch.official = value;
  else if (flag === "featured") patch.featured = value;
  else return;

  // Récupère le slug AVANT la mutation pour revalider la page détail (ISR 60s) :
  // `revalidatePath('/tierlists')` n'invalide pas les routes dynamiques enfants.
  const existing = await getTierlistForAdmin(id);
  await updateTierlistAdmin(id, patch);
  revalidateTierlistSurfaces(existing?.slug);
}

/** Supprime définitivement une tier list (admin). Lié à un `<form action>`. */
export async function removeTierlist(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  // Slug récupéré avant suppression pour purger le cache de la page détail.
  const existing = await getTierlistForAdmin(id);
  await deleteTierlistAdmin(id);
  revalidateTierlistSurfaces(existing?.slug);
}
