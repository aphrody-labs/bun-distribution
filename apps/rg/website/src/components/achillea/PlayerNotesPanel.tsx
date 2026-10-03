"use client";

import { useResetState } from "@/hooks/use-reset-state";

import { useId } from "react";
import { useEffect, useState, useMemo } from "react";
import { createAchilleaClient } from "@/lib/achillea";
import type { PlayerNote } from "@rosegriffon/achillea-types/domain/player-note";
import {
  PlayerNoteCategory,
  PlayerNoteSeverity,
} from "@rosegriffon/achillea-types/enums/eventEnums";
import {
  ShieldAlert,
  Search,
  Plus,
  CheckCircle2,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Info,
  AlertOctagon,
  Check,
  X,
  Loader2,
  MessageSquare,
  User as UserIcon,
} from "lucide-react";

interface PlayerNotesPanelProps {
  tournamentId?: number;
  candidates?: Array<{ id: string; label: string; avatar?: string }>;
  title?: string;
}

const CATEGORY_LABELS: Record<PlayerNoteCategory, string> = {
  [PlayerNoteCategory.BEHAVIOR]: "Comportement",
  [PlayerNoteCategory.CHEATING]: "Triche / Exploit",
  [PlayerNoteCategory.NO_SHOW]: "Absence / Retard",
  [PlayerNoteCategory.SCORE_DISPUTE]: "Litige de score",
  [PlayerNoteCategory.POSITIVE]: "Exemplaire",
  [PlayerNoteCategory.OTHER]: "Autre",
};

const SEVERITY_CONFIG: Record<
  PlayerNoteSeverity,
  { label: string; color: string; badge: string; icon: any }
> = {
  [PlayerNoteSeverity.INFO]: {
    label: "Information",
    color: "text-blue-400",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Info,
  },
  [PlayerNoteSeverity.WARNING]: {
    label: "Avertissement",
    color: "text-amber-400",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    icon: AlertTriangle,
  },
  [PlayerNoteSeverity.SERIOUS]: {
    label: "Grave",
    color: "text-red-400",
    badge: "bg-red-500/10 text-red-400 border-red-500/20",
    icon: AlertOctagon,
  },
};

