"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  Textarea,
  Badge,
} from "@rosegriffon/ui";
import { MessageSquare, Trash2, Send, ShieldAlert, Award } from "lucide-react";
import { subscribeTable } from "@/lib/realtime";

import { useAuth } from "@/contexts/auth-context";
import {
  addCommentAction,
  deleteCommentAction,
  getCommentsAction,
  getPublicCommentProfile,
} from "@/app/actions/comments";
import { toast } from "sonner";

interface CommentProfile {
  username: string | null;
  avatar_url: string | null;
  role: string | null;
  badges: string[] | null;
}

interface Comment {
  id: string;
  content: string;
  target_id: string;
  target_type: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  profiles: CommentProfile | null;
}

/** Ligne brute de `public.comments` telle que diffusée par rg-realtime. */
type CommentRow = Omit<Comment, "profiles">;

interface CommentsSectionProps {
  targetId: string;
  targetType: "article" | "stream";
  className?: string;
}

export function CommentsSection({ targetId, targetType, className = "" }: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const { user } = useAuth();
  const session = user ? { user } : null;
  // `window.location` n'existe pas pendant le rendu serveur : l'y lire faisait
  // échouer le SSR de toute page portant les commentaires (les chroniques
  // n'arrivaient plus qu'en squelette, sans <h1> ni texte, donc sans contenu
  // indexable). `usePathname` donne le même chemin des deux côtés.
  const pathname = usePathname();
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Charger les commentaires initiaux
  useEffect(() => {
    async function loadComments() {
      try {
        setIsLoading(true);
        const { data, error } = await getCommentsAction(targetId, targetType);

        if (error) {
          console.error("Error loading comments:", error);
          toast.error("Impossible de charger les commentaires.");
        } else {
          setComments(data as unknown as Comment[]);
        }
      } catch (err) {
        console.error("Failed to load comments:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadComments();
  }, [targetId, targetType]);

  // S'abonner aux changements en temps réel (service rg-realtime, SSE)
  useEffect(() => {
    return subscribeTable<CommentRow>(
      { filter: `target_id=eq.${targetId}`, table: "comments" },
      async (event) => {
        if (event.eventType === "INSERT") {
          const inserted = event.new;
          if (!inserted || inserted.target_type !== targetType) return;

          // Récupérer les informations de profil de l'auteur
          const profile = await getPublicCommentProfile(inserted.user_id);

          const enriched: Comment = {
            id: inserted.id,
            content: inserted.content,
            target_id: inserted.target_id,
            target_type: inserted.target_type,
            user_id: inserted.user_id,
            created_at: inserted.created_at,
            updated_at: inserted.updated_at,
            profiles: profile as CommentProfile | null,
          };

          setComments((prev) => {
            if (prev.some((c) => c.id === enriched.id)) return prev;
            return [...prev, enriched];
          });

          // Scroller tout en bas si c'est pour un stream (tchat live)
          if (targetType === "stream") {
            setTimeout(() => {
              commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 100);
          }
        } else if (event.eventType === "DELETE") {
          const removed = event.old;
          if (removed) setComments((prev) => prev.filter((c) => c.id !== removed.id));
        } else if (event.eventType === "UPDATE") {
          const updated = event.new;
          if (!updated) return;
          setComments((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, content: updated.content, updated_at: updated.updated_at }
                : c,
            ),
          );
        }
      },
    );
  }, [targetId, targetType]);

  // Scroller en bas au chargement initial ou lors de nouveaux messages (pour le stream)
  useEffect(() => {
    if (targetType === "stream" && comments.length > 0) {
      commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments, targetType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user) {
      toast.error("Vous devez être connecté pour commenter.");
      return;
    }

    const content = newComment.trim();
    if (!content) return;

    setIsSubmitting(true);
    try {
      const res = await addCommentAction(targetId, targetType, content);
      if (res.error) {
        toast.error(res.error);
      } else {
        setNewComment("");
        // Si ce n'est pas un stream, on affiche un toast de succès
        if (targetType === "article") {
          toast.success("Commentaire publié !");
        }
      }
    } catch (err) {
      console.error("Failed to post comment:", err);
      toast.error("Une erreur est survenue.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("Voulez-vous vraiment supprimer ce commentaire ?")) return;

    try {
      const res = await deleteCommentAction(commentId);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Commentaire supprimé.");
      }
    } catch (err) {
      console.error("Failed to delete comment:", err);
      toast.error("Une erreur est survenue lors de la suppression.");
    }
  };

  const isLiveChat = targetType === "stream";

  return (
    <Card
      className={`border-2 bg-white/90 dark:bg-gray-900/90 shadow-xl backdrop-blur-md ${className}`}
    >
      <CardContent className="p-4 sm:p-6 flex flex-col h-full">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
          <MessageSquare className="size-5 text-[#a14b3f]" />
          <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">
            {isLiveChat ? "Tchat Live" : "Commentaires"}
          </h3>
          <span className="text-sm text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full font-semibold">
            {comments.length}
          </span>
        </div>

        {/* Liste des commentaires */}
        <div
          className={`space-y-4 overflow-y-auto pr-1 flex-1 ${
            isLiveChat ? "max-h-[350px] min-h-[250px]" : "max-h-[500px]"
          }`}
        >
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <span className="animate-spin size-6 border-2 border-[#a14b3f] border-t-transparent rounded-full" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm italic">
              {isLiveChat
                ? "Le tchat est vide. Lancez la discussion !"
                : "Aucun commentaire pour le moment. Soyez le premier à réagir !"}
            </p>
          ) : (
            comments.map((comment) => {
              const isOwner = session?.user && session.user.id === comment.user_id;
              const isAdminOrStaff =
                session?.user &&
                (comment.profiles?.role === "admin" || comment.profiles?.role === "staff");

              return (
                <div
                  key={comment.id}
                  className="flex gap-3 group items-start hover:bg-gray-50/50 dark:hover:bg-gray-800/30 p-2 rounded-lg transition-all duration-200"
                >
                  <Avatar className="size-8 sm:size-9 border border-gray-200 dark:border-gray-800 shadow-sm">
                    <AvatarImage src={comment.profiles?.avatar_url || ""} />
                    <AvatarFallback className="bg-[#a14b3f]/10 text-[#a14b3f] font-bold text-xs uppercase">
                      {(comment.profiles?.username || "U").substring(0, 2)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm">
                      <span className="font-bold text-gray-900 dark:text-gray-100 truncate max-w-[120px] sm:max-w-[180px]">
                        {comment.profiles?.username || "Utilisateur"}
                      </span>

                      {/* Rôle badge */}
                      {comment.profiles?.role === "admin" && (
                        <Badge className="bg-[#a14b3f] text-white hover:bg-[#a14b3f] scale-90 origin-left px-1.5 py-0">
                          <ShieldAlert className="size-3 mr-0.5 inline" />
                          Admin
                        </Badge>
                      )}
                      {comment.profiles?.role === "staff" && (
                        <Badge className="bg-blue-600 text-white hover:bg-blue-600 scale-90 origin-left px-1.5 py-0">
                          Staff
                        </Badge>
                      )}

                      {/* Badges cosmétiques */}
                      {comment.profiles?.badges && comment.profiles.badges.length > 0 && (
                        <div className="flex gap-0.5 scale-90 origin-left">
                          {comment.profiles.badges.slice(0, 3).map((b, idx) => (
                            <span key={idx} title={b}>
                              <Award className="size-3.5 text-yellow-500 fill-yellow-500/20" />
                            </span>
                          ))}
                        </div>
                      )}

                      <span className="text-gray-400 text-[10px] sm:text-xs">
                        •{" "}
                        {new Date(comment.created_at).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700 dark:text-gray-300 break-words leading-relaxed whitespace-pre-line">
                      {comment.content}
                    </p>
                  </div>

                  {/* Action supprimer */}
                  {(isOwner || isAdminOrStaff) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all duration-200"
                      onClick={() => handleDelete(comment.id)}
                      title="Supprimer"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })
          )}
          <div ref={commentsEndRef} />
        </div>

        {/* Formulaire d'envoi */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          {session?.user ? (
            <form onSubmit={handleSubmit} className="flex gap-2 items-end">
              <Textarea
                placeholder={isLiveChat ? "Envoyer un message..." : "Ajouter un commentaire..."}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="flex-1 min-h-[40px] max-h-[120px] text-sm resize-none focus-visible:ring-[#a14b3f] bg-gray-50/50 dark:bg-gray-800/50"
                maxLength={1000}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isSubmitting || !newComment.trim()}
                className="bg-[#a14b3f] hover:bg-[#a14b3f]/90 text-white shrink-0 size-10"
              >
                {isSubmitting ? (
                  <span className="animate-spin size-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </form>
          ) : (
            <div className="text-center py-4 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-dashed border-gray-200 dark:border-gray-800">
              <p className="text-sm text-gray-500 mb-2">
                Connecte-toi pour participer à la discussion !
              </p>
              <Button asChild size="sm" className="bg-[#a14b3f] hover:bg-[#a14b3f]/90 text-white">
                <a href={`/login?redirect=${encodeURIComponent(pathname)}`}>Se connecter</a>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
