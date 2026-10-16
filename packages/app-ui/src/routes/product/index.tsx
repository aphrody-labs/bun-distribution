// SPDX-License-Identifier: Apache-2.0
import { PET_COLORS } from "@aphrody/identity";
import { ProductSearchHome } from "./ProductSearchHome";
import { Button } from "@aphrody/m3-primitives";
import { Markdown } from "@aphrody/m3-ai";
import { httpSchemeSheet } from "@aphrody/m3-theme";
import { M3ThemeProvider } from "@aphrody/m3-theme/react";
import {
  Component,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { usePlatform } from "../../contexts/PlatformContext";

import { PAGES, type PageId } from "../../material/pages";
import { useAdaptive } from "../../material/adaptive/window";
import { PACKAGES } from "../../material/inventory";
import { DESTINATIONS } from "../../material/nav";
import { documentsFrom, templatesFrom, loadCatalog } from "./catalog";

function ProductPage({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <article
      className="product-page mx-auto flex w-full max-w-6xl flex-col gap-6 p-6"
      aria-labelledby="product-title"
    >
      <header className="flex flex-col gap-2">
        <h1 id="product-title" className="text-headline-large text-on-surface">
          {title}
        </h1>
        <p className="max-w-3xl text-body-large text-on-surface-variant">
          {summary}
        </p>
      </header>
      {children}
    </article>
  );
}

export function ProductHome() {
  const platform = usePlatform();
  if (platform.platform === "tauri") return <Navigate to="/explorer" replace />;
  return <ProductSearchHome />;
}

function useCatalog<T>(
  path: "/api/docs" | "/api/templates",
  parse: (value: unknown) => T[],
) {
  const [state, setState] = useState<{
    attempt: number;
    data?: T[];
    error?: string;
  }>({
    attempt: 0,
  });
  const [revision, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadCatalog(path, parse, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ attempt: revision, data });
        return undefined;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            attempt: revision,
            error:
              error instanceof Error ? error.message : "Catalog unavailable.",
          });
      });
    return () => controller.abort();
  }, [path, parse, revision]);
  return {
    ...(state.attempt === revision ? state : {}),
    retry: () => retry((value) => value + 1),
  };
}

