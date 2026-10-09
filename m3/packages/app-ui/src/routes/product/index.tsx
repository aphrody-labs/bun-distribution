// SPDX-License-Identifier: Apache-2.0
import { AphrodyAvatar, AphrodyPet, PET_COLORS } from "@aphrody/identity";
import { PET_ATLAS_URL } from "@aphrody/identity/atlas";
import { Button } from "@aphrody/m3-primitives";
import { Markdown } from "@aphrody/m3-ai";
import { M3ThemeProvider } from "@aphrody/m3-theme/react";
import { Component, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { usePlatform } from "../../contexts/PlatformContext";
import { publicDestinations } from "../../public-navigation";
import { PAGES, type PageId } from "../../../showcase/src/pages";
import { useAdaptive } from "../../../showcase/src/adaptive/window";
import { PACKAGES } from "../../../showcase/src/inventory";
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
        <p className="max-w-3xl text-body-large text-on-surface-variant">{summary}</p>
      </header>
      {children}
    </article>
  );
}

export function ProductHome() {
  const platform = usePlatform();
  if (platform.platform === "tauri") return <Navigate to="/explorer" replace />;
  return (
    <div className="h-full overflow-auto">
      <ProductPage
        title="Aphrody"
        summary="Create, explore and build with Aphrody. Your apps, tools and Material 3 components share one workspace."
      >
        <section
          className="flex flex-col items-start gap-6 rounded-extra-large bg-primary-container p-6 text-on-primary-container sm:flex-row sm:flex-wrap sm:items-center"
          aria-label="Aphrody identity"
        >
          <AphrodyAvatar size={80} label="Aphrody logo" />
          <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-1">
            <h2 className="text-headline-medium">One home for your workspace</h2>
            <p className="text-body-large">
              Documentation, project templates and working components. The same interface on the web
              and desktop.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                href="/docs"
                variant="filled"
                className="min-h-12 max-w-full whitespace-normal"
              >
                Read the docs
              </Button>
              <Button
                href="/material-3/components"
                variant="tonal"
                className="min-h-12 max-w-full whitespace-normal"
              >
                Explore components
              </Button>
            </div>
          </div>
          <AphrodyPet atlasUrl={PET_ATLAS_URL} height={144} label="Aphrody pet" />
        </section>
        <div className="grid gap-4 md:grid-cols-3">
          {publicDestinations.slice(1).map((destination) => (
            <Link
              key={destination.route}
              to={destination.route}
              className="state-layer flex flex-col gap-3 rounded-large bg-surface-container p-6"
            >
              <span className="material-symbol text-primary" aria-hidden="true">
                {destination.icon}
              </span>
              <h2 className="text-title-large">{destination.label}</h2>
              <p className="text-body-large text-on-surface-variant">
                {destination.route === "/docs"
                  ? "Understand the runtimes, desktop and shared architecture."
                  : destination.route === "/templates"
                    ? "Start with real source files and the workspace CLI."
                    : "Try the actual M3 packages, motion, forms and themes."}
              </p>
            </Link>
          ))}
        </div>
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-large bg-surface-container-low p-6">
          <div>
            <h2 className="text-title-large">Your tools are here too</h2>
            <p className="text-body-large text-on-surface-variant">
              Chat, files, local models and Studio are available from the application navigation.
            </p>
          </div>
          <Button href="/studio" variant="outlined">
            Open Studio
          </Button>
        </section>
      </ProductPage>
    </div>
  );
}

function useCatalog<T>(path: "/api/docs" | "/api/templates", parse: (value: unknown) => T[]) {
  const [state, setState] = useState<{ attempt: number; data?: T[]; error?: string }>({
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
            error: error instanceof Error ? error.message : "Catalog unavailable.",
          });
      });
    return () => controller.abort();
  }, [path, parse, revision]);
  return { ...(state.attempt === revision ? state : {}), retry: () => retry((value) => value + 1) };
}

function CatalogState({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <div className="rounded-large bg-surface-container p-6" role={error ? "alert" : "status"}>
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
          selected?.summary ?? "Guides for Aphrody runtimes, Material 3 and the desktop workspace."
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
                <span className="text-label-large text-primary">{document.category}</span>
                <h2 className="text-title-large">{document.title}</h2>
                <p className="text-body-large text-on-surface-variant">{document.summary}</p>
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
              <section aria-label="Template source" className="flex flex-col gap-3">
                {selected.files.map((file) => (
                  <details
                    key={file.path}
                    className="select-text rounded-large bg-surface-container p-4"
                  >
                    <summary className="cursor-pointer text-title-medium">{file.path}</summary>
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
                <p className="text-body-large text-on-surface-variant">{template.tagline}</p>
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

const pageLabels: Record<PageId, string> = {
  overview: "Overview",
  theme: "Theme",
  components: "Components",
  primitives: "Primitives",
  forms: "Forms",
  explorer: "Explorer",
  motion: "Motion",
  icons: "Icons & fonts",
  ai: "AI",
  reader: "Reader",
  design: "Design",
  next: "Next",
  system: "System",
  brands: "Identity & pet",
  adaptive: "Adaptive layouts",
};

class ShowcaseBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
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
      className="product-showcase h-full overflow-auto bg-surface text-on-surface"
    >
      {target && (
        <M3ThemeProvider
          target={target}
          defaultSeedColor={PET_COLORS.seed}
          defaultThemeMode={document.documentElement.classList.contains("dark") ? "dark" : "light"}
        >
          <div className="flex flex-wrap items-center gap-3 p-6">
            <label className="text-label-large" htmlFor="m3-demo-page">
              Material 3
            </label>
            <select
              id="m3-demo-page"
              className="min-h-12 rounded-medium border border-outline bg-surface-container px-4 text-body-large"
              value={selected}
              onChange={(event) => navigate(`/material-3/${event.target.value}`)}
            >
              {Object.entries(pageLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <span className="text-body-large text-on-surface-variant">
              {PACKAGES.length} real workspace packages and apps
            </span>
          </div>
          <ShowcaseBoundary key={selected}>
            <Suspense fallback={<output className="block p-6">Loading demonstration…</output>}>
              <Demo adaptive={adaptive} host="native" />
            </Suspense>
          </ShowcaseBoundary>
        </M3ThemeProvider>
      )}
    </div>
  );
}

export function ProductNotFound() {
  return (
    <div className="h-full overflow-auto">
      <ProductPage title="Page not found" summary="This address does not match a page in Aphrody.">
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
