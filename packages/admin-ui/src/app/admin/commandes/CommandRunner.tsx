"use client";

/**
 * Exécuter une commande — liste TOUTES les slash commands du bot (catalogue
 * auto-découvert) avec TOUS leurs paramètres, et les exécute à distance (hors
 * Discord) via l'interaction synthétique du bot. Affiche les réponses capturées.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useTransition } from "react";
import { Alerte, Chargement, ChevronDroite, Recherche, Terminal } from "@/components/icones";
import { api } from "@aphrody/admin-ui/client";

interface OptionSpec {
  name: string;
  description: string;
  type: number;
  typeName: string;
  required: boolean;
  choices: { name: string; value: string | number }[] | null;
  minValue: number | null;
  maxValue: number | null;
  autocomplete: boolean;
}
interface CommandSpec {
  persona: string | null;
  group: string | null;
  subgroup: string | null;
  name: string;
  invocation: string;
  description: string;
  options: OptionSpec[];
}
interface Reply {
  method: string;
  content?: string;
  embeds?: { title?: string; description?: string; fields?: { name: string; value: string }[] }[];
  files?: number;
  ephemeral?: boolean;
}
type ExecResult = {
  ok: boolean;
  persona: string | null;
  invocation: string;
  replies: Reply[];
  error?: string;
} | null;

// Commandes interactives (pagination/modal/collector/voice/canvas) : la partie
// interactive ne fonctionne pas en headless (on récupère la 1ère réponse). On
// prévient l'admin sans bloquer.
const INTERACTIVE = new Set([
  "shop",
  "wiki",
  "top",
  "ticket",
  "eprofil",
  "voc",
  "scan",
  "fusion",
  "bingo",
  "morpion",
  "pendu",
  "pfc",
]);

export function CommandRunner() {
  const catalog = useQuery({
    queryKey: ["bot", "commands", "catalog"],
    queryFn: () => api.get<{ commands: CommandSpec[]; count: number }>("/bot/commands/catalog"),
    staleTime: 5 * 60_000,
  });
  const commands = useMemo(() => catalog.data?.commands ?? [], [catalog.data]);

  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CommandSpec | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ExecResult>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return commands.filter(
      (c) =>
        !n || c.invocation.toLowerCase().includes(n) || c.description.toLowerCase().includes(n),
    );
  }, [commands, q]);

  // Regroupe par persona pour la lisibilité.
  const byPersona = useMemo(() => {
    const map = new Map<string, CommandSpec[]>();
    for (const c of filtered) {
      const k = c.persona ?? "?";
      const list = map.get(k) ?? [];
      list.push(c);
      map.set(k, list);
    }
    return [...map.entries()].toSorted((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function pick(c: CommandSpec) {
    setSelected(c);
    setArgs({});
    setResult(null);
  }

  function run() {
    if (!selected) return;
    const missing = selected.options.some((o) => o.required && !String(args[o.name] ?? "").trim());
    if (missing) return;
    setResult(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/bot-admin/bot/commands/exec", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invocation: selected.invocation, options: args }),
        });
        setResult((await res.json()) as ExecResult);
      } catch (e) {
        setResult({
          ok: false,
          persona: selected.persona,
          invocation: selected.invocation,
          replies: [],
          error: e instanceof Error ? e.message : "erreur réseau",
        });
      }
    });
  }

  const topName = selected ? (selected.group ?? selected.name) : "";
  const interactive = selected && INTERACTIVE.has(topName);

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      {/* Liste des commandes */}
      <div className="dbz-panel flex max-h-[70vh] flex-col p-3">
        <div className="relative mb-2">
          <Recherche className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
          <input
            className="w-full rounded border border-dbz-border bg-dbz-bg px-3 py-1.5 pl-8 text-sm text-white focus:border-dbz-orange focus:outline-none"
            placeholder={`Rechercher parmi ${commands.length} commandes…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {catalog.isLoading ? (
            <p className="p-3 text-xs text-white/50">
              <Chargement className="mr-1 inline h-3 w-3 animate-spin" /> Chargement du catalogue…
            </p>
          ) : catalog.isError ? (
            <p className="p-3 text-xs text-red-400">Catalogue indisponible (bot hors-ligne ?).</p>
          ) : (
            byPersona.map(([persona, cmds]) => (
              <div key={persona} className="mb-2">
                <p className="px-1 py-1 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
                  {persona} · {cmds.length}
                </p>
                {cmds.map((c) => (
                  <button
                    key={c.invocation}
                    type="button"
                    onClick={() => pick(c)}
                    className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm ${
                      selected?.invocation === c.invocation
                        ? "bg-dbz-orange/15 text-white"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <ChevronDroite className="h-3 w-3 shrink-0 text-white/50" />
                    <span className="font-mono text-[13px]">/{c.invocation}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Formulaire + exécution */}
      <div className="dbz-panel min-h-[300px] p-5">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-white/50">
            <Terminal className="mb-2 h-8 w-8" />
            <p className="text-sm">Sélectionne une commande à gauche pour l&apos;exécuter.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="font-mono text-lg text-dbz-orange">/{selected.invocation}</h2>
              <p className="text-sm text-white/60">{selected.description}</p>
              <p className="mt-1 text-[11px] uppercase tracking-widest text-white/50">
                persona : {selected.persona}
              </p>
            </div>

            {interactive && (
              <div className="flex items-start gap-2 rounded border border-dbz-yellow/40 bg-dbz-yellow/5 p-2.5 text-xs text-dbz-yellow/90">
                <Alerte className="mt-0.5 h-4 w-4 shrink-0" />
                Commande interactive (menus/boutons/canvas) : seule la première réponse est capturée
                hors Discord ; la partie interactive ne s&apos;exécute pas.
              </div>
            )}

            {selected.options.length === 0 ? (
              <p className="text-xs italic text-white/50">Aucun paramètre.</p>
            ) : (
              <div className="space-y-3">
                {selected.options.map((o) => (
                  <OptionField
                    key={o.name}
                    opt={o}
                    value={args[o.name] ?? ""}
                    onChange={(v) => setArgs((a) => ({ ...a, [o.name]: v }))}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="dbz-button gap-2 disabled:opacity-50"
            >
              {pending ? (
                <Chargement className="h-4 w-4 animate-spin" />
              ) : (
                <Terminal className="h-4 w-4" />
              )}
              Exécuter /{selected.invocation}
            </button>

            {result && <ResultView result={result} />}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionField({
  opt,
  value,
  onChange,
}: {
  opt: OptionSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const hint =
    opt.type === 6
      ? "ID du membre"
      : opt.type === 8
        ? "ID du rôle"
        : opt.type === 7
          ? "ID du salon"
          : "";
  return (
    <div>
      <label className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
        {opt.name}
        {opt.required && <span className="text-dbz-red">*</span>}
        <span className="font-normal normal-case text-white/50">{opt.typeName}</span>
      </label>
      {opt.choices && opt.choices.length > 0 ? (
        <select
          className="input w-full text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— choisir —</option>
          {opt.choices.map((c) => (
            <option key={String(c.value)} value={String(c.value)}>
              {c.name}
            </option>
          ))}
        </select>
      ) : opt.type === 5 ? (
        <select
          className="input w-full text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— choisir —</option>
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      ) : (
        <input
          className="input w-full text-sm"
          type={opt.type === 4 || opt.type === 10 ? "number" : "text"}
          placeholder={opt.description || hint}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {opt.description && <p className="mt-0.5 text-[10px] text-white/50">{opt.description}</p>}
    </div>
  );
}

function ResultView({ result }: { result: NonNullable<ExecResult> }) {
  return (
    <div
      className={`rounded border-l-4 p-3 ${
        result.ok ? "border-green-500 bg-green-500/5" : "border-red-500 bg-red-500/5"
      }`}
    >
      <p className={`text-sm font-semibold ${result.ok ? "text-green-400" : "text-red-400"}`}>
        {result.ok ? "Exécuté" : "Échec"} · {result.replies.length} réponse
        {result.replies.length !== 1 ? "s" : ""}
      </p>
      {result.error && <p className="mt-1 text-xs text-red-400">{result.error}</p>}
      {result.replies.map((r, i) => (
        <div key={i} className="mt-2 rounded bg-black/40 p-2 text-xs text-white/80">
          <span className="mr-2 text-[9px] uppercase text-white/50">{r.method}</span>
          {r.content && <p className="whitespace-pre-wrap">{r.content}</p>}
          {r.embeds?.map((e, j) => (
            <div key={j} className="mt-1 border-l-2 border-dbz-orange/40 pl-2">
              {e.title && <p className="font-bold text-white">{e.title}</p>}
              {e.description && (
                <p className="whitespace-pre-wrap text-white/70">{e.description}</p>
              )}
              {e.fields?.map((f, k) => (
                <p key={k} className="mt-0.5">
                  <span className="font-semibold text-white/80">{f.name}:</span>{" "}
                  <span className="text-white/60">{f.value}</span>
                </p>
              ))}
            </div>
          ))}
          {(r.files ?? 0) > 0 && (
            <p className="mt-1 text-[10px] italic text-white/50">
              [{r.files} fichier(s)/image(s) — non affichés hors Discord]
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
