// SPDX-License-Identifier: Apache-2.0
// Databooks & corpus: offline search of the Shenron corpus (aphrody-rag::dragonball::LocalCorpus)
// and grounded answers from the desktop's local chat model, rendered with @shenron/ui.
import { useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { PageHeader } from "@shenron/ui/layout/PageHeader";
import { SectionHeading } from "@shenron/ui/layout/SectionHeading";
import { isTauri } from "../../tauri-bridge";
import { corpus, type CorpusHit } from "../../studio-bridge";

const KINDS: Array<[string, string]> = [
  ["", "Tout"],
  ["databook", "Databooks"],
  ["manga", "Manga"],
  ["wiki", "Wiki"],
];

const buttonClass = "min-h-12 px-5 text-[18px]";
const fieldClass = "min-h-12 rounded-xl border border-outline bg-surface-container px-4 text-[18px]";

function HitList({ hits }: { hits: CorpusHit[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {hits.map((hit) => (
        <li key={`${hit.rowid}-${hit.url}`} className="rounded-xl bg-surface-container p-4">
          <p className="text-[18px] font-semibold">
            [{hit.kind}] {hit.title}
          </p>
          <p className="mt-1 text-[16px] text-on-surface-variant">{hit.snippet}</p>
          <p className="mt-1 text-[14px] text-on-surface-variant">
            {hit.url} · score {hit.score.toFixed(2)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function DatabooksStudio() {
  const [documents, setDocuments] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("databook");
  const [hits, setHits] = useState<CorpusHit[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; model?: string; hits: CorpusHit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isTauri()) corpus.info().then((info) => setDocuments(info.documents), (cause: unknown) => setError(String(cause)));
  }, []);

  if (!isTauri()) {
    return <p className="text-[18px] text-on-surface-variant">Les databooks nécessitent l’application Aphrody.</p>;
  }

  const guard = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const search = () =>
    guard(async () => {
      const response = await corpus.search(query.trim(), { kind: kind || undefined, limit: 20 });
      setHits(response.results ?? []);
    });

  const ask = () =>
    guard(async () => {
      const response = await corpus.ask(question.trim());
      setAnswer({
        text: typeof response.answer === "string" ? response.answer : "(réponse vide)",
        model: typeof response.model === "string" ? response.model : undefined,
        hits: Array.isArray(response.hits) ? (response.hits as CorpusHit[]) : [],
      });
    });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Shenron"
        title="Databooks & corpus"
        subtitle={documents === null ? "Chargement du corpus…" : `${documents} documents en local`}
      />
      {error ? (
        <p role="alert" className="text-[18px] text-error">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeading level={2} title="Recherche" />
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim().length >= 2) void search();
          }}
        >
          <select aria-label="Type de document" className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            aria-label="Recherche dans le corpus"
            className={`${fieldClass} flex-1`}
            placeholder="ex. Daizenshuu Goku"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button className={buttonClass} type="submit" disabled={busy || query.trim().length < 2}>
            Rechercher
          </Button>
        </form>
        <HitList hits={hits} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading level={2} title="Question sourcée" standfirst="Réponse du modèle local à partir des passages du corpus" />
        <form
          className="flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim().length >= 2) void ask();
          }}
        >
          <input
            aria-label="Question"
            className={`${fieldClass} flex-1`}
            placeholder="ex. Quelle est la puissance de Freezer selon le Daizenshuu ?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button className={buttonClass} type="submit" disabled={busy || question.trim().length < 2}>
            Demander
          </Button>
        </form>
        {answer ? (
          <Card className="flex flex-col gap-3 p-6">
            <p className="whitespace-pre-wrap text-[18px]">{answer.text}</p>
            {answer.model ? <p className="text-[14px] text-on-surface-variant">Modèle : {answer.model}</p> : null}
            <HitList hits={answer.hits} />
          </Card>
        ) : null}
      </section>
    </div>
  );
}
