"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Plus,
  Save,
  Sparkles,
  TestTube,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { PlainField } from "@/components/editor/PlainField";

interface AchievementTrigger {
  code: string;
  description: string | null;
  pattern: string;
  flags: string | null;
  enabled: boolean;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-4 border border-red-500/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto btn btn-ghost px-1 py-1"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary bg-red-600 hover:bg-red-500 border-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Page de gestion des déclencheurs de succès (achievement_triggers).
 * Un déclencheur est un pattern regex : quand un message d'un joueur
 * correspond, le succès associé lui est attribué automatiquement.
 */
export default function TriggersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AchievementTrigger | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AchievementTrigger | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const triggers = useQuery({
    queryKey: ["triggers", "list"],
    queryFn: () =>
      api.get<{ rows: AchievementTrigger[]; total: number }>(
        "/database/achievement_triggers?limit=200",
      ),
  });

  const remove = useMutation({
    mutationFn: (code: string) =>
      api.delete(`/database/achievement_triggers/${encodeURIComponent(code)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["triggers"] });
      showSuccess("Déclencheur supprimé.");
    },
  });

  const refresh = useMutation({
    mutationFn: () => api.post("/services/achievements/refresh"),
    onSuccess: () => showSuccess("Cache des déclencheurs rechargé sur le bot."),
  });

  return (
    <div className="space-y-4">
      {confirmDelete && (
        <ConfirmDialog
          title={`Supprimer le déclencheur « ${confirmDelete.code} » ?`}
          message="Ce déclencheur sera définitivement supprimé. Le succès associé ne pourra plus être déclenché automatiquement par messages."
          confirmLabel="Supprimer définitivement"
          onConfirm={() => {
            remove.mutate(confirmDelete.code);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* En-tête */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Déclencheurs de succès</h2>
          <span className="ml-2 text-xs text-zinc-500">
            {triggers.data?.total ?? 0} déclencheur
            {(triggers.data?.total ?? 0) !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            className="ml-auto btn btn-ghost"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            title="Recharger le cache des déclencheurs côté bot"
          >
            <RefreshCw className={`h-3 w-3 ${refresh.isPending ? "animate-spin" : ""}`} />
            Recharger le cache
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3" /> Créer un déclencheur
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Un déclencheur surveille les messages des joueurs. Quand un message correspond à
          l&apos;expression régulière définie, le succès correspondant est attribué automatiquement
          (une seule fois par joueur). Pensez à recharger le cache après toute modification.
        </p>
      </div>

      {/* Feedback */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Testeur regex */}
      <RegexTester />

      {/* Chargement */}
      {triggers.isLoading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des déclencheurs…
        </div>
      )}

      {/* Erreur */}
      {triggers.isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Impossible de charger les déclencheurs. Réessayez.
        </div>
      )}

      {/* Liste */}
      <div className="space-y-2">
        {triggers.data?.rows.map((t) => (
          <TriggerCard
            key={t.code}
            trigger={t}
            onEdit={() => setEditing(t)}
            onDelete={() => setConfirmDelete(t)}
          />
        ))}
        {triggers.data?.rows.length === 0 && !triggers.isLoading && (
          <div className="card text-center text-zinc-500">
            Aucun déclencheur pour le moment. Créez le premier !
          </div>
        )}
      </div>

      {/* Formulaire création / édition */}
      {(editing || creating) && (
        <TriggerEditor
          trigger={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["triggers"] });
            refresh.mutate();
            showSuccess(editing ? "Déclencheur modifié." : "Déclencheur créé et cache rechargé.");
          }}
        />
      )}
    </div>
  );
}

function TriggerCard({
  trigger,
  onEdit,
  onDelete,
}: {
  trigger: AchievementTrigger;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const valid = useMemo(() => {
    try {
      new RegExp(trigger.pattern, trigger.flags ?? "i");
      return true;
    } catch {
      return false;
    }
  }, [trigger.pattern, trigger.flags]);

  return (
    <div className={`card ${trigger.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-semibold text-brand-300">{trigger.code}</code>
            {!trigger.enabled && <span className="badge badge-error">Désactivé</span>}
            {!valid && <span className="badge badge-error">Expression invalide</span>}
          </div>
          {trigger.description ? (
            <p className="mt-1 text-xs text-zinc-400">{trigger.description}</p>
          ) : (
            <p className="mt-1 text-xs italic text-zinc-600">Aucune description</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-zinc-900 px-2 py-1 font-mono text-[11px]">
              /{trigger.pattern}/{trigger.flags ?? ""}
            </code>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className="btn btn-ghost" onClick={onEdit}>
            Modifier
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2 text-red-400"
            title="Supprimer ce déclencheur"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TriggerEditor({
  trigger,
  onClose,
  onSaved,
}: {
  trigger: AchievementTrigger | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !trigger;
  const [draft, setDraft] = useState<AchievementTrigger>(
    trigger ?? {
      code: "",
      description: "",
      pattern: "",
      flags: "i",
      enabled: true,
    },
  );
  const [error, setError] = useState<string | null>(null);

  const regexValid = useMemo(() => {
    try {
      new RegExp(draft.pattern, draft.flags ?? "i");
      return true;
    } catch (e) {
      return (e as Error).message;
    }
  }, [draft.pattern, draft.flags]);

  const save = useMutation({
    mutationFn: async (payload: AchievementTrigger) => {
      if (isCreate) {
        return api.post("/database/achievement_triggers", payload);
      }
      return api.put(`/database/achievement_triggers/${encodeURIComponent(payload.code)}`, payload);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!draft.code || !draft.pattern) {
      setError("Le code et l'expression régulière sont obligatoires.");
      return;
    }
    if (regexValid !== true) {
      setError(`Expression invalide : ${regexValid}`);
      return;
    }
    save.mutate(draft);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
      <form
        onSubmit={submit}
        className="card w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">
            {isCreate ? "Créer un déclencheur" : `Modifier « ${draft.code} »`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto btn btn-ghost px-2"
            aria-label="Fermer"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
            {error}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-zinc-500">
              Code du succès
              <span className="ml-1 text-zinc-600">— identifiant unique</span>
            </label>
            <input
              className="input w-full font-mono text-xs"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              disabled={!isCreate}
              placeholder="KAMEHAMEHA_FAN"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Actif</label>
            <button
              type="button"
              className={`btn ${draft.enabled ? "btn-primary" : "btn-ghost"} w-full`}
              onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
            >
              {draft.enabled ? "Actif — surveille les messages" : "Désactivé — ignoré"}
            </button>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-zinc-500">
              Description (explique quand ce succès est déclenché)
            </label>
            <input
              className="input w-full"
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Déclenché quand le joueur écrit 'Kamehameha' dans un message."
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Expression régulière (pattern)</label>
            <input
              className="input w-full font-mono text-xs"
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
              placeholder="kameham(é|e)ha"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">
              Options (flags)
              <span className="ml-1 text-zinc-600">— ex. i, gi, im</span>
            </label>
            <input
              className="input w-full font-mono text-xs"
              value={draft.flags ?? ""}
              onChange={(e) => setDraft({ ...draft, flags: e.target.value })}
              placeholder="i"
            />
          </div>
        </div>
        {regexValid === true ? (
          <p className="flex items-center gap-1 text-xs text-emerald-400">
            <Check className="h-3 w-3" /> Expression valide
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" /> {regexValid}
          </p>
        )}
        <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={save.isPending || regexValid !== true}
          >
            <Save className="h-3 w-3" />
            {save.isPending
              ? "Enregistrement…"
              : isCreate
                ? "Créer le déclencheur"
                : "Enregistrer les modifications"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Testeur d'expression régulière côté navigateur.
 * Aucun appel serveur — utilise new RegExp() JavaScript.
 */
function RegexTester() {
  const [pattern, setPattern] = useState("kameham(é|e)ha");
  const [flags, setFlags] = useState("i");
  const [sample, setSample] = useState("Goku lance un Kamehameha sur Cell !");

  const result = useMemo(() => {
    try {
      const rx = new RegExp(pattern, flags);
      const m = rx.exec(sample);
      if (!m) return { ok: true, matched: false };
      return {
        ok: true,
        matched: true,
        match: m[0],
        index: m.index,
        groups: m.slice(1),
        named: m.groups ?? null,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [pattern, flags, sample]);

  return (
    <div className="card">
      <div className="flex items-center gap-2">
        <TestTube className="h-5 w-5 text-brand-400" />
        <h3 className="font-semibold">Testeur d&apos;expression</h3>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Testez votre expression régulière en temps réel avant de la créer. Le moteur JavaScript et
        celui du bot partagent la même syntaxe.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px]">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Expression (pattern)</label>
          <input
            className="input w-full font-mono text-xs"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="votre expression"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Options (flags)</label>
          <input
            className="input w-full font-mono text-xs"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            placeholder="i, gi, im…"
          />
        </div>
      </div>
      <div className="mt-2">
        <label className="mb-1 block text-xs text-zinc-500">Message à tester</label>
        <PlainField
          value={sample}
          onChange={setSample}
          minRows={2}
          maxRows={8}
          placeholder="Tapez un message pour tester l'expression…"
        />
      </div>
      <div className="mt-2 text-xs">
        {!result.ok ? (
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle className="h-3 w-3" /> {result.error}
          </span>
        ) : result.matched ? (
          <div className="space-y-1 text-emerald-400">
            <div className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              <span>
                Correspondance trouvée : <code>&quot;{result.match}&quot;</code> à la position{" "}
                {result.index}
              </span>
            </div>
            {result.groups && result.groups.length > 0 && (
              <div className="text-zinc-300">
                Groupes capturés :{" "}
                {result.groups.map((g, i) => (
                  <code key={i} className="ml-1 rounded bg-zinc-800 px-1">
                    {g ?? "—"}
                  </code>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="text-zinc-500">Aucune correspondance dans ce message.</span>
        )}
      </div>
    </div>
  );
}