export function PlayerNotesPanel({
  tournamentId,
  candidates = [],
  title = "Notes & Signalements Staff",
}: PlayerNotesPanelProps) {
  const controlId = useId();

  const [notes, setNotes] = useState<PlayerNote[]>([]);
  const [loading, setLoading] = useResetState<boolean>(true, tournamentId);
  const [error, setError] = useResetState<string | null>(null, tournamentId);

  // Filters
  const [search, setSearch] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [resolvedFilter, setResolvedFilter] = useState<string>("all");

  // Creation Modal
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [targetId, setTargetId] = useState<string>("");
  const [targetNameInput, setTargetNameInput] = useState<string>("");
  const [category, setCategory] = useState<PlayerNoteCategory>(PlayerNoteCategory.BEHAVIOR);
  const [severity, setSeverity] = useState<PlayerNoteSeverity>(PlayerNoteSeverity.INFO);
  const [content, setContent] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Staff notes live on the unified RG API; the ranked bot API has no such route.
  const client = useMemo(
    () =>
      createAchilleaClient({
        baseUrl: "https://api.rosegriffon.fr/v1/achillea",
        credentials: "include",
      }),
    [],
  );

  const loadNotes = async () => {
    try {
      const res = await client.playerNotes.list({
        tournamentId: tournamentId ?? undefined,
        pageSize: 100,
      });
      if (res.ok) {
        setNotes(res.value.data ?? []);
      } else {
        setError(res.detail || "Impossible de charger les signalements.");
      }
    } catch {
      setError("Erreur de connexion avec le service des notes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [tournamentId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalTargetId = targetId || targetNameInput.trim();
    if (!finalTargetId) {
      setError("Veuillez sélectionner ou renseigner un joueur cible.");
      return;
    }
    if (content.trim().length < 3) {
      setError("Le contenu de la note doit comporter au moins 3 caractères.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await client.playerNotes.create({
        targetId: finalTargetId,
        tournamentId: tournamentId ?? null,
        category,
        severity,
        content: content.trim(),
      });

      if (res.ok) {
        setDialogOpen(false);
        setContent("");
        setTargetId("");
        setTargetNameInput("");
        setLoading(true);
        setError(null);
        await loadNotes();
      } else {
        setError(res.detail || "Échec de création du signalement.");
      }
    } catch {
      setError("Erreur inattendue lors de la sauvegarde.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleResolve = async (note: PlayerNote) => {
    try {
      if (note.resolved) {
        await client.playerNotes.reopen(note.id);
      } else {
        await client.playerNotes.resolve(note.id);
      }
      setLoading(true);
      setError(null);
      await loadNotes();
    } catch {
      setError("Impossible de mettre à jour le statut du signalement.");
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm("Voulez-vous vraiment supprimer cette observation staff ?")) return;
    try {
      await client.playerNotes.remove(noteId);
      setLoading(true);
      setError(null);
      await loadNotes();
    } catch {
      setError("Impossible de supprimer la note.");
    }
  };

  // Filtered notes
  const filteredNotes = notes.filter((n) => {
    if (categoryFilter !== "all" && n.category !== categoryFilter) return false;
    if (severityFilter !== "all" && n.severity !== severityFilter) return false;
    if (resolvedFilter === "open" && n.resolved) return false;
    if (resolvedFilter === "resolved" && !n.resolved) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const targetMatch =
        n.target?.username?.toLowerCase().includes(q) ||
        n.target?.displayName?.toLowerCase().includes(q);
      const contentMatch = n.content?.toLowerCase().includes(q);
      const authorMatch = n.author?.username?.toLowerCase().includes(q);
      if (!targetMatch && !contentMatch && !authorMatch) return false;
    }
    return true;
  });

  const openCount = notes.filter((n) => !n.resolved).length;
  const resolvedCount = notes.filter((n) => n.resolved).length;

  return (
    <div className="border border-border bg-card rounded-2xl p-6 space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <ShieldAlert className="w-5 h-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base">{title}</h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-muted text-muted-foreground">
                {notes.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Espace d'arbitrage confidentiel réservé au staff et organisateurs.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (candidates.length > 0) setTargetId(candidates[0].id);
              setDialogOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Ajouter une observation
          </button>
        </div>
      </div>

      {/* Status Counters & Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filtrer par joueur, auteur, mot-clé..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Filter selects */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Toutes catégories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Toutes gravités</option>
            <option value={PlayerNoteSeverity.INFO}>Information</option>
            <option value={PlayerNoteSeverity.WARNING}>Avertissement</option>
            <option value={PlayerNoteSeverity.SERIOUS}>Grave</option>
          </select>

          <select
            value={resolvedFilter}
            onChange={(e) => setResolvedFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Tous ({notes.length})</option>
            <option value="open">En attente ({openCount})</option>
            <option value="resolved">Traités ({resolvedCount})</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Notes List */}
      {loading ? (
        <div className="py-12 text-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Chargement des signalements…</p>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-border rounded-xl text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Aucun signalement trouvé</p>
          <p>Toutes les observations staff ont été traitées ou correspondent aux filtres.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map((note) => {
            const sev = SEVERITY_CONFIG[note.severity] ?? SEVERITY_CONFIG[PlayerNoteSeverity.INFO];
            const SevIcon = sev.icon;

            return (
              <div
                key={note.id}
                className={`p-4 rounded-xl border transition ${
                  note.resolved
                    ? "bg-card/40 border-border/60 opacity-70"
                    : "bg-card border-border shadow-xs hover:border-border/80"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Target user */}
                      <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                        <UserIcon className="w-3.5 h-3.5 text-primary" />
                        <span>
                          {note.target?.displayName ?? note.target?.username ?? "Joueur inconnu"}
                        </span>
                      </div>

                      {/* Category Badge */}
                      <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-muted text-muted-foreground border border-border">
                        {CATEGORY_LABELS[note.category] ?? note.category}
                      </span>

                      {/* Severity Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${sev.badge}`}
                      >
                        <SevIcon className="w-3 h-3" />
                        {sev.label}
                      </span>

                      {/* Resolved indicator */}
                      {note.resolved ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Traité
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          À traiter
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line pt-1">
                      {note.content}
                    </p>

                    {/* Metadata (Author, Date, Tournament) */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                      <span>Rapporté par {note.author?.username ?? "Staff"}</span>
                      {note.tournament && <span>• Tournoi : {note.tournament.name}</span>}
                      <span>• {new Date(note.createdAt).toLocaleString("fr-FR")}</span>
                      {note.resolved && note.resolvedBy && (
                        <span>• Résolu par {note.resolvedBy.username}</span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleResolve(note)}
                      title={note.resolved ? "Marquer non résolu" : "Marquer comme traité"}
                      className={`p-1.5 rounded-lg border transition text-xs flex items-center gap-1 font-semibold ${
                        note.resolved
                          ? "border-border hover:bg-muted text-muted-foreground"
                          : "bg-emerald-600/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-600/20"
                      }`}
                    >
                      {note.resolved ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Rouvrir</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Résoudre</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      title="Supprimer la note"
                      className="p-1.5 rounded-lg border border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Saisie de Note */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
          <div className="border border-border bg-card rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <MessageSquare className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-sm">Nouvelle observation staff</h3>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              {/* Target player */}
              <div className="space-y-1">
                <label className="font-bold text-foreground" htmlFor={`${controlId}-0`}>
                  Joueur concerné *
                </label>
                {candidates.length > 0 ? (
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                    id={`${controlId}-0`}
                  >
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Identifiant ou pseudo du joueur (ex: user_123)"
                    value={targetNameInput}
                    onChange={(e) => setTargetNameInput(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                    required
                    id={`${controlId}-0`}
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-foreground" htmlFor={`${controlId}-1`}>
                    Catégorie *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as PlayerNoteCategory)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                    id={`${controlId}-1`}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-foreground" htmlFor={`${controlId}-2`}>
                    Niveau de gravité *
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as PlayerNoteSeverity)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                    id={`${controlId}-2`}
                  >
                    <option value={PlayerNoteSeverity.INFO}>Information</option>
                    <option value={PlayerNoteSeverity.WARNING}>Avertissement</option>
                    <option value={PlayerNoteSeverity.SERIOUS}>Grave / Critique</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-foreground" htmlFor={`${controlId}-3`}>
                  Observation & Détails *
                </label>
                <textarea
                  rows={4}
                  placeholder="Précisez le contexte du comportement, l'infraction constatée, les avertissements verbaux donnés..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-xs leading-relaxed"
                  required
                  id={`${controlId}-3`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="px-4 py-2 border border-border rounded-xl font-semibold hover:bg-muted transition text-xs"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition shadow-sm text-xs disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Consigner l'observation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
