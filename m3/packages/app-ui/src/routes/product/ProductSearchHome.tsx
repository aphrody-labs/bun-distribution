// SPDX-License-Identifier: Apache-2.0
import { AphrodyAvatar, AphrodyPet, publicPetAtlas } from "@aphrody/identity";
import { PET_ATLAS_URL } from "@aphrody/identity/atlas";
import { Button } from "@aphrody/m3-primitives";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { searchGoogle, type GoogleSearchPage } from "../../google-search";

export function ProductSearchHome({ assetBase }: { publicPreview?: boolean; assetBase?: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<GoogleSearchPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setBusy(true);
    setError("");
    setPage(null);
    try {
      setPage(await searchGoogle({ query, vertical: "web", hl: "en", safe: "active", start: 0 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="flex min-h-full flex-col bg-surface text-on-surface"
      aria-labelledby="aphrody-home-title"
    >
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-12 text-center sm:px-8 sm:py-20">
        <div className="mb-5 flex items-center gap-4">
          <AphrodyAvatar size={64} label="Aphrody logo" />
          <h1 id="aphrody-home-title" className="text-display-large font-medium tracking-tight">
            Aphrody
          </h1>
        </div>
        <p className="mb-8 max-w-xl text-body-large text-on-surface-variant">
          Create, explore and build. Your apps, tools and Material 3 components share one workspace.
        </p>
        <search aria-label="Google search through Aphrody" className="w-full">
          <form aria-label="Google search through Aphrody" onSubmit={submit} className="w-full">
            <label htmlFor="aphrody-home-search" className="sr-only">
              Search the web
            </label>
            <div className="flex min-h-16 items-center gap-3 rounded-full bg-surface-container-high px-5 shadow-sm ring-1 ring-outline-variant transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary">
              <span className="material-symbol text-2xl text-on-surface-variant" aria-hidden="true">
                search
              </span>
              <input
                id="aphrody-home-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                required
                placeholder="Search the web"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-4 text-body-large text-on-surface outline-none placeholder:text-on-surface-variant"
              />
              <button
                type="submit"
                disabled={busy}
                aria-label={busy ? "Searching" : "Search"}
                className="flex min-h-12 min-w-12 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-50"
              >
                <span className="material-symbol" aria-hidden="true">
                  {busy ? "hourglass_top" : "arrow_forward"}
                </span>
              </button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="submit"
                disabled={busy}
                variant="tonal"
                className="min-h-12 rounded-full"
              >
                {busy ? "Searching…" : "Aphrody Search"}
              </Button>
              <Button
                href="https://os.aphrody.com/"
                variant="filled"
                className="min-h-12 rounded-full"
              >
                Open Aphrody OS
              </Button>
            </div>
          </form>
        </search>
        <p className="mt-4 text-body-small text-on-surface-variant">
          Google results via the native Aphrody engine. SafeSearch on, no account cookies.
        </p>
        <Link
          to="/studio?section=google"
          className="mt-3 min-h-12 content-center rounded-full px-4 text-label-large text-primary underline"
        >
          Search images, news, videos and books
        </Link>
        <div className="mt-7" aria-hidden="true">
          <AphrodyPet
            atlasUrl={publicPetAtlas(PET_ATLAS_URL, assetBase)}
            height={80}
            label="Aphrody pet"
          />
        </div>
      </section>
      <section
        aria-live="polite"
        aria-busy={busy}
        className="mx-auto w-full max-w-3xl px-5 sm:px-8"
      >
        {error && (
          <p
            role="alert"
            className="mb-8 rounded-extra-large bg-error-container p-5 text-on-error-container"
          >
            {error}
            {query.trim() && (
              <a
                className="mt-3 block min-h-12 content-center underline"
                href={`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Search on Google
              </a>
            )}
          </p>
        )}
        {page && (
          <div className="pb-10 text-left">
            <h2 className="text-title-large">Results for {page.query}</h2>
            {page.correctedQuery && (
              <p className="mt-2 text-on-surface-variant">
                Suggested correction: {page.correctedQuery}
              </p>
            )}
            {page.organic.length === 0 && (
              <p className="mt-4">No usable results returned by the native engine.</p>
            )}
            <ol className="mt-6 flex flex-col gap-6">
              {page.organic.map((hit) => (
                <li key={hit.url + hit.title}>
                  <p className="truncate text-body-small text-on-surface-variant">{hit.url}</p>
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-title-large text-primary underline decoration-transparent hover:decoration-current"
                  >
                    {hit.title || hit.url}
                  </a>
                  <p className="mt-1 text-body-medium">{hit.snippet}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
      <footer className="bg-surface-container-low px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-title-medium">One home for your workspace</h2>
            <p className="mt-1 text-body-medium text-on-surface-variant">
              Documentation, project templates and working components. The same interface on the web
              and desktop.
            </p>
            <p className="mt-2 text-body-medium text-on-surface-variant">
              Chat, files, local models and Studio are available from the application navigation.
            </p>
            <details className="mt-3 text-body-medium text-on-surface-variant">
              <summary className="cursor-pointer text-primary">
                Explore the workspace resources
              </summary>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Documentation: understand the runtimes, desktop and shared architecture.</li>
                <li>Templates: start with real source files and the workspace CLI.</li>
                <li>Material 3: try the actual M3 packages, motion, forms and themes.</li>
              </ul>
            </details>
          </div>
          <nav
            aria-label="Aphrody resources"
            className="flex flex-wrap gap-x-5 gap-y-2 text-label-large text-on-surface-variant"
          >
            <Link className="min-h-12 content-center underline" to="/docs">
              Documentation
            </Link>
            <Link className="min-h-12 content-center underline" to="/templates">
              Templates
            </Link>
            <Link className="min-h-12 content-center underline" to="/material-3/components">
              Material 3
            </Link>
            <a className="min-h-12 content-center underline" href="https://downloads.aphrody.com/">
              Downloads
            </a>
            <Link className="min-h-12 content-center underline" to="/studio">
              Studio
            </Link>
          </nav>
        </div>
      </footer>
    </article>
  );
}