function CatalogState({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <div
      className="rounded-large bg-surface-container p-6"
      role={error ? "alert" : "status"}
    >
      <p className="text-body-large">{error ?? "Loading catalog…"}</p>
      {error && (
        <Button type="button" variant="tonal" onClick={retry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}

export function DocumentsRoute() {
  const { id } = useParams();
  const { data, error, retry } = useCatalog("/api/docs", documentsFrom);
  const selected = data?.find((document) => document.id === id);
  return (
    <div className="h-full overflow-auto">
      <ProductPage
        title={selected?.title ?? "Documentation"}
        summary={
          selected?.summary ??
          "Guides for Aphrody runtimes, Material 3 and the desktop workspace."
        }
      >
        {!data ? (
          <CatalogState error={error} retry={retry} />
        ) : id ? (
          selected ? (
            <>
              <Link to="/docs" className="text-primary underline">
                All documentation
              </Link>
              <div className="select-text rounded-large bg-surface-container-low p-6">
                <Markdown content={selected.content} />
              </div>
            </>
          ) : (
            <output>
              This article was not found.{" "}
              <Link to="/docs" className="text-primary underline">
                Browse documentation
              </Link>
            </output>
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.map((document) => (
              <Link
                to={`/docs/${document.id}`}
                key={document.id}
                className="state-layer flex flex-col gap-3 rounded-large bg-surface-container p-6"
              >
                <span className="text-label-large text-primary">
                  {document.category}
                </span>
                <h2 className="text-title-large">{document.title}</h2>
                <p className="text-body-large text-on-surface-variant">
                  {document.summary}
                </p>
                <span className="text-label-large">{document.readTime}</span>
              </Link>
            ))}
            {data.length === 0 && <output>No documents are available.</output>}
          </div>
        )}
      </ProductPage>
    </div>
  );
}

export function TemplatesRoute() {
  const { id } = useParams();
  const { data, error, retry } = useCatalog("/api/templates", templatesFrom);
  const selected = data?.find((template) => template.id === id);
  return (
    <div className="h-full overflow-auto">
      <ProductPage
        title={selected?.name ?? "Project templates"}
        summary={
          selected?.description ??
          "Start from the workspace's real templates. Inspect the source before creating your project."
        }
      >
        {!data ? (
          <CatalogState error={error} retry={retry} />
        ) : id ? (
          selected ? (
            <>
              <Link to="/templates" className="text-primary underline">
                All templates
              </Link>
              <section
                className="select-text rounded-large bg-surface-container p-6"
                aria-label="Create project"
              >
                <h2 className="mb-3 text-title-large">Create this project</h2>
                <pre className="overflow-auto rounded-medium bg-surface-container-high p-4">
                  <code>{selected.cliCommand}</code>
                </pre>
              </section>
              <section
                aria-label="Template source"
                className="flex flex-col gap-3"
              >
                {selected.files.map((file) => (
                  <details
                    key={file.path}
                    className="select-text rounded-large bg-surface-container p-4"
                  >
                    <summary className="cursor-pointer text-title-medium">
                      {file.path}
                    </summary>
                    <pre className="mt-4 overflow-auto text-body-medium">
                      <code>{file.content}</code>
                    </pre>
                  </details>
                ))}
              </section>
            </>
          ) : (
            <output>
              This template was not found.{" "}
              <Link to="/templates" className="text-primary underline">
                Browse templates
              </Link>
            </output>
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.map((template) => (
              <Link
                to={`/templates/${template.id}`}
                key={template.id}
                className="state-layer flex flex-col gap-3 rounded-large bg-surface-container p-6"
              >
                <h2 className="text-title-large">{template.name}</h2>
                <p className="text-body-large text-on-surface-variant">
                  {template.tagline}
                </p>
                <div className="flex flex-wrap gap-2">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-secondary-container px-3 py-1 text-label-large text-on-secondary-container"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
            {data.length === 0 && <output>No templates are available.</output>}
          </div>
        )}
      </ProductPage>
    </div>
  );
}

class DemoBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <p className="p-6 text-body-large" role="alert">
        This demonstration is unavailable: {this.state.error}
      </p>
    ) : (
      this.props.children
    );
  }
}

/** Runtime seed, variant and contrast changes: Rust `scheme` sheets from aphrody-site. */
const rustSchemeSheet = httpSchemeSheet();

/** Old `/showcase/:page` links land on the Material 3 route. */
export function LegacyShowcaseRedirect() {
  const { page } = useParams();
  return <Navigate to={page ? `/material-3/${page}` : "/material-3"} replace />;
}

export function MaterialRoute() {
  const { page } = useParams();
  const navigate = useNavigate();
  const adaptive = useAdaptive();
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const selected =
    page === "buttons"
      ? "components"
      : page && Object.hasOwn(PAGES, page)
        ? (page as PageId)
        : "overview";
  const Demo = PAGES[selected];
  return (
    <div
      ref={setTarget}
      className="product-material h-full overflow-auto bg-surface text-on-surface"
    >
      {target && (
        <M3ThemeProvider
          target={target}
          defaultSeedColor={PET_COLORS.seed}
          sheet={rustSchemeSheet}
          defaultThemeMode={
            document.documentElement.classList.contains("dark")
              ? "dark"
              : "light"
          }
        >
          <div className="flex flex-wrap items-center gap-3 p-6">
            <label className="text-label-large" htmlFor="m3-demo-page">
              Material 3
            </label>
            <select
              id="m3-demo-page"
              className="min-h-12 rounded-medium border border-outline bg-surface-container px-4 text-body-large"
              value={selected}
              onChange={(event) =>
                navigate(`/material-3/${event.target.value}`)
              }
            >
              {DESTINATIONS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <span className="text-body-large text-on-surface-variant">
              {PACKAGES.length} real workspace packages and apps
            </span>
          </div>
          <DemoBoundary key={selected}>
            <Suspense
              fallback={
                <output className="block p-6">Loading demonstration…</output>
              }
            >
              <Demo adaptive={adaptive} host="native" />
            </Suspense>
          </DemoBoundary>
        </M3ThemeProvider>
      )}
    </div>
  );
}

export function ProductNotFound() {
  return (
    <div className="h-full overflow-auto">
      <ProductPage
        title="Page not found"
        summary="This address does not match a page in Aphrody."
      >
        <Button href="/" variant="filled">
          Return to Aphrody
        </Button>
        <Button href="/docs" variant="tonal">
          Browse documentation
        </Button>
      </ProductPage>
    </div>
  );
}

export function AppearanceRedirect() {
  return <Navigate to="/settings?section=appearance" replace />;
}
