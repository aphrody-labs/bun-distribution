"use server";

import { getServerSession, getServerUser } from "@/lib/auth-helpers";
import { isAdminRole } from "@/lib/auth-roles";
import { getPgPool } from "@/lib/db/pg";
import { createPostgresClient } from "@rosegriffon/db/service";

// ==========================================
// WEBSITE GENERIC COMMENTS
// ==========================================

export interface CommentProfile {
  username: string | null;
  avatar_url: string | null;
  role: string | null;
  badges: string[] | null;
}

export interface CommentWithProfile {
  id: string;
  content: string;
  target_id: string;
  target_type: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  profiles: CommentProfile | null;
}

export async function getPublicCommentProfile(userId: string): Promise<CommentProfile | null> {
  const { data } = await createPostgresClient()
    .from("profiles")
    .select("username, avatar_url, role, badges")
    .eq("id", userId)
    .maybeSingle();
  return (data as CommentProfile | null) ?? null;
}

interface CommentRow {
  id: string;
  content: string;
  target_id: string;
  target_type: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  profile_id: string | null;
  profile_username: string | null;
  profile_avatar_url: string | null;
  profile_role: string | null;
  profile_badges: string[] | null;
}

export async function getCommentsAction(
  targetId: string,
  targetType: string,
): Promise<{ data: CommentWithProfile[]; error?: string }> {
  try {
    const pool = getPgPool();

    const { rows } = await pool.query<CommentRow>(
      `SELECT c.id, c.content, c.target_id, c.target_type, c.user_id, c.created_at, c.updated_at,
				p.id AS profile_id, p.username AS profile_username, p.avatar_url AS profile_avatar_url,
				p.role AS profile_role, p.badges AS profile_badges
			 FROM comments c
			 LEFT JOIN profiles p ON p.id = c.user_id
			 WHERE c.target_id = $1 AND c.target_type = $2
			 ORDER BY c.created_at ASC`,
      [targetId, targetType],
    );

    const data: CommentWithProfile[] = rows.map(row => ({
      content: row.content,
      created_at: row.created_at,
      id: row.id,
      profiles: row.profile_id
        ? {
            avatar_url: row.profile_avatar_url,
            badges: row.profile_badges,
            role: row.profile_role,
            username: row.profile_username,
          }
        : null,
      target_id: row.target_id,
      target_type: row.target_type,
      updated_at: row.updated_at,
      user_id: row.user_id,
    }));

    return { data };
  } catch (error) {
    console.error("Error loading comments:", error);
    return { data: [], error: "Impossible de charger les commentaires." };
  }
}

export async function addCommentAction(targetId: string, targetType: string, content: string) {
  const user = await getServerUser();
  if (!user) {
    return { error: "Vous devez être connecté pour publier un commentaire." };
  }

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return { error: "Le commentaire ne peut pas être vide." };
  }

  if (trimmedContent.length > 1000) {
    return { error: "Le commentaire ne peut pas dépasser 1000 caractères." };
  }

  const supabase = createPostgresClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: "Profil utilisateur introuvable en base de données." };
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      content: trimmedContent,
      target_id: targetId,
      target_type: targetType,
      user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to add comment:", error);
    return { error: "Impossible de publier le commentaire." };
  }

  return { success: true, comment: data };
}

export async function deleteCommentAction(commentId: string) {
  const user = await getServerUser();
  if (!user) {
    return { error: "Vous devez être connecté pour supprimer un commentaire." };
  }

  const supabase = createPostgresClient();

  const { data: comment, error: fetchError } = await supabase
    .from("comments")
    .select("user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment) {
    return { error: "Commentaire introuvable." };
  }

  if (comment.user_id !== user.id) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();

    if (profile?.role !== "admin" && profile?.role !== "staff") {
      return { error: "Vous n'êtes pas autorisé à supprimer ce commentaire." };
    }
  }

  const { error } = await supabase.from("comments").delete().eq("id", commentId);

  if (error) {
    console.error("Failed to delete comment:", error);
    return { error: "Impossible de supprimer le commentaire." };
  }

  return { success: true };
}

