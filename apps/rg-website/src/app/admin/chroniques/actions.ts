"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { logAdminAction } from "@/lib/admin-logger";
import { getServerUser } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";

import { ArticleSchema } from "./schema";
import type { ArticleInput } from "./schema";

async function checkStaffPermission() {
  const supabase = createPostgresClient();
  const user = await getServerUser();

  if (!user) {
    return { authorized: false, user: null };
  }

  // Vérifier via la table profiles
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const authorized = profile?.role === "admin" || profile?.role === "staff";
  return { authorized, user };
}

export async function createChronicle(
  data: ArticleInput,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  try {
    // 1. Validation
    const validation = ArticleSchema.safeParse(data);
    if (!validation.success) {
      return { error: validation.error.issues[0]?.message, success: false };
    }

    // 2. Check Auth & Permissions
    const { authorized, user } = await checkStaffPermission();

    if (!authorized || !user) {
      return { error: "Non autorisé : Réservé au staff", success: false };
    }

    const supabase = createPostgresClient();

    // 3. Check Slug Uniqueness
    const { data: existingSlug } = await supabase
      .from("articles")
      .select("id")
      .eq("slug", data.slug)
      .eq("app", "website")
      .single();

    if (existingSlug) {
      return { error: "Ce slug est déjà utilisé", success: false };
    }

    // 4. Insert
    const { data: newArticle, error } = await supabase
      .from("articles")
      .insert({
        app: "website",
        author_id: user.id,
        category: data.category,
        content: data.content,
        created_at: new Date().toISOString(),
        excerpt: data.excerpt,
        featured_image_url: data.featured_image_url,
        slug: data.slug,
        status: data.status,
        title: data.title,
        updated_at: new Date().toISOString(),
        view_count: 0,
      })
      .select()
      .single();

    if (error) {
      return { error: error.message, success: false };
    }

    // 5. Log
    await logAdminAction("create", "article", newArticle.id, {
      slug: newArticle.slug,
      title: newArticle.title,
    });

    // 6. Revalidate
    revalidatePath("/admin/chroniques");
    revalidatePath("/chroniques");
    revalidateTag("articles", "max");

    if (newArticle.status === "published") {
      void triggerDiscordAnnouncement({ ...newArticle, type: "website" });
    }

    return { data: newArticle, success: true };
  } catch (error) {
    console.error("Error creating chronicle:", error);
    return { error: "Erreur lors de la création", success: false };
  }
}

export async function updateChronicle(
  id: string,
  data: ArticleInput,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  try {
    // 1. Validation
    const validation = ArticleSchema.safeParse(data);
    if (!validation.success) {
      return { error: validation.error.issues[0]?.message, success: false };
    }

    // 2. Check Auth & Permissions
    const { authorized, user } = await checkStaffPermission();

    if (!authorized || !user) {
      return { error: "Non autorisé : Réservé au staff", success: false };
    }

    const supabase = createPostgresClient();

    // 3. Check Slug Uniqueness (excluding current article)
    const { data: existingSlug } = await supabase
      .from("articles")
      .select("id")
      .eq("slug", data.slug)
      .eq("app", "website")
      .neq("id", id)
      .single();

    if (existingSlug) {
      return {
        error: "Ce slug est déjà utilisé par un autre article",
        success: false,
      };
    }

    // 4. Update
    const { data: updatedArticle, error } = await supabase
      .from("articles")
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return { error: error.message, success: false };
    }

    // 5. Log
    await logAdminAction("update", "article", id, {
      status: updatedArticle.status,
      title: updatedArticle.title,
    });

    // 6. Revalidate
    revalidatePath("/admin/chroniques");
    revalidatePath("/chroniques");
    revalidatePath(`/chroniques/${updatedArticle.slug}`);
    revalidateTag("articles", "max");

    if (updatedArticle.status === "published") {
      void triggerDiscordAnnouncement({ ...updatedArticle, type: "website" });
    }

    return { data: updatedArticle, success: true };
  } catch (error) {
    console.error("Error updating chronicle:", error);
    return { error: "Erreur lors de la modification", success: false };
  }
}

export async function toggleChronicleStatus(
  id: string,
  currentStatus: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { authorized, user } = await checkStaffPermission();
    if (!authorized || !user) {
      return { error: "Non autorisé : Réservé au staff", success: false };
    }

    const supabase = createPostgresClient();
    const newStatus = currentStatus ? "draft" : "published";

    const { data: updatedArticle, error } = await supabase
      .from("articles")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return { error: error.message, success: false };
    }

    await logAdminAction("update", "article", id, {
      status: newStatus,
    });

    if (newStatus === "published" && updatedArticle) {
      void triggerDiscordAnnouncement({ ...updatedArticle, type: "website" });
    }

    revalidatePath("/admin/chroniques");
    revalidatePath("/chroniques");
    revalidatePath("/");
    revalidateTag("articles", "max");

    return { success: true };
  } catch (error) {
    console.error("Error toggling chronicle status:", error);
    return { error: "Erreur lors du changement de statut", success: false };
  }
}

export async function deleteChronicle(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { authorized, user } = await checkStaffPermission();
    if (!authorized || !user) {
      return { error: "Non autorisé : Réservé au staff", success: false };
    }

    const supabase = createPostgresClient();
    const { error } = await supabase.from("articles").delete().eq("id", id);

    if (error) {
      return { error: error.message, success: false };
    }

    await logAdminAction("delete", "article", id, {});

    revalidatePath("/admin/chroniques");
    revalidatePath("/chroniques");
    revalidatePath("/");
    revalidateTag("articles", "max");

    return { success: true };
  } catch (error) {
    console.error("Error deleting chronicle:", error);
    return { error: "Erreur lors de la suppression", success: false };
  }
}

async function triggerDiscordAnnouncement(article: {
  title: string;
  slug: string;
  excerpt?: string | null;
  featured_image_url?: string | null;
  type: "wiki" | "website";
}) {
  // Pas de secret de repli : `default-secret-key-12345` était écrit des deux
  // côtés, donc l'annonce partait sans qu'aucun secret n'ait jamais été posé.
  // Sans variable, on ne tente rien et on le DIT — une publication publique qui
  // échoue en silence est pire qu'une publication qui n'a pas lieu.
  const secret = (process.env.DISCORD_ANNOUNCE_SECRET ?? "").trim();
  if (secret === "") {
    console.warn(
      "[Discord Announcement] DISCORD_ANNOUNCE_SECRET absent : aucune annonce envoyée. " +
        "Pose la variable côté site ET côté rg-cron pour activer la publication.",
    );
    return;
  }
  try {
    const res = await fetch("http://localhost:3006/announce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        type: article.type,
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt || "",
        featured_image_url: article.featured_image_url || "",
      }),
    });
    if (!res.ok) {
      console.warn(`[Discord Announcement] Failed to announce: ${res.status} ${await res.text()}`);
    } else {
      console.log(`[Discord Announcement] Announcement triggered successfully for ${article.slug}`);
    }
  } catch (err) {
    console.warn("[Discord Announcement] Error triggering announcement:", err);
  }
}
