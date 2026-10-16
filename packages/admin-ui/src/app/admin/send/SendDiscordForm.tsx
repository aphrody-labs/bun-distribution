"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@aphrody/admin-ui/client";
import { PlainField } from "../../../components/editor/PlainField";

const PERSONAS = [
  { id: "shenron", label: "Shenron", description: "Persona principal" },
  { id: "beerus", label: "Beerus", description: "Dieu de la Destruction" },
  { id: "whis", label: "Whis", description: "Ange accompagnateur" },
  {
    id: "grandPretre",
    label: "Grand Prêtre",
    description: "Serviteur du Grand Prêtre",
  },
  { id: "enma", label: "Enma", description: "Roi des Enfers" },
  { id: "kaio", label: "Kaïo", description: "Dieu des Planètes" },
] as const;

type Result = { ok: true; messageId: string; url: string } | { ok: false; error: string } | null;

interface Channel {
  id: string;
  name: string;
  type: number;
}

// Types de salons textuels où on peut envoyer un message
const TEXT_CHANNEL_TYPES = new Set([0, 5, 15]);

export function SendDiscordForm() {
  const [channelId, setChannelId] = useState("");
  const [content, setContent] = useState("");
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]["id"]>("shenron");
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");

  // Chargement de la liste des salons Discord
  const channelsQuery = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: () => api.get<{ channels: Channel[] }>("/discord/channels"),
    staleTime: 5 * 60_000,
  });

  const textChannels = (channelsQuery.data?.channels ?? []).filter(c => TEXT_CHANNEL_TYPES.has(c.type));

  const filteredChannels = channelSearch
    ? textChannels.filter(c => c.name.toLowerCase().includes(channelSearch.toLowerCase()))
    : textChannels;

  const selectedChannel = textChannels.find(c => c.id === channelId);
  const selectedPersona = PERSONAS.find(p => p.id === persona);

  function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!confirmed) {
      // Demande de confirmation avant envoi
      setConfirmed(true);
      return;
    }

    setResult(null);
    setConfirmed(false);
    startTransition(async () => {
      try {
        const res = await fetch("/api/bot-admin/discord/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channelId, content, persona }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setResult({ ok: true, messageId: data.messageId, url: data.url });
          setContent("");
        } else {
          setResult({ ok: false, error: data.error ?? `HTTP ${res.status}` });
        }
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : "erreur réseau",
        });
      }
    });
  }

  return (
    <form onSubmit={submit} className="dbz-panel p-6 space-y-5">
      {/* Persona — alias de compatibilité. Le bot n'expose qu'un seul client Gateway
			    (cf. `ClientMap` côté bot : les six identifiants pointent le même client), donc
			    ce choix ne change PAS le compte qui publie le message. */}
      <fieldset className="border-0 p-0 m-0">
        <legend className="block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light mb-1">
          Persona expéditrice
        </legend>
        <p className="text-xs text-white/50 mb-2">
          Le message est publié par le compte du bot Shenron, quelle que soit la persona choisie : les six identifiants
          historiques ne sont plus que des aliases acceptés par l&apos;API.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PERSONAS.map(p => (
            <button
              key={p.id}
              type="button"
              aria-pressed={persona === p.id}
              onClick={() => setPersona(p.id)}
              disabled={pending}
              className={`p-2 rounded border text-left transition-colors ${
                persona === p.id ? "border-dbz-orange bg-dbz-orange/10" : "border-dbz-border hover:border-dbz-orange/40"
              }`}
            >
              <p className="font-saiyan text-sm text-white">{p.label}</p>
              <p className="text-[10px] text-white/50">{p.description}</p>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Salon */}
      <div>
        <label
          htmlFor="salon-destination"
          className="block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light mb-1"
        >
          Salon de destination
        </label>
        <p className="text-xs text-white/50 mb-2">Sélectionnez le salon Discord où envoyer le message.</p>
        {channelsQuery.isLoading && <p className="text-xs text-white/50">Chargement des salons…</p>}
        {channelsQuery.isError && (
          <p className="text-xs text-red-400">
            Impossible de charger les salons. Entrez l&apos;identifiant manuellement ci-dessous.
          </p>
        )}
        {/* Le repli manuel (plus bas) et ce menu se partageaient `channelId` : quand
				    la liste échouait, les DEUX champs étaient rendus et le `<select required>`
				    vide bloquait la validation HTML — le repli documenté ne partait jamais.
				    Le menu ne s'affiche donc que si la liste a bien été chargée. */}
        {!channelsQuery.isLoading && !channelsQuery.isError && (
          <>
            <input
              type="search"
              aria-label="Rechercher un salon"
              className="w-full bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-2 text-sm mb-1"
              placeholder="Rechercher un salon…"
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
              disabled={pending}
            />
            <select
              id="salon-destination"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              required
              className="w-full bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-2 text-sm"
              disabled={pending}
            >
              <option value="">— choisir un salon —</option>
              {filteredChannels.map(c => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            {channelId && !selectedChannel && (
              <p className="text-xs text-dbz-yellow mt-1">
                Salon non trouvé dans la liste — identifiant saisi manuellement.
              </p>
            )}
          </>
        )}
        {/* Fallback : saisie manuelle si pas de liste */}
        {channelsQuery.isError && (
          <input
            type="text"
            id="salon-destination"
            inputMode="numeric"
            value={channelId}
            onChange={e => setChannelId(e.target.value)}
            placeholder="Identifiant du salon (ex: 1234567890123456789)"
            required
            pattern="\d{17,20}"
            className="w-full bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange p-2 font-mono text-sm mt-1"
            disabled={pending}
          />
        )}
      </div>

      {/* Message */}
      <div>
        <label
          htmlFor="message-contenu"
          className="block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light mb-1"
        >
          Contenu du message
        </label>
        <p className="text-xs text-white/50 mb-2">
          Le Markdown Discord est supporté : **gras**, *italique*, &gt;citation, etc.
        </p>
        <PlainField
          id="message-contenu"
          value={content}
          onChange={setContent}
          required
          maxLength={2000}
          minRows={6}
          maxRows={20}
          placeholder="Écrivez votre message ici…"
          disabled={pending}
          hint="Markdown Discord accepté."
        />
      </div>

      {/* Confirmation avant envoi */}
      {confirmed && channelId && content && (
        <div className="dbz-panel p-4 border-2 border-dbz-yellow/60 bg-dbz-yellow/5">
          <p className="font-saiyan text-dbz-yellow text-base mb-2">Confirmer l&apos;envoi ?</p>
          <p className="text-sm text-white/70 mb-3">
            Le bot <strong>Shenron</strong> va envoyer ce message dans{" "}
            <strong>#{selectedChannel?.name ?? channelId}</strong>
            {persona !== "shenron" ? <> (alias {selectedPersona?.label})</> : null}.
          </p>
          <div className="bg-black/40 rounded p-3 text-sm text-white font-mono whitespace-pre-wrap mb-3 border border-dbz-border">
            {content}
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="dbz-button disabled:opacity-40">
              {pending ? "Envoi en cours…" : "Confirmer l'envoi"}
            </button>
            <button type="button" onClick={() => setConfirmed(false)} className="dbz-button-ghost">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Bouton d'envoi (avant confirmation) */}
      {!confirmed && (
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={pending || !channelId || !content}
            className="dbz-button disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Envoyer le message
          </button>
        </div>
      )}

      {/* Résultat */}
      {result?.ok && (
        <div className="dbz-panel p-4 border-l-4 border-green-500">
          <p className="text-sm text-green-400 font-semibold mb-1">Message envoyé avec succès.</p>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-dbz-blue-light hover:text-dbz-orange underline"
          >
            Voir le message sur Discord
          </a>
        </div>
      )}
      {result && !result.ok && (
        <div className="dbz-panel p-4 border-l-4 border-red-500">
          <p className="text-sm text-red-400 font-semibold mb-1">Erreur d&apos;envoi</p>
          <p className="text-xs text-white/50">{result.error}</p>
        </div>
      )}
    </form>
  );
}
