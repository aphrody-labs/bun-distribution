// SPDX-License-Identifier: Apache-2.0
import { useState, type FormEvent } from "react";
import {
  searchGoogle,
  type GoogleSearchPage,
  type GoogleSearchRequest,
  type SearchVertical,
} from "../../google-search";

export interface GoogleStudioMessages {
  title: string;
  intro: string;
  query: string;
  resultsType: string;
  web: string;
  images: string;
  news: string;
  videos: string;
  books: string;
  language: string;
  french: string;
  english: string;
  safe: string;
  search: string;
  searching: string;
  unavailable: string;
  results: string;
  correction: string;
  empty: string;
  pages: string;
  previous: string;
  next: string;
}
const defaultMessages: GoogleStudioMessages = {
  title: "Recherche Aphrody",
  intro: "Recherche web, sans cookies de compte.",
  query: "Votre recherche",
  resultsType: "Résultats",
  web: "Web",
  images: "Images",
  news: "Actualités",
  videos: "Vidéos",
  books: "Livres",
  language: "Langue",
  french: "Français",
  english: "English",
  safe: "SafeSearch",
  search: "Rechercher",
  searching: "Recherche…",
  unavailable: "La recherche est indisponible. Veuillez réessayer.",
  results: "Résultats pour",
  correction: "Correction suggérée :",
  empty: "Aucun résultat retourné.",
  pages: "Pages de résultats",
  previous: "Précédente",
  next: "Suivante",
};
export function GoogleStudio({
  messages = defaultMessages,
  language = "fr",
}: { messages?: GoogleStudioMessages; language?: "fr" | "en" } = {}) {
  const [query, setQuery] = useState("");
  const [vertical, setVertical] = useState<SearchVertical>("web");
  const [preferredLanguage, setLanguage] = useState<"fr" | "en" | null>(null);
  const hl = preferredLanguage ?? language;
  const [safe, setSafe] = useState<"active" | "off">("active");
  const [page, setPage] = useState<GoogleSearchPage | null>(null);
  const [request, setRequest] = useState<GoogleSearchRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function run(next: GoogleSearchRequest) {
    if (busy) return;
    setBusy(true);
    setError(false);
    setPage(null);
    try {
      setPage(await searchGoogle(next));
      setRequest(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run({ query, vertical, hl, safe, start: 0 });
  }

  return (
    <div lang={language} className="flex max-w-4xl flex-col gap-6">
      <header>
        <h2 className="text-headline-small">{messages.title}</h2>
        <p className="text-body-medium text-on-surface-variant">{messages.intro}</p>
      </header>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          {messages.query}
          <input
            type="search"
            required
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="rounded-xl bg-surface-container px-4 py-3"
          />
        </label>
        <div className="flex flex-wrap gap-4">
          <label>
            {messages.resultsType}{" "}
            <select
              value={vertical}
              onChange={event => setVertical(event.target.value as SearchVertical)}
              className="rounded-lg bg-surface-container p-2"
            >
              <option value="web">{messages.web}</option>
              <option value="images">{messages.images}</option>
              <option value="news">{messages.news}</option>
              <option value="videos">{messages.videos}</option>
              <option value="books">{messages.books}</option>
            </select>
          </label>
          <label>
            {messages.language}{" "}
            <select
              value={hl}
              onChange={event => setLanguage(event.target.value === "en" ? "en" : "fr")}
              className="rounded-lg bg-surface-container p-2"
            >
              <option value="fr">{messages.french}</option>
              <option value="en">{messages.english}</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={safe === "active"}
              onChange={event => setSafe(event.target.checked ? "active" : "off")}
            />
            {messages.safe}
          </label>
        </div>
        <button
          disabled={busy}
          type="submit"
          className="min-h-12 self-start rounded-full bg-primary px-6 text-on-primary disabled:opacity-50"
        >
          {busy ? messages.searching : messages.search}
        </button>
      </form>
      <div aria-live="polite" aria-busy={busy}>
        {error && (
          <p role="alert" className="text-error">
            {messages.unavailable}
          </p>
        )}
        {page && (
          <>
            <h3 className="text-title-medium">
              {messages.results} {page.query}
            </h3>
            {page.correctedQuery && (
              <p>
                {messages.correction} {page.correctedQuery}
              </p>
            )}
            {page.organic.length === 0 && <p>{messages.empty}</p>}
            <ol className="mt-4 flex flex-col gap-5" start={(request?.start ?? 0) + 1}>
              {page.organic.map(hit => (
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
              <nav aria-label={messages.pages} className="mt-4 flex gap-4">
                <button
                  type="button"
                  disabled={busy || request.start === 0}
                  onClick={() => void run({ ...request, start: Math.max(0, request.start - 10) })}
                >
                  {messages.previous}
                </button>
                <button
                  type="button"
                  disabled={busy || page.organic.length === 0 || request.start >= 1000}
                  onClick={() => void run({ ...request, start: request.start + 10 })}
                >
                  {messages.next}
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
