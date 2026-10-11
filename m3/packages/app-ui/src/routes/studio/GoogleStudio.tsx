// SPDX-License-Identifier: Apache-2.0
import { useState, type FormEvent } from "react";
import {
  searchGoogle,
  type GoogleSearchPage,
  type GoogleSearchRequest,
  type SearchVertical,
} from "../../google-search";

export function GoogleStudio() {
  const [query, setQuery] = useState("");
  const [vertical, setVertical] = useState<SearchVertical>("web");
  const [hl, setLanguage] = useState("fr");
  const [safe, setSafe] = useState<"active" | "off">("active");
  const [page, setPage] = useState<GoogleSearchPage | null>(null);
  const [request, setRequest] = useState<GoogleSearchRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(next: GoogleSearchRequest) {
    if (busy) return;
    setBusy(true);
    setError("");
    setPage(null);
    try {
      setPage(await searchGoogle(next));
      setRequest(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La recherche a échoué.");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run({ query, vertical, hl, safe, start: 0 });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h2 className="text-headline-small">Recherche Google</h2>
        <p className="text-body-medium text-on-surface-variant">
          Recherche via le moteur natif Aphrody, sans cookies de compte Google.
        </p>
      </header>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          Votre recherche
          <input
            type="search"
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-xl bg-surface-container px-4 py-3"
          />
        </label>
        <div className="flex flex-wrap gap-4">
          <label>
            Résultats{" "}
            <select
              value={vertical}
              onChange={(event) => setVertical(event.target.value as SearchVertical)}
              className="rounded-lg bg-surface-container p-2"
            >
              <option value="web">Web</option>
              <option value="images">Images</option>
              <option value="news">Actualités</option>
              <option value="videos">Vidéos</option>
              <option value="books">Livres</option>
            </select>
          </label>
          <label>
            Langue{" "}
            <select
              value={hl}
              onChange={(event) => setLanguage(event.target.value)}
              className="rounded-lg bg-surface-container p-2"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={safe === "active"}
              onChange={(event) => setSafe(event.target.checked ? "active" : "off")}
            />
            SafeSearch
          </label>
        </div>
        <button
          disabled={busy}
          type="submit"
          className="min-h-12 self-start rounded-full bg-primary px-6 text-on-primary disabled:opacity-50"
        >
          {busy ? "Recherche…" : "Rechercher"}
        </button>
      </form>
      <div aria-live="polite" aria-busy={busy}>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {page && (
          <>
            <h3 className="text-title-medium">Résultats pour {page.query}</h3>
            {page.correctedQuery && <p>Correction suggérée : {page.correctedQuery}</p>}
            {page.organic.length === 0 && <p>Aucun résultat exploitable retourné par le moteur.</p>}
            <ol className="mt-4 flex flex-col gap-5" start={(request?.start ?? 0) + 1}>
              {page.organic.map((hit) => (
                <li key={hit.url + hit.title} className="rounded-xl bg-surface-container p-4">
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-title-medium text-primary underline"
                  >
                    {hit.title || hit.url}
                  </a>
                  <p className="break-all text-body-small text-on-surface-variant">{hit.url}</p>
                  <p className="mt-2 text-body-medium">{hit.snippet}</p>
                </li>
              ))}
            </ol>
            {request && (
              <nav aria-label="Pages de résultats" className="mt-4 flex gap-4">
                <button
                  type="button"
                  disabled={busy || request.start === 0}
                  onClick={() => void run({ ...request, start: Math.max(0, request.start - 10) })}
                >
                  Précédente
                </button>
                <button
                  type="button"
                  disabled={busy || page.organic.length === 0 || request.start >= 1000}
                  onClick={() => void run({ ...request, start: request.start + 10 })}
                >
                  Suivante
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
