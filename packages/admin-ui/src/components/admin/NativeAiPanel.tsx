"use client";

// Desktop-only panel: when the admin runs inside the Aphrody app, `window.aphrodyNative`
// (injected by crates/ui/app/src/studio.rs) gives direct IPC access to the local models and the
// Shenron RAG. The answer is grounded on retrieved passages and cites them.
import { useEffect, useState } from "react";
import { EMPTY_RETRIEVAL_NOTICE, formatRagContext } from "./ia-cockpit-view";

interface NativeStatus {
  chat: { ready: boolean; model?: string };
  embed: { ready: boolean; model?: string };
  rerank: { ready: boolean; model?: string };
}

interface RagHit {
  kind?: string;
  title?: string;
  url?: string;
  snippet?: string;
}

interface AphrodyNative {
  desktop: true;
  status(): Promise<NativeStatus>;
  chat(
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
  ragSearch(query: string, limit?: number, kind?: string | null): Promise<{ results: RagHit[] }>;
}

declare global {
  interface Window {
    aphrodyNative?: AphrodyNative;
  }
}

const SYSTEM =
  "Tu es l'assistant éditorial de Shenron (Dragon Ball). Réponds en français, uniquement à partir des passages fournis ; cite-les par leur numéro [n]. Si les passages ne suffisent pas, dis-le.";

export function NativeAiPanel() {
  const [native, setNative] = useState<AphrodyNative | null>(null);
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<RagHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const attach = () => {
      if (!window.aphrodyNative) return;
      setNative(window.aphrodyNative);
      window.aphrodyNative.status().then(setStatus, (cause: unknown) => setError(String(cause)));
    };
    attach();
    window.addEventListener("aphrody-native-ready", attach);
    return () => window.removeEventListener("aphrody-native-ready", attach);
  }, []);

  if (!native) return null;

  const ask = async () => {
    setBusy(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const { results } = await native.ragSearch(question.trim(), 8);
      setSources(results);
      // Without passages the model would answer from its own memory: say so instead.
      if (results.length === 0) {
        setError(EMPTY_RETRIEVAL_NOTICE);
        return;
      }
      const reply = await native.chat([
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Passages :\n${formatRagContext(results)}\n\nQuestion : ${question.trim()}`,
        },
      ]);
      setAnswer(reply.choices?.[0]?.message?.content ?? "(réponse vide)");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const roles: Array<[string, { ready: boolean; model?: string } | undefined]> = [
    ["Chat", status?.chat],
    ["Embeddings", status?.embed],
    ["Rerank", status?.rerank],
  ];

  return (
    <section className="mb-6 space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">IA locale (application Aphrody)</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {roles.map(([label, role]) => (
            <span
              key={label}
              className={
                role?.ready
                  ? "rounded-full bg-emerald-500/20 px-2 py-1"
                  : "rounded-full bg-white/10 px-2 py-1 opacity-70"
              }
            >
              {label} : {role?.ready ? role.model : "non chargé"}
            </span>
          ))}
        </div>
      </header>
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault();
          if (question.trim().length >= 2) void ask();
        }}
      >
        <input
          aria-label="Question à l'IA locale"
          className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2"
          placeholder="Question sur le corpus (réponse sourcée par le modèle local)"
          value={question}
          onChange={event => setQuestion(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy || question.trim().length < 2}
          className="rounded-lg bg-white/10 px-4 py-2 disabled:opacity-50"
        >
          {busy ? "…" : "Demander"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {answer ? <p className="whitespace-pre-wrap text-sm">{answer}</p> : null}
      {sources.length > 0 ? (
        <ol className="list-decimal space-y-1 pl-5 text-xs opacity-80">
          {sources.map((hit, index) => (
            <li key={`${hit.url ?? hit.title}-${index}`}>
              {hit.url ? (
                <a href={hit.url} className="underline">
                  {hit.title ?? hit.url}
                </a>
              ) : (
                hit.title
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
