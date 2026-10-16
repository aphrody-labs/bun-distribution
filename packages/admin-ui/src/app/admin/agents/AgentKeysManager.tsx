"use client";

/**
 * AgentKeysManager — création, révocation et relecture des clés d'agent.
 *
 * Deux exigences d'interface qui ne sont pas cosmétiques :
 *
 *  1. **Le jeton s'affiche une seule fois**, en évidence, avec un bouton de
 *     copie et un avertissement clair. L'écran ne le redemande jamais : seul son
 *     hachage est en base. Le dire à l'écran évite l'aller-retour « je l'ai
 *     perdu, tu peux me le renvoyer ? » auquel la réponse est toujours non.
 *  2. **Les portées sont cochées une par une**, avec leur phrase explicative.
 *     Une liste « read/write » opaque pousse à tout cocher ; une phrase par
 *     portée fait réfléchir à ce qu'on donne.
 */
import { useState, useTransition } from "react";
import { createAgentKeyAction, revokeAgentKeyAction, updateScopesAction, type CreateResult } from "./_actions";
import type { AgentKeyView } from "@/lib/agent-keys";
import type { AgentScope } from "@shenron/db/schema";

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const fmt = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : "—");

export function AgentKeysManager({
  keys,
  scopes,
  scopeDescriptions,
}: {
  keys: readonly AgentKeyView[];
  scopes: readonly AgentScope[];
  scopeDescriptions: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<Extract<CreateResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [quota, setQuota] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["read"]));
  const [copied, setCopied] = useState(false);

  function toggle(scope: string): void {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function submit(): void {
    setError(null);
    setCreated(null);
    startTransition(async () => {
      const res = await createAgentKeyAction({
        name,
        scopes: [...picked],
        note: note.trim() || undefined,
        rateLimitPerHour: quota.trim() ? Number(quota) : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCreated(res);
      setName("");
      setNote("");
      setQuota("");
      setPicked(new Set(["read"]));
    });
  }

  return (
    <div className="space-y-8">
      {/* ---- Jeton fraîchement créé ------------------------------------- */}
      {created && (
        <div className="rounded-lg border-2 border-dbz-orange/60 bg-dbz-orange/[0.07] p-5">
          <h2 className="text-[15px] font-bold text-white">Clé « {created.name} » créée — copie-la maintenant</h2>
          <p className="mt-1.5 text-[13px] text-white/60">
            Ce jeton ne sera plus affiché : seul son hachage est conservé. Si tu le perds, il faudra en créer un autre.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 break-all rounded border border-white/15 bg-black/40 px-3 py-2 font-mono text-[13px] text-dbz-orange">
              {created.token}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(created.token)
                  .then(() => setCopied(true))
                  .catch(() => setError("Copie refusée par le navigateur — sélectionne le texte."));
              }}
              className="toriyama-btn !text-[0.75rem]"
            >
              {copied ? "Copié ✓" : "Copier"}
            </button>
          </div>
        </div>
      )}

      {/* ---- Création ---------------------------------------------------- */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-[15px] font-semibold text-white">Nouvelle clé</h2>
        <p className="mt-1 text-[13px] text-white/50">
          Le nom signe publiquement les écritures de l&apos;agent (il apparaît à côté de ses commentaires et sur ses
          brouillons d&apos;articles).
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/50">
              Nom de l&apos;agent
            </span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={80}
              placeholder="Rédacteur Daima"
              className="h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-[14px] text-white placeholder:text-white/30"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/50">
              Quota d&apos;écritures / heure (vide = 120)
            </span>
            <input
              value={quota}
              onChange={e => setQuota(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="120"
              className="h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-[14px] text-white placeholder:text-white/30"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/50">
              Note interne (à quoi sert cette clé)
            </span>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              placeholder="Ingest des chapitres Daima, tourne sur le VPS"
              className="h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-[14px] text-white placeholder:text-white/30"
            />
          </label>
        </div>

        <fieldset className="mt-5">
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">Portées</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map(scope => (
              <label
                key={scope}
                className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors ${
                  picked.has(scope)
                    ? "border-dbz-orange/50 bg-dbz-orange/[0.07]"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <input
                  type="checkbox"
                  checked={picked.has(scope)}
                  onChange={() => toggle(scope)}
                  className="mt-0.5 size-4 accent-[var(--color-dbz-orange)]"
                />
                <span className="min-w-0">
                  <code className="block font-mono text-[13px] text-white">{scope}</code>
                  <span className="mt-0.5 block text-[12px] leading-snug text-white/55">
                    {scopeDescriptions[scope]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5">
          <button
            type="button"
            onClick={submit}
            disabled={pending || name.trim().length < 3 || picked.size === 0}
            className="toriyama-btn !text-[0.75rem] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Création…" : "Créer la clé"}
          </button>
        </div>
      </section>

      {/* ---- Clés existantes --------------------------------------------- */}
      <section>
        <h2 className="text-[15px] font-semibold text-white">Clés existantes</h2>
        {keys.length === 0 ? (
          <p className="mt-3 text-[14px] text-white/50">
            Aucune clé. Les agents ne peuvent rien écrire pour l&apos;instant.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {keys.map(key => (
              <li
                key={key.id}
                className={`rounded-lg border p-4 ${
                  key.revokedAt ? "border-white/10 opacity-55" : "border-white/15 bg-white/[0.02]"
                }`}
              >
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-[15px] font-semibold text-white">{key.name}</span>
                  <code className="rounded bg-black/40 px-2 py-0.5 font-mono text-[12px] text-white/50">
                    {key.prefix}…
                  </code>
                  {key.revokedAt ? (
                    <span className="rounded-full border border-red-500/40 px-2 py-[1px] text-[11px] uppercase tracking-wider text-red-300">
                      révoquée
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-500/40 px-2 py-[1px] text-[11px] uppercase tracking-wider text-emerald-300">
                      active
                    </span>
                  )}
                  <span className="ml-auto text-[12px] tabular-nums text-white/40">{key.calls24h} appel(s) / 24 h</span>
                </header>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {key.scopes.map(s => (
                    <code
                      key={s}
                      className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[11px] text-white/70"
                    >
                      {s}
                    </code>
                  ))}
                </div>

                {key.note && <p className="mt-2.5 text-[13px] text-white/55">{key.note}</p>}

                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-white/45 sm:grid-cols-3">
                  <div>
                    <dt className="inline">Créée&nbsp;: </dt>
                    <dd className="inline">{fmt(key.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Dernier usage&nbsp;: </dt>
                    <dd className="inline">{fmt(key.lastUsedAt)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Quota&nbsp;: </dt>
                    <dd className="inline">{key.rateLimitPerHour ?? 120}/h</dd>
                  </div>
                </dl>

                {!key.revokedAt && (
                  <footer className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const res = await revokeAgentKeyAction(key.id);
                          if (!res.ok) setError(res.error ?? "Révocation impossible.");
                        });
                      }}
                      className="text-white/60 hover:text-red-300 disabled:opacity-40"
                    >
                      Révoquer
                    </button>
                    {/* Retirer la portée de publication sans révoquer : le cas le plus
										    fréquent quand un agent s'emballe. */}
                    {key.scopes.includes("publish:articles") && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          startTransition(async () => {
                            const res = await updateScopesAction(
                              key.id,
                              key.scopes.filter(s => s !== "publish:articles"),
                            );
                            if (!res.ok) setError(res.error ?? "Modification impossible.");
                          });
                        }}
                        className="text-white/60 hover:text-amber-300 disabled:opacity-40"
                      >
                        Retirer le droit de publier
                      </button>
                    )}
                  </footer>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
