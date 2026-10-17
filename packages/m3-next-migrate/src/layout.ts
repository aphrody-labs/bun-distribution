// SPDX-License-Identifier: Apache-2.0
import React, { type ComponentType, type ReactElement, type ReactNode } from "react";
import type { RouteParams } from "./shims/provider";

const rank = (part: string) => (part.endsWith("*?") ? 0 : part.endsWith("*") ? 1 : part.startsWith(":") ? 2 : 3);

export interface RouteDefinition {
  /** Matched URL path; :id is dynamic, :slug* is catch-all and :slug*? is optional catch-all. */
  routePath: string;
  /** Relative source file for page (e.g. "app/page.tsx" or "app/dashboard/page.tsx") */
  pageFile: string;
  /** Stack of layout files ordered from root to leaf (e.g. ["app/layout.tsx", "app/dashboard/layout.tsx"]) */
  layouts: string[];
  /** Named dynamic URL parameters, e.g. ["id"] */
  params: string[];
}

export interface RouteHierarchy {
  routes: RouteDefinition[];
  layouts: string[];
  rootLayout?: string;
}

/**
 * Builds a route hierarchy from a list of project relative file paths.
 * Identifies Next.js App Router conventions:
 * - layout files (app/layout.tsx, app/dashboard/layout.tsx, etc.)
 * - page files (app/page.tsx, app/dashboard/page.tsx, app/items/[id]/page.tsx)
 * And connects each page to its enclosing hierarchy of layouts.
 */
export function buildRouteHierarchy(files: string[]): RouteHierarchy {
  // Normalize paths to forward slashes
  const normalizedFiles = files.map(f => f.replace(/\\/g, "/"));

  // Identify all layout files
  const layoutFiles = normalizedFiles
    .filter(f => /(^|\/)layout\.(tsx|jsx|js|ts)$/.test(f))
    // oxlint-disable-next-line unicorn/no-array-sort -- This filtered array is owned; preserve the ES2022 consumer baseline.
    .sort((a, b) => a.split("/").length - b.split("/").length);

  const rootLayout = layoutFiles.find(f => /^(?:src\/)?(?:app\/)?layout\.(tsx|jsx|js|ts)$/.test(f));

  // Identify all page files
  const pageFiles = normalizedFiles.filter(f => /(^|\/)page\.(tsx|jsx|js|ts)$/.test(f));

  const routes: RouteDefinition[] = [];

  for (const pageFile of pageFiles) {
    // Determine route path from page file path
    // Remove "app/" prefix and "/page.tsx" suffix
    let seg = pageFile.replace(/^(?:src\/)?app\//, "");
    seg = seg.replace(/\/?page\.(tsx|jsx|js|ts)$/, "");
    if (seg === "" || seg === "/") {
      seg = "";
    }

    const segments = seg ? seg.split("/").filter(Boolean) : [];
    if (segments.some(part => part.startsWith("_") && !part.startsWith("%5F"))) continue;
    if (segments.some(part => part.startsWith("@") || /^\(\.{1,3}\)/.test(part))) {
      throw new Error(`Parallel and intercepted routes require a host adapter: ${pageFile}`);
    }
    const params: string[] = [];

    const mappedSegments = segments
      .filter(part => !/^\([^)]*\)$/.test(part))
      .map(part => {
        const optionalMatch = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(part);
        if (optionalMatch) {
          params.push(optionalMatch[1]);
          return `:${optionalMatch[1]}*?`;
        }
        const catchAllMatch = /^\[\.\.\.([^\]]+)\]$/.exec(part);
        if (catchAllMatch) {
          params.push(catchAllMatch[1]);
          return `:${catchAllMatch[1]}*`;
        }
        // Dynamic route segment [id] -> :id
        const dynMatch = /^\[([^\]]+)\]$/.exec(part);
        if (dynMatch) {
          params.push(dynMatch[1]);
          return `:${dynMatch[1]}`;
        }
        return part;
      });

    const routePath = mappedSegments.length === 0 ? "/" : `/${mappedSegments.join("/")}`;

    // Find all layouts that apply to this page:
    // A layout applies if the page directory starts with the layout's directory.
    const pageDir = pageFile.includes("/") ? pageFile.slice(0, pageFile.lastIndexOf("/")) : "";

    const applicableLayouts = layoutFiles.filter(layout => {
      const layoutDir = layout.includes("/") ? layout.slice(0, layout.lastIndexOf("/")) : "";
      if (!layoutDir) return true;
      return pageDir === layoutDir || pageDir.startsWith(`${layoutDir}/`);
    });

    routes.push({
      routePath,
      pageFile,
      layouts: applicableLayouts,
      params,
    });
  }

  // Compare specificity at each segment, so /posts/new beats /posts/:id and
  // /:id/settings beats /:id/:tab independently of file discovery order.
  routes.sort((a, b) => {
    const left = a.routePath.split("/").filter(Boolean);
    const right = b.routePath.split("/").filter(Boolean);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = rank(right[index] ?? "") - rank(left[index] ?? "");
      if (difference) return difference;
    }
    return a.routePath.localeCompare(b.routePath);
  });

  return {
    routes,
    layouts: layoutFiles,
    rootLayout,
  };
}

