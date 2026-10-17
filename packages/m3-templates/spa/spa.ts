// SPDX-License-Identifier: Apache-2.0
/**
 * Bun + React single-page app on TanStack Router (code-based route tree, no route generator), served by m3-bun:
 * `m3-bun dev` answers every path with the HTML entry, `m3-bun serve` falls back to `index.html` for client routes.
 */
import type { FileMap } from "../files.ts";

/** Version range written for `@tanstack/react-router` (npm latest on 2026-10-09). */
export const TANSTACK_ROUTER_RANGE = "^1.170.41";

export interface SpaTemplateOptions {
  name: string;
}

const ROUTER = `// SPDX-License-Identifier: Apache-2.0
import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { getNote, NOTES } from "./notes";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-surface text-on-surface">
      <nav className="flex gap-4 p-4 border-b border-outline-variant">
        <Link to="/" activeProps={{ className: "font-bold" }} activeOptions={{ exact: true }}>
          Home
        </Link>
        <Link to="/notes" activeProps={{ className: "font-bold" }}>
          Notes
        </Link>
      </nav>
      <main className="p-8">
        <Outlet />
      </main>
    </div>
  ),
  notFoundComponent: () => <p>Page not found.</p>,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1 className="text-2xl font-bold">Home</h1>,
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  component: () => (
    <ul className="flex flex-col gap-2">
      {NOTES.map(note => (
        <li key={note.id}>
          <Link to="/notes/$noteId" params={{ noteId: note.id }}>
            {note.title}
          </Link>
        </li>
      ))}
    </ul>
  ),
});

const noteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes/$noteId",
  loader: ({ params }) => getNote(params.noteId),
  component: function Note() {
    const note = noteRoute.useLoaderData();
    return (
      <article>
        <h1 className="text-2xl font-bold">{note.title}</h1>
        <p className="mt-2 text-on-surface-variant">{note.body}</p>
      </article>
    );
  },
});

const routeTree = rootRoute.addChildren([indexRoute, notesRoute, noteRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
`;

const NOTES = `// SPDX-License-Identifier: Apache-2.0
import { notFound } from "@tanstack/react-router";

export interface Note {
  id: string;
  title: string;
  body: string;
}

export const NOTES: readonly Note[] = [
  { id: "1", title: "First note", body: "Loaded by the route loader before the page renders." },
  { id: "2", title: "Second note", body: "Unknown ids end in the root notFoundComponent." },
];

export function getNote(id: string): Note {
  const note = NOTES.find(n => n.id === id);
  if (!note) throw notFound();
  return note;
}
`;

const MAIN = `// SPDX-License-Identifier: Apache-2.0
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "m3:theme.css";
import "m3:fonts.css";
import { router } from "./router";

const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
`;

export function spaFiles({ name }: SpaTemplateOptions): FileMap {
  const pkg = {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      dev: "m3-bun dev",
      build: "m3-bun build",
      serve: "m3-bun serve",
      typecheck: "bun check -p tsconfig.json --noEmit",
    },
    dependencies: {
      react: "catalog:",
      "react-dom": "catalog:",
      "@aphrody/m3": "workspace:*",
      "@aphrody/m3-bun": "workspace:*",
      "@tanstack/react-router": TANSTACK_ROUTER_RANGE,
    },
    devDependencies: {
      "@types/bun": "catalog:",
      "@types/react": "catalog:",
      "@types/react-dom": "catalog:",
      "@aphrody/m3-config": "workspace:*",
      typescript: "catalog:",
    },
    engines: { bun: ">=1.4.2" },
  };
  const title = name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return {
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "bunfig.toml": '[serve.static]\nplugins = ["@aphrody/m3/plugin"]\n',
    "m3.config.ts":
      'import { defineM3Config } from "@aphrody/m3/config";\nexport default defineM3Config({ entry: "src/index.html", port: 3000 });\n',
    "tsconfig.json": `${JSON.stringify(
      {
        extends: "@aphrody/m3-config/tsconfig.json",
        compilerOptions: { types: ["bun"] },
        include: ["src/**/*", "m3.config.ts"],
      },
      null,
      2,
    )}\n`,
    "src/index.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
`,
    "src/main.tsx": MAIN,
    "src/router.tsx": ROUTER,
    "src/notes.ts": NOTES,
    ".gitignore": "node_modules/\ndist/\nbin/\n",
  };
}