// ==========================================
// ARTICLE COMMENTS (AZALÉE & CHRONIQUES)
// ==========================================

export interface Comment {
  id: string;
  content: string;
  is_edited: boolean;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  author: {
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
  reply_count: number;
  likes: number;
  user_liked: boolean;
}

export interface Reply {
  id: string;
  content: string;
  is_edited: boolean;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  author: {
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export async function getComments(
  articleId: string,
  sortBy: "newest" | "oldest" | "popular" = "newest",
): Promise<Comment[]> {
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const session = await getServerSession();
  const userId = session?.user?.id;

  const ascending = sortBy === "oldest";

  const { data: rawComments, error } = await client
    .from("article_comments")
    .select("id, content, is_edited, is_pinned, created_at, updated_at, parent_id, user_id")
    .eq("article_id", articleId)
    .is("parent_id", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending });

  if (error) {
    console.error("getComments error:", error);
    return [];
  }

  if (!rawComments || rawComments.length === 0) {
    return [];
  }

  const commentIds: string[] = rawComments.map((c: { id: string }) => c.id);
  const userIds: string[] = [
    ...new Set<string>(rawComments.map((c: { user_id: string }) => c.user_id).filter(Boolean)),
  ];

  const profilesMap = new Map<
    string,
    { id: string; username: string | null; full_name: string | null; avatar_url: string | null }
  >();
  if (userIds.length > 0) {
    const { data: profilesData } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .in("id", userIds);
    if (profilesData) {
      for (const p of profilesData as Array<{
        id: string;
        username: string | null;
        full_name: string | null;
        avatar_url: string | null;
      }>) {
        profilesMap.set(p.id, p);
      }
    }
  }

  const { data: repliesData } = await client.from("article_comments").select("parent_id").in("parent_id", commentIds);

  const replyCountMap = new Map<string, number>();
  if (repliesData) {
    for (const row of repliesData as Array<{ parent_id: string }>) {
      replyCountMap.set(row.parent_id, (replyCountMap.get(row.parent_id) || 0) + 1);
    }
  }

  const commentRefIds = commentIds.map(id => `comment:${id}`);

  const { data: likesData } = await client
    .from("article_reactions")
    .select("article_id, user_id")
    .in("article_id", commentRefIds)
    .eq("reaction_type", "comment_like");

  const likesCountMap = new Map<string, number>();
  const userLikedSet = new Set<string>();

  if (likesData) {
    for (const row of likesData as Array<{ article_id: string; user_id: string }>) {
      likesCountMap.set(row.article_id, (likesCountMap.get(row.article_id) || 0) + 1);
      if (userId && row.user_id === userId) {
        userLikedSet.add(row.article_id);
      }
    }
  }

  const comments: Comment[] = rawComments.map(
    (c: {
      id: string;
      content: string;
      is_edited: boolean;
      is_pinned: boolean;
      created_at: string;
      updated_at: string;
      parent_id: string | null;
      user_id: string;
    }) => {
      const ref = `comment:${c.id}`;
      const prof = profilesMap.get(c.user_id);
      return {
        author: {
          avatar_url: prof?.avatar_url ?? null,
          full_name: prof?.full_name ?? null,
          id: prof?.id ?? c.user_id,
          username: prof?.username ?? null,
        },
        content: c.content,
        created_at: c.created_at,
        id: c.id,
        is_edited: c.is_edited,
        is_pinned: c.is_pinned,
        likes: likesCountMap.get(ref) || 0,
        parent_id: c.parent_id,
        reply_count: replyCountMap.get(c.id) || 0,
        updated_at: c.updated_at,
        user_liked: userLikedSet.has(ref),
      };
    },
  );

  if (sortBy === "popular") {
    comments.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }
      return b.likes - a.likes;
    });
  }

  return comments;
}