/** Matches paths without inserting filesystem names into regular expressions. */
export function matchRoutePath(routePath: string, pathname: string): RouteParams | null {
  const pattern = routePath.split("/").filter(Boolean);
  const segments = pathname.replace(/\/$/, "").split("/").slice(1);
  if (segments.length === 1 && segments[0] === "") segments.pop();
  const params: RouteParams = {};
  let offset = 0;
  try {
    for (const part of pattern) {
      if (part.startsWith(":")) {
        if (part.endsWith("*?") || part.endsWith("*")) {
          const optional = part.endsWith("*?");
          if (offset >= segments.length && !optional) return null;
          const name = part.slice(1, optional ? -2 : -1);
          if (offset < segments.length) params[name] = segments.slice(offset).map(decodeURIComponent);
          offset = segments.length;
        } else {
          if (!segments[offset]) return null;
          params[part.slice(1)] = decodeURIComponent(segments[offset++]!);
        }
      } else if (decodeURIComponent(segments[offset++] ?? "") !== decodeURIComponent(part)) {
        return null;
      }
    }
  } catch {
    return null;
  }
  return offset === segments.length ? params : null;
}

/**
 * Composes a stack of layouts around a page component.
 * Layouts are applied from outermost (index 0) to innermost (last index).
 */
export function composeLayouts(
  layouts: Array<ComponentType<{ children: ReactNode }>>,
  Page: ComponentType<any>,
  pageProps: any = {},
): ReactElement {
  return layouts.reduceRight<ReactElement>(
    (children, Layout) => React.createElement(Layout, { params: pageProps.params } as any, children),
    React.createElement(Page, pageProps),
  );
}

/**
 * Generates the TypeScript source for src/App.tsx supporting nested layouts and routing.
 */
export function generateAppRouterCode(
  hierarchy: RouteHierarchy,
  options: { modernizeM3?: boolean; target?: string } = {},
): string {
  const { routes, layouts } = hierarchy;

  if (routes.length === 0) {
    return `// SPDX-License-Identifier: Apache-2.0
import React from 'react';

export default function App() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Aphrody M3 App</h1>
      <p className="mt-2 text-on-surface-variant">No App Router pages were detected during migration.</p>
    </main>
  );
}
`;
  }

  // Generate component imports
  const layoutImports: string[] = [];
  const layoutVarMap = new Map<string, string>();

  layouts.forEach((layoutFile, idx) => {
    const varName = `Layout_${idx}`;
    layoutVarMap.set(layoutFile, varName);
    const cleanPath = `./components/${layoutFile.replace(/\.(tsx|jsx|js|ts)$/, "")}`;
    layoutImports.push(`import ${varName} from '${cleanPath}';`);
  });

  const pageImports: string[] = [];
  const pageVarMap = new Map<string, string>();

  routes.forEach((route, idx) => {
    const varName = `Page_${idx}`;
    pageVarMap.set(route.pageFile, varName);
    const cleanPath = `./components/${route.pageFile.replace(/\.(tsx|jsx|js|ts)$/, "")}`;
    pageImports.push(`import ${varName} from '${cleanPath}';`);
  });

  // Generate route matching cases
  const routeBranches = routes.map(route => {
    const pageVar = pageVarMap.get(route.pageFile)!;
    const layoutVars = route.layouts.map(l => layoutVarMap.get(l)!).filter(Boolean);

    return `    {
      const routeParams = matchRoutePath(${JSON.stringify(route.routePath)}, cleanPath);
      if (routeParams) return (
        <RouteParamsProvider params={routeParams}>
          {composeLayouts([${layoutVars.join(", ")}], ${pageVar}, { params: routeParams, searchParams })}
        </RouteParamsProvider>
      );
    }`;
  });

  const m3Import = options.modernizeM3 ? `import '@aphrody/m3-theme/m3.css';\n` : "";

  return `// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { usePathname } from '@aphrody/m3-next-migrate/shims/navigation';
import { composeLayouts } from '@aphrody/m3-next-migrate/layout';
import { matchRoutePath } from '@aphrody/m3-next-migrate/layout';
import { RouteParamsProvider } from '@aphrody/m3-next-migrate/shims/provider';
import { useSearchParams } from '@aphrody/m3-next-migrate/shims/navigation';
${m3Import}
// Layout Components
${layoutImports.join("\n")}

// Page Components
${pageImports.join("\n")}

export default function App() {
  const pathname = usePathname();
  const cleanPath = pathname || '/';
  const query = useSearchParams();
  const searchParams: Record<string, string | string[]> = {};
  for (const key of query.keys()) {
    const values = query.getAll(key);
    searchParams[key] = values.length === 1 ? values[0]! : values;
  }

${routeBranches.join("\n\n")}

  // Fallback 404
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-lg text-on-surface-variant">Page not found: {cleanPath}</p>
      <a href="/" className="mt-4 text-primary underline">Return Home</a>
    </div>
  );
}
`;
}
