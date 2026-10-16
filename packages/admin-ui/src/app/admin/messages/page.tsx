"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alimentation, Enregistrer, Oeil, Reinitialiser } from "@shenron/ui/icones";
import { useEffect, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { PlainField } from "@/components/editor/PlainField";

interface EventVariable {
  name: string;
  description: string;
}

interface EventEntry {
  event: string;
  description: string;
  defaultTemplate: string;
  defaultChannelKey: string;
  template: string;
  channelKey: string;
  enabled: boolean;
  isCustom: boolean;
  embed: boolean;
  variables: EventVariable[];
}

const CHANNEL_KEYS: { key: string; label: string; virtual?: boolean }[] = [
  { key: "channel.announce", label: "Annonces générales" },
  { key: "channel.achievement", label: "Accomplissements" },
  { key: "channel.level", label: "Niveau et XP" },
  { key: "channel.welcome", label: "Bienvenue" },
  { key: "channel.farewell", label: "Au revoir" },
  { key: "channel.giveaway", label: "Tirages au sort" },
  { key: "channel.mod_notify", label: "Notifications de modération" },
  { key: "channel.log_sanction", label: "Journaux des sanctions" },
  {
    key: "channel.dm",
    label: "Message privé au membre concerné",
    virtual: true,
  },
  { key: "channel.invocation", label: "Salon d'invocation", virtual: true },
  { key: "channel.ticket", label: "Salon du ticket", virtual: true },
];

const VIRTUAL_CHANNEL_KEYS = new Set(["channel.dm", "channel.invocation", "channel.ticket"]);

export default function MessagesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["messages"],
    queryFn: () => api.get<{ events: EventEntry[] }>("/messages"),
  });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && data?.events[0]) setSelected(data.events[0].event);
  }, [data, selected]);

  if (isLoading)
    return (
      <div className="dbz-panel p-8 text-center">
        <p className="font-saiyan text-dbz-orange text-xl mb-2">CHARGEMENT…</p>
        <p className="text-sm text-white/50">Récupération des messages automatiques.</p>
      </div>
    );

  if (isError)
    return (
      <div className="dbz-panel p-6 text-center border-l-4 border-red-500">
        <p className="font-saiyan text-red-400 mb-2">Erreur de chargement</p>
        <p className="text-sm text-white/50">Impossible de récupérer les messages. Vérifiez que le bot est en ligne.</p>
      </div>
    );

  const events = data?.events ?? [];
  const current = events.find(e => e.event === selected);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">MESSAGES AUTOMATIQUES</h1>
        <p className="text-sm text-white/60 mb-1">
          Configurez les messages envoyés automatiquement par le bot lors d&apos;événements sur le serveur.
        </p>
        <p className="text-xs text-white/50 uppercase tracking-widest">
          {events.length} événement{events.length !== 1 ? "s" : ""} · rechargé côté bot sous 30 secondes
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Liste des événements */}
        <div className="dbz-panel p-4 lg:col-span-1">
          <h3 className="font-saiyan text-dbz-yellow text-base uppercase mb-3">Événements ({events.length})</h3>
          <p className="text-xs text-white/50 mb-3">
            Cliquez sur un événement pour modifier son message et son salon de destination.
          </p>
          <div className="space-y-1">
            {events.map(e => (
              <button
                key={e.event}
                type="button"
                onClick={() => setSelected(e.event)}
                className={`flex w-full items-start gap-2 rounded p-2 text-left text-sm transition-colors ${
                  selected === e.event
                    ? "bg-dbz-orange/10 border border-dbz-orange/30"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="flex-1">
                  <p className="font-medium text-white text-xs truncate">{e.description || e.event}</p>
                  <code className="font-mono text-[10px] text-white/50">{e.event}</code>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {e.isCustom && (
                    <span className="text-[9px] px-1.5 py-0.5 border border-dbz-yellow/50 text-dbz-yellow rounded uppercase tracking-widest">
                      modifié
                    </span>
                  )}
                  {!e.enabled && (
                    <span className="text-[9px] px-1.5 py-0.5 border border-red-500/50 text-red-400 rounded uppercase tracking-widest">
                      désactivé
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Éditeur */}
        <div className="lg:col-span-2">
          {current ? (
            <EventEditor entry={current} />
          ) : (
            <div className="dbz-panel p-8 text-center text-white/50">
              Sélectionnez un événement pour modifier son message.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventEditor({ entry }: { entry: EventEntry }) {
  const qc = useQueryClient();
  const [template, setTemplate] = useState(entry.template);
  const [channelKey, setChannelKey] = useState(entry.channelKey);
  const [enabled, setEnabled] = useState(entry.enabled);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>(() =>
    Object.fromEntries(entry.variables.map(v => [v.name, defaultPreviewValue(v.name)])),
  );
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  useEffect(() => {
    setTemplate(entry.template);
    setChannelKey(entry.channelKey);
    setEnabled(entry.enabled);
    setPreviewVars(Object.fromEntries(entry.variables.map(v => [v.name, defaultPreviewValue(v.name)])));
    setPreviewResult(null);
  }, [entry]);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/messages/${entry.event}`, {
        template: template === entry.defaultTemplate ? null : template,
        channelKey: channelKey === entry.defaultChannelKey ? null : channelKey,
        enabled,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });

  const reset = useMutation({
    mutationFn: () => api.delete(`/messages/${entry.event}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });

  const preview = useMutation({
    mutationFn: () => api.post<{ rendered: string }>(`/messages/${entry.event}/preview`, previewVars),
    onSuccess: data => setPreviewResult(data.rendered),
    onError: err => setPreviewResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <div className="space-y-4">
      {/* Éditeur principal */}
      <div className="dbz-panel p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-saiyan text-dbz-yellow text-base uppercase mb-0.5">
              {entry.description || entry.event}
            </h3>
            <code className="text-xs font-mono text-white/50">{entry.event}</code>
            {entry.embed && (
              <p className="text-xs text-dbz-blue-light mt-1">
                Ce message est envoyé sous forme d&apos;encart enrichi (embed Discord).
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={`dbz-button !text-xs !py-1 !px-3 shrink-0 flex items-center gap-1.5 ${!enabled ? "opacity-50" : ""}`}
          >
            <Alimentation className="h-3 w-3" />
            {enabled ? "Activé" : "Désactivé"}
          </button>
        </div>

        {/* Salon de destination */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light mb-1">
            Salon de destination
          </label>
          <p className="text-xs text-white/50 mb-2">Choisissez dans quel salon Discord ce message sera envoyé.</p>
          <select
            className="w-full bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-2 text-sm"
            value={channelKey}
            onChange={e => setChannelKey(e.target.value)}
          >
            {CHANNEL_KEYS.map(k => (
              <option key={k.key} value={k.key}>
                {k.label}
                {k.virtual ? " (contextuel)" : ""}
              </option>
            ))}
          </select>
          <ResolvedChannel channelKey={channelKey} />
        </div>

        {/* Template */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light mb-1">
            Contenu du message
          </label>
          <p className="text-xs text-white/50 mb-2">
            Utilisez <code className="text-dbz-yellow">{"{nom}"}</code> pour insérer des valeurs dynamiques (voir la
            liste ci-dessous).
          </p>
          <PlainField value={template} onChange={setTemplate} minRows={5} maxRows={20} monospace />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="dbz-button flex items-center gap-1.5 disabled:opacity-40"
          >
            <Enregistrer className="h-3 w-3" />
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {entry.isCustom && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Remettre le message de "${entry.description || entry.event}" à sa valeur par défaut ?`))
                  reset.mutate();
              }}
              disabled={reset.isPending}
              className="dbz-button-ghost flex items-center gap-1.5"
            >
              <Reinitialiser className="h-3 w-3" />
              Remettre par défaut
            </button>
          )}
          {save.isSuccess && <span className="text-xs text-green-400 self-center">Message enregistré.</span>}
          {save.isError && (
            <span className="text-xs text-red-400 self-center">
              Erreur : {save.error instanceof Error ? save.error.message : "erreur inconnue"}
            </span>
          )}
        </div>
      </div>

      {/* Aperçu avec variables */}
      {entry.variables.length > 0 && (
        <div className="dbz-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Oeil className="h-4 w-4 text-dbz-blue-light" />
            <h3 className="font-saiyan text-dbz-blue-light text-base uppercase">Prévisualiser le message</h3>
          </div>
          <p className="text-xs text-white/50">
            Renseignez des exemples pour chaque variable et générez un aperçu du message final.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {entry.variables.map(v => (
              <div key={v.name}>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light mb-1">
                  <code className="text-dbz-yellow normal-case font-mono">{`{${v.name}}`}</code>
                  {" — "}
                  <span className="text-white/50 normal-case font-normal">{v.description}</span>
                </label>
                <input
                  className="w-full bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-2 text-sm"
                  value={previewVars[v.name] ?? ""}
                  onChange={e => setPreviewVars({ ...previewVars, [v.name]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
            className="dbz-button flex items-center gap-1.5 disabled:opacity-40"
          >
            <Oeil className="h-3 w-3" />
            {preview.isPending ? "Rendu en cours…" : "Générer l'aperçu"}
          </button>
          {previewResult && (
            <div className="rounded border border-dbz-border bg-black/30 p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/50 mb-2">Rendu final</p>
              <p className="whitespace-pre-wrap text-sm text-white">{previewResult}</p>
            </div>
          )}
        </div>
      )}

      {/* Template par défaut */}
      <div className="dbz-panel p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
          Message par défaut (référence)
        </h3>
        <pre className="overflow-x-auto rounded bg-black/40 p-3 text-xs text-white/50 border border-dbz-border">
          {entry.defaultTemplate}
        </pre>
      </div>
    </div>
  );
}

function ResolvedChannel({ channelKey }: { channelKey: string }) {
  const settings = useQuery({
    queryKey: ["settings", "all"],
    queryFn: () => api.get<{ rows: { key: string; value: string }[] }>("/database/guild_settings?limit=200"),
    staleTime: 30_000,
  });
  const channels = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: () => api.get<{ channels: { id: string; name: string; type: number }[] }>("/discord/channels"),
    staleTime: 30_000,
  });
  if (VIRTUAL_CHANNEL_KEYS.has(channelKey)) {
    const label = CHANNEL_KEYS.find(k => k.key === channelKey)?.label ?? channelKey;
    return (
      <p className="mt-1 text-xs text-dbz-blue-light">
        Cible contextuelle : <strong>{label}</strong>{" "}
        <span className="text-white/50">— résolu automatiquement par le bot selon le contexte.</span>
      </p>
    );
  }
  const value = (settings.data as { rows?: { key: string; value: string }[] })?.rows?.find(
    s => s.key === channelKey,
  )?.value;
  if (!value) {
    return (
      <p className="mt-1 text-xs text-dbz-yellow">
        Aucun salon configuré pour cette clé — le bot utilisera la valeur par défaut.
      </p>
    );
  }
  const c = channels.data?.channels.find(x => x.id === value);
  return (
    <p className="mt-1 text-xs text-green-400">
      Salon : {c ? <strong>#{c.name}</strong> : value}{" "}
      <span className="text-white/50 font-mono text-[10px]">({value})</span>
    </p>
  );
}

function defaultPreviewValue(name: string): string {
  switch (name) {
    case "user":
      return "<@123456789>";
    case "userName":
      return "Goku";
    case "userId":
      return "123456789012345678";
    case "guildName":
      return "Dragon Ball FR";
    case "memberCount":
      return "5757";
    case "inviter":
      return "<@987654321>";
    case "level":
      return "5";
    case "xp":
      return "50000";
    case "zeni":
      return "200";
    case "streak":
      return "7";
    case "code":
      return "KAMEHAMEHA";
    case "url":
      return "discord.gg/example";
    case "duration":
      return "24h";
    case "winners":
      return "<@111> <@222>";
    case "prize":
      return "Capsule Hoi-Poi";
    case "title":
      return "Tirage hebdomadaire";
    case "channelId":
      return "111222333";
    case "roleId":
      return "444555666";
    case "zeniBonus":
      return "5000";
    case "description":
      return "Description du succès";
    default:
      return "";
  }
}