export async function getReplies(parentId: string): Promise<Reply[]> {
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const { data, error } = await client
    .from("article_comments")
    .select("id, content, is_edited, is_pinned, created_at, updated_at, parent_id, user_id")
    .eq("parent_id", parentId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getReplies error:", error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  const userIds: string[] = [
    ...new Set<string>((data as Array<{ user_id: string }>).map(c => c.user_id).filter(Boolean)),
  ];

  const profilesMap = new Map<
    string,
    { id: string; username: string | null; full_name: string | null; avatar_url: string | null }
  >();
  if (userIds.length > 0) {
    const { data: profilesData } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .in("id", userIds);
    if (profilesData) {
      for (const p of profilesData as Array<{
        id: string;
        username: string | null;
        full_name: string | null;
        avatar_url: string | null;
      }>) {
        profilesMap.set(p.id, p);
      }
    }
  }

  return (
    data as Array<{
      id: string;
      content: string;
      is_edited: boolean;
      is_pinned: boolean;
      created_at: string;
      updated_at: string;
      parent_id: string | null;
      user_id: string;
    }>
  ).map(c => {
    const prof = profilesMap.get(c.user_id);
    return {
      author: {
        avatar_url: prof?.avatar_url ?? null,
        full_name: prof?.full_name ?? null,
        id: prof?.id ?? c.user_id,
        username: prof?.username ?? null,
      },
      content: c.content,
      created_at: c.created_at,
      id: c.id,
      is_edited: c.is_edited,
      is_pinned: c.is_pinned,
      parent_id: c.parent_id,
      updated_at: c.updated_at,
    };
  });
}

export async function createComment(articleId: string, content: string, parentId?: string): Promise<Comment> {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Non authentifié");
  }

  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    throw new Error("Le commentaire doit contenir entre 1 et 2000 caractères");
  }

  const userId = session.user.id;
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  if (parentId) {
    const { data: parent, error: parentError } = await client
      .from("article_comments")
      .select("id, article_id")
      .eq("id", parentId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new Error("Commentaire parent introuvable");
    }
    if (parent.article_id !== articleId) {
      throw new Error("Le commentaire parent n'appartient pas à cet article");
    }
  }

  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await client
    .from("article_comments")
    .insert({
      article_id: articleId,
      content: trimmed,
      created_at: now,
      is_edited: false,
      is_pinned: false,
      parent_id: parentId ?? null,
      updated_at: now,
      user_id: userId,
    })
    .select("id, content, is_edited, is_pinned, created_at, updated_at, parent_id, user_id")
    .single();

  if (insertError || !inserted) {
    console.error("createComment error:", insertError);
    throw new Error("Impossible de créer le commentaire");
  }

  const { data: authorProfile } = await client
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  const c = inserted as {
    id: string;
    content: string;
    is_edited: boolean;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    parent_id: string | null;
    user_id: string;
  };

  return {
    author: {
      avatar_url: authorProfile?.avatar_url ?? null,
      full_name: authorProfile?.full_name ?? null,
      id: authorProfile?.id ?? userId,
      username: authorProfile?.username ?? null,
    },
    content: c.content,
    created_at: c.created_at,
    id: c.id,
    is_edited: c.is_edited,
    is_pinned: c.is_pinned,
    likes: 0,
    parent_id: c.parent_id,
    reply_count: 0,
    updated_at: c.updated_at,
    user_liked: false,
  };
}

