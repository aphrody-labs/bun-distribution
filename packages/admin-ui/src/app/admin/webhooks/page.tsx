"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
  Copy,
  Check,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { PlainField } from "@/components/editor/PlainField";

interface Channel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

interface Webhook {
  id: string;
  name: string | null;
  channel_id: string | null;
  avatar: string | null;
  token?: string;
  url?: string;
  user?: { id: string; username: string; avatar: string | null };
}

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [filterChannel, setFilterChannel] = useState<string>("");

  const channels = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: () => api.get<{ channels: Channel[] }>("/discord/channels"),
  });

  const webhooks = useQuery({
    queryKey: ["webhooks", filterChannel],
    queryFn: () =>
      api.get<{ webhooks: Webhook[] }>(
        filterChannel ? `/webhooks?channel_id=${filterChannel}` : "/webhooks",
      ),
  });

  const create = useMutation({
    mutationFn: (data: { channel_id: string; name: string }) =>
      api.post<{ webhook: Webhook }>("/webhooks/create", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const textChannels = useMemo(
    () =>
      (channels.data?.channels ?? []).filter(
        (c) => c.type === 0 || c.type === 5,
      ),
    [channels.data],
  );

  const [createForm, setCreateForm] = useState({ channel_id: "", name: "" });
  const [executing, setExecuting] = useState<Webhook | null>(null);

  function handleDelete(w: Webhook) {
    if (
      !confirm(
        `Supprimer le webhook « ${w.name ?? "(sans nom)"} » ?\n\nLes intégrations qui utilisent ce webhook ne fonctionneront plus.`,
      )
    )
      return;
    remove.mutate(w.id);
  }

  return (
    <div className="space-y-4">
      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <WebhookIcon className="h-5 w-5 text-dbz-orange" />
          <h2 className="text-lg font-saiyan text-dbz-orange uppercase">
            Webhooks Discord
          </h2>
        </div>
        <p className="text-sm text-zinc-300">
          Un webhook est une adresse URL secrète qui permet d'envoyer des
          messages dans un salon Discord sans avoir besoin que le bot soit
          connecté. Utile pour des notifications externes, des alertes ou des
          intégrations avec d'autres outils.
        </p>
        <p className="mt-1 text-xs text-dbz-blue-light">
          Gestion via l'API Discord directement · lecture, création, suppression
          et envoi de message
        </p>
      </div>

      <div className="dbz-panel p-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs text-zinc-400">
            Filtrer par salon
          </label>
          <select
            className="w-full bg-dbz-bg border border-dbz-border rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-dbz-orange outline-none"
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
          >
            <option value="">Tous les salons du serveur</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!createForm.channel_id || !createForm.name) return;
          create.mutate(createForm);
          setCreateForm({ channel_id: "", name: "" });
        }}
        className="dbz-panel p-4 grid gap-3 sm:grid-cols-3"
      >
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Salon cible
          </label>
          <select
            className="w-full bg-dbz-bg border border-dbz-border rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-dbz-orange outline-none"
            value={createForm.channel_id}
            onChange={(e) =>
              setCreateForm({ ...createForm, channel_id: e.target.value })
            }
            required
          >
            <option value="">— Choisir un salon —</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Nom du webhook
          </label>
          <input
            className="w-full bg-dbz-bg border border-dbz-border rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-dbz-orange outline-none"
            value={createForm.name}
            onChange={(e) =>
              setCreateForm({ ...createForm, name: e.target.value })
            }
            placeholder="Mon webhook"
            maxLength={80}
            required
          />
        </div>
        <button
          type="submit"
          disabled={
            create.isPending || !createForm.channel_id || !createForm.name
          }
          className="dbz-button self-end disabled:opacity-40"
        >
          <Plus className="h-3 w-3 inline-block mr-1" />
          {create.isPending ? "Création…" : "Créer le webhook"}
        </button>
      </form>

      <div className="dbz-panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-dbz-border bg-dbz-bg text-xs uppercase tracking-wide text-dbz-blue-light">
            <tr>
              <th className="px-3 py-2 text-left">Nom</th>
              <th className="px-3 py-2 text-left">Salon</th>
              <th className="px-3 py-2 text-left">Identifiant</th>
              <th className="px-3 py-2 text-left">URL (copie)</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dbz-border">
            {webhooks.isLoading && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-zinc-500 text-sm"
                >
                  Chargement…
                </td>
              </tr>
            )}
            {webhooks.data?.webhooks.map((w) => {
              const chan = textChannels.find((c) => c.id === w.channel_id);
              return (
                <tr key={w.id} className="hover:bg-dbz-blue-light/5">
                  <td className="px-3 py-2 text-zinc-100">
                    {w.name ?? "(sans nom)"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {chan ? `#${chan.name}` : w.channel_id}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                    {w.id}
                  </td>
                  <td className="px-3 py-2">
                    <CopyUrl url={w.url ?? ""} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setExecuting(w)}
                        disabled={!w.url}
                        className="text-xs px-2 py-1 border border-dbz-border text-zinc-300 hover:text-dbz-orange hover:border-dbz-orange/50 rounded transition-colors disabled:opacity-30"
                        title="Envoyer un message via ce webhook"
                      >
                        <Send className="h-3 w-3 inline-block" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(w)}
                        disabled={remove.isPending}
                        className="text-xs px-2 py-1 border border-red-900/50 text-red-400 hover:bg-red-900/20 rounded transition-colors disabled:opacity-40"
                        title="Supprimer ce webhook"
                      >
                        <Trash2 className="h-3 w-3 inline-block" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {webhooks.data?.webhooks.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-sm text-zinc-500"
                >
                  Aucun webhook trouvé pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {executing && executing.url && (
        <ExecuteModal webhook={executing} onClose={() => setExecuting(null)} />
      )}
    </div>
  );
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  if (!url) return <span className="text-xs text-zinc-600">—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-dbz-orange transition-colors"
      title="Copier l'URL du webhook"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span className="font-mono">
        {copied ? "Copié !" : `${url.slice(0, 40)}…`}
      </span>
    </button>
  );
}

function ExecuteModal({
  webhook,
  onClose,
}: {
  webhook: Webhook;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [username, setUsername] = useState(webhook.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [embedTitle, setEmbedTitle] = useState("");
  const [embedDesc, setEmbedDesc] = useState("");
  const [embedColor, setEmbedColor] = useState("#eab308");
  const [result, setResult] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        url: webhook.url,
        wait: true,
      };
      if (content) payload.content = content;
      if (username) payload.username = username;
      if (avatarUrl) payload.avatar_url = avatarUrl;
      if (embedTitle || embedDesc) {
        payload.embeds = [
          {
            title: embedTitle || undefined,
            description: embedDesc || undefined,
            color: parseInt(embedColor.replace("#", ""), 16),
            timestamp: new Date().toISOString(),
          },
        ];
      }
      return api.post("/webhooks/execute", payload);
    },
    onSuccess: () => setResult("Message envoyé avec succès"),
    onError: (err) =>
      setResult(`Erreur : ${err instanceof Error ? err.message : String(err)}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="dbz-panel max-h-[85vh] w-full max-w-2xl overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-saiyan text-dbz-orange uppercase">
            Envoyer via {webhook.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl leading-none"
            title="Fermer"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4">
          Ce message sera posté dans le salon Discord associé au webhook, comme
          s'il venait d'un bot externe.
        </p>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Nom d'affichage (optionnel)
              </label>
              <input
                className="w-full bg-dbz-bg border border-dbz-border rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-dbz-orange outline-none"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={80}
                placeholder="Nom affiché dans Discord"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                URL de l'avatar (optionnel)
              </label>
              <input
                className="w-full bg-dbz-bg border border-dbz-border rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-dbz-orange outline-none"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">
              Texte du message (max 2 000 caractères)
            </label>
            <PlainField
              value={content}
              onChange={setContent}
              minRows={3}
              maxRows={18}
              maxLength={2000}
              placeholder="Votre message…"
            />
          </div>

          <fieldset className="space-y-2 rounded-lg border border-dbz-border p-3">
            <legend className="px-2 text-xs uppercase tracking-wide text-zinc-500">
              Encart mis en forme (embed — optionnel)
            </legend>
            <input
              className="w-full bg-dbz-bg border border-dbz-border rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-dbz-orange outline-none"
              value={embedTitle}
              onChange={(e) => setEmbedTitle(e.target.value)}
              placeholder="Titre de l'encart"
              maxLength={256}
            />
            <PlainField
              value={embedDesc}
              onChange={setEmbedDesc}
              minRows={2}
              maxRows={16}
              maxLength={4096}
              placeholder="Contenu de l'encart"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">
                Couleur de la barre
              </label>
              <input
                type="color"
                value={embedColor}
                onChange={(e) => setEmbedColor(e.target.value)}
                className="h-8 w-16 rounded border border-dbz-border bg-dbz-bg cursor-pointer"
              />
              <span className="font-mono text-xs text-zinc-500">
                {embedColor}
              </span>
            </div>
          </fieldset>

          {result && (
            <div
              className={`rounded p-2 text-xs ${
                result.startsWith("Erreur")
                  ? "bg-red-900/20 text-red-300 border border-red-800"
                  : "bg-green-900/20 text-green-300 border border-green-800"
              }`}
            >
              {result}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-dbz-border text-zinc-400 hover:text-zinc-200 rounded transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => send.mutate()}
              disabled={
                send.isPending || (!content && !embedTitle && !embedDesc)
              }
              className="dbz-button !text-xs disabled:opacity-40"
            >
              <Send className="h-3 w-3 inline-block mr-1" />
              {send.isPending ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
