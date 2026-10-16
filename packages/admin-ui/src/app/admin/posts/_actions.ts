"use server";

import { db } from "@/lib/db";
import { posts } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import {
  isSlugAvailable,
  revalidateArticleRoutes,
  savePostRecord,
  type PostInput,
  type SaveResult,
} from "@/lib/cms-posts";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

/**
 * Écritures du CMS éditorial — **surface d'administration**.
 *
 * Toute la logique d'enregistrement (validation, rendu du document, unicité du
 * slug, programmation, purge du cache) vit dans `lib/cms-posts.ts`, partagée
 * avec l'API des agents : un article écrit par un humain et un article déposé
 * par un agent suivent exactement le même chemin, donc les mêmes garde-fous.
 * Ce fichier ne garde que ce qui est propre à l'administration : la
 * vérification des droits et les redirections.
 *
 * Le formulaire envoie un **document Tiptap**, jamais du HTML : le balisage
 * publié est régénéré côté serveur, borné au schéma d'extensions du site.
 */

export type { PostInput, SaveResult };

export async function savePost(input: PostInput): Promise<SaveResult> {
  const me = await requireAdmin();
  // Un admin publie : `canPublish` vrai. La bride ne concerne que les agents
  // dépourvus de la portée `publish:articles`.
  return savePostRecord(input, { userId: me.user.id, canPublish: true });
}

/** Bascule rapide publié/brouillon depuis la liste, sans ouvrir l'éditeur. */

export async function deletePost(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const post = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  await db.delete(posts).where(eq(posts.id, id));
  revalidateArticleRoutes(post?.slug);
  redirect("/admin/posts");
}

/**
 * Disponibilité d'un slug — alimente le témoin temps réel de l'éditeur, pour que
 * l'admin voie le conflit AVANT d'enregistrer (et non un slug silencieusement
 * suffixé après coup).
 */
export async function checkSlug(
  slug: string,
  currentId?: string,
): Promise<{ available: boolean; normalized: string }> {
  await requireAdmin();
  return isSlugAvailable(slug, currentId);
}