export async function updateComment(commentId: string, content: string): Promise<Comment> {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Non authentifié");
  }

  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    throw new Error("Le commentaire doit contenir entre 1 et 2000 caractères");
  }

  const userId = session.user.id;
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const { data: existing, error: fetchError } = await client
    .from("article_comments")
    .select("id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error("Commentaire introuvable");
  }
  if (existing.user_id !== userId) {
    throw new Error("Non autorisé");
  }

  const { data: updated, error: updateError } = await client
    .from("article_comments")
    .update({
      content: trimmed,
      is_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", commentId)
    .select("id, content, is_edited, is_pinned, created_at, updated_at, parent_id, user_id")
    .single();

  if (updateError || !updated) {
    console.error("updateComment error:", updateError);
    throw new Error("Impossible de modifier le commentaire");
  }

  const [{ count: replyCount }, { data: authorProfile }] = await Promise.all([
    client.from("article_comments").select("id", { count: "exact", head: true }).eq("parent_id", commentId),
    client.from("profiles").select("id, username, full_name, avatar_url").eq("id", userId).maybeSingle(),
  ]);

  const c = updated as {
    id: string;
    content: string;
    is_edited: boolean;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    parent_id: string | null;
    user_id: string;
  };

  return {
    author: {
      avatar_url: authorProfile?.avatar_url ?? null,
      full_name: authorProfile?.full_name ?? null,
      id: authorProfile?.id ?? userId,
      username: authorProfile?.username ?? null,
    },
    content: c.content,
    created_at: c.created_at,
    id: c.id,
    is_edited: c.is_edited,
    is_pinned: c.is_pinned,
    likes: 0,
    parent_id: c.parent_id,
    reply_count: replyCount || 0,
    updated_at: c.updated_at,
    user_liked: false,
  };
}

export async function deleteComment(commentId: string): Promise<void> {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Non authentifié");
  }

  const userId = session.user.id;
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const { data: comment, error: fetchError } = await client
    .from("article_comments")
    .select("id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment) {
    throw new Error("Commentaire introuvable");
  }

  if (comment.user_id !== userId) {
    const { data: profile } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();

    if (!profile || !isAdminRole(profile.role)) {
      throw new Error("Non autorisé");
    }
  }

  const { error: deleteError } = await client.from("article_comments").delete().eq("id", commentId);

  if (deleteError) {
    console.error("deleteComment error:", deleteError);
    throw new Error("Impossible de supprimer le commentaire");
  }
}

export async function pinComment(commentId: string): Promise<{ is_pinned: boolean }> {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Non authentifié");
  }

  const userId = session.user.id;
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const { data: profile } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();

  if (!profile || !isAdminRole(profile.role)) {
    throw new Error("Non autorisé");
  }

  const { data: comment, error: fetchError } = await client
    .from("article_comments")
    .select("id, is_pinned")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment) {
    throw new Error("Commentaire introuvable");
  }

  const newPinnedState = !comment.is_pinned;

  const { error: updateError } = await client
    .from("article_comments")
    .update({
      is_pinned: newPinnedState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", commentId);

  if (updateError) {
    console.error("pinComment error:", updateError);
    throw new Error("Impossible de modifier l'épinglage");
  }

  return { is_pinned: newPinnedState };
}

export async function getCommentCount(articleId: string): Promise<number> {
  const pool = getPgPool();

  try {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM article_comments WHERE article_id = $1",
      [articleId],
    );

    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    console.error("getCommentCount error:", error);
    return 0;
  }
}

export async function getCommentCounts(articleIds: string[]): Promise<Record<string, number>> {
  if (articleIds.length === 0) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const id of articleIds) {
    result[id] = 0;
  }

  const pool = getPgPool();

  try {
    const { rows } = await pool.query<{ article_id: string }>(
      "SELECT article_id FROM article_comments WHERE article_id = ANY($1)",
      [articleIds],
    );

    for (const row of rows) {
      result[row.article_id] = (result[row.article_id] || 0) + 1;
    }

    return result;
  } catch (error) {
    console.error("getCommentCounts error:", error);
    return {};
  }
}

export async function toggleCommentLike(commentId: string): Promise<{ liked: boolean; count: number }> {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Non authentifié");
  }

  const userId = session.user.id;
  const supabase = createPostgresClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const reactionArticleId = `comment:${commentId}`;

  const { data: existing } = await client
    .from("article_reactions")
    .select("id")
    .eq("article_id", reactionArticleId)
    .eq("user_id", userId)
    .eq("reaction_type", "comment_like")
    .maybeSingle();

  if (existing) {
    await client.from("article_reactions").delete().eq("id", existing.id);
  } else {
    await client.from("article_reactions").insert({
      article_id: reactionArticleId,
      reaction_type: "comment_like",
      user_id: userId,
    });
  }

  const { count } = await client
    .from("article_reactions")
    .select("id", { count: "exact", head: true })
    .eq("article_id", reactionArticleId)
    .eq("reaction_type", "comment_like");

  return { count: count || 0, liked: !existing };
}
