"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Diese, Envoyer, Rafraichir } from "@/components/icones";
import { api, ApiError } from "@aphrody/admin-ui/client";
import { PlainField } from "@/components/editor/PlainField";

/**
 * Console bots (admin) : voir les messages récents d'un salon Discord et y
 * publier un message. S'appuie sur l'API bot :
 *   - GET  /api/discord/channels        (liste des salons)
 *   - GET  /api/discord/messages        (messages récents)
 *   - POST /api/discord/send            (envoi dans le salon)
 * Tout passe par le proxy admin `/api/bot-admin/*` (Bearer server-only).
 *
 * La persona n'est qu'un ALIAS : côté bot, les six identifiants pointent le même
 * client Gateway (`ClientMap`), donc le message est toujours publié par le compte
 * Shenron — ne jamais laisser croire à l'admin qu'il change d'identité.
 */

type Channel = {
  id: string;
  name: string;
  type: number;
  parentId?: string;
  position?: number;
};
type Message = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  authorBot: boolean;
  content: string;
  createdAt: string;
  attachments: Array<{ url: string; name: string; contentType: string | null }>;
  embedCount: number;
};

// Personas (id côté bot = camelCase pour grandPretre).
const PERSONAS: Array<{ id: string; name: string }> = [
  { id: "shenron", name: "Shenron" },
  { id: "beerus", name: "Beerus" },
  { id: "whis", name: "Whis" },
  { id: "grandPretre", name: "Grand Prêtre" },
  { id: "enma", name: "Enma" },
  { id: "kaio", name: "Kaïo" },
];

// Types de salons où l'on peut écrire (texte + annonces).
const SENDABLE_TYPES = new Set([0, 5]);

export function BotConsole() {
  const qc = useQueryClient();
  const [channelId, setChannelId] = useState<string>("");
  const [persona, setPersona] = useState<string>("shenron");
  const [content, setContent] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);

  const channelsQ = useQuery({
    queryKey: ["console-channels"],
    queryFn: () => api.get<{ channels: Channel[] }>("/discord/channels"),
    staleTime: 60_000,
  });

  const sendable = useMemo(
    () =>
      (channelsQ.data?.channels ?? [])
        .filter((c) => SENDABLE_TYPES.has(c.type))
        .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [channelsQ.data],
  );

  const messagesQ = useQuery({
    queryKey: ["console-messages", channelId],
    queryFn: () =>
      api.get<{ channelName: string | null; messages: Message[] }>(
        `/discord/messages?channelId=${channelId}&limit=50`,
      ),
    enabled: !!channelId,
    refetchInterval: channelId ? 5_000 : false,
  });

  const sendM = useMutation({
    mutationFn: (vars: {
      channelId: string;
      content: string;
      persona: string;
    }) => api.post<{ ok: boolean; url?: string }>("/discord/send", vars),
    onSuccess: (res) => {
      setContent("");
      setSendError(null);
      setSentUrl(res?.url ?? null);
      void qc.invalidateQueries({ queryKey: ["console-messages", channelId] });
    },
    onError: (e) => {
      setSentUrl(null);
      setSendError(e instanceof ApiError ? e.message : "Échec de l'envoi.");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!channelId) {
      setSendError("Choisis un salon.");
      return;
    }
    if (text.length === 0 || text.length > 2000) {
      setSendError("Message vide ou trop long (max 2000 caractères).");
      return;
    }
    sendM.mutate({ channelId, content: text, persona });
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">
          CONSOLE BOTS
        </h1>
        <p className="text-sm text-dbz-blue-light">
          Lis les messages d'un salon et publie un message. Le bot n'a qu'un
          seul client Gateway : quel que soit l'alias choisi, le message est
          publié par le compte Shenron. Les messages se rafraîchissent toutes
          les 5&nbsp;s.
        </p>
      </header>

      {/* Sélecteurs */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Salon
          <select
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setSentUrl(null);
              setSendError(null);
            }}
            className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-dbz-orange"
          >
            <option value="">— Choisir un salon —</option>
            {sendable.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
                {c.type === 5 ? " (annonces)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Alias d'expéditeur (sans effet sur l'identité affichée)
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-dbz-orange"
          >
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {channelsQ.isError && (
        <p className="text-sm text-rose-400">
          Impossible de charger les salons.
        </p>
      )}

      {/* Fil de messages */}
      <div className="rounded-xl border border-white/10 bg-black/40">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="flex items-center gap-2 text-sm font-bold text-white/80">
            <Diese className="h-4 w-4 text-white/50" />
            {messagesQ.data?.channelName ??
              (channelId ? "Salon" : "Aucun salon sélectionné")}
          </span>
          <button
            type="button"
            onClick={() => void messagesQ.refetch()}
            disabled={!channelId}
            className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[12px] text-white/60 hover:border-white/40 disabled:opacity-40"
          >
            <Rafraichir
              className={`h-3.5 w-3.5 ${messagesQ.isFetching ? "animate-spin" : ""}`}
            />
            Rafraîchir
          </button>
        </div>
        <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto p-4">
          {!channelId && (
            <p className="text-sm italic text-white/50">
              Sélectionne un salon pour voir les messages.
            </p>
          )}
          {channelId && messagesQ.isLoading && (
            <p className="text-sm italic text-white/50">Chargement…</p>
          )}
          {channelId && messagesQ.data?.messages.length === 0 && (
            <p className="text-sm italic text-white/50">
              Aucun message récent.
            </p>
          )}
          {messagesQ.data?.messages.map((m) => (
            <div key={m.id} className="flex gap-2.5">
              {m.authorAvatar ? (
                <img
                  src={m.authorAvatar}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full"
                  loading="lazy"
                />
              ) : (
                <div className="h-8 w-8 shrink-0 rounded-full bg-white/10" />
              )}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-white/90">
                    {m.authorName}
                  </span>
                  {m.authorBot && (
                    <span className="rounded bg-dbz-blue/30 px-1 text-[10px] font-bold uppercase text-dbz-blue-light">
                      bot
                    </span>
                  )}
                  <span className="text-[11px] text-white/50">
                    {new Date(m.createdAt).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-white/75">
                  {m.content || (
                    <span className="italic text-white/50">
                      {m.embedCount > 0 || m.attachments.length > 0
                        ? "[pièce jointe / embed]"
                        : "[message vide]"}
                    </span>
                  )}
                </p>
                {m.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.attachments.map((a) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-dbz-blue-light underline"
                      >
                        {a.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Compositeur */}
      <form onSubmit={submit} className="space-y-2">
        <PlainField
          value={content}
          onChange={setContent}
          maxLength={2000}
          minRows={3}
          maxRows={16}
          placeholder="Message envoyé par le bot Shenron…"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={sendM.isPending || !channelId}
            className="flex items-center gap-2 rounded-lg bg-dbz-orange px-5 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Envoyer className="h-4 w-4" />
            {sendM.isPending ? "Envoi…" : "Envoyer"}
          </button>
          <span className="text-[12px] text-white/50">
            {content.length}/2000
          </span>
          {sendError && (
            <span className="text-[13px] font-semibold text-rose-400">
              {sendError}
            </span>
          )}
          {sentUrl && (
            <a
              href={sentUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-semibold text-emerald-400 underline"
            >
              Message envoyé ✓
            </a>
          )}
        </div>
      </form>
    </div>
  );
}
