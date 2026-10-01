// SPDX-License-Identifier: Apache-2.0
import React, { type ComponentType, type ReactElement, type ReactNode } from "react";

export interface RouteDefinition {
  /** Matched URL path (e.g. "/" or "/dashboard" or "/items/:id") */
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
  const normalizedFiles = files.map((f) => f.replace(/\\/g, "/"));

  // Identify all layout files
  const layoutFiles = normalizedFiles
    .filter((f) => /(^|\/)layout\.(tsx|jsx|js|ts)$/.test(f))
    .sort((a, b) => a.split("/").length - b.split("/").length);

  const rootLayout = layoutFiles.find((f) => f === "app/layout.tsx" || f === "layout.tsx" || f.startsWith("app/layout."));

  // Identify all page files
  const pageFiles = normalizedFiles.filter((f) => /(^|\/)page\.(tsx|jsx|js|ts)$/.test(f));

  const routes: RouteDefinition[] = [];

  for (const pageFile of pageFiles) {
    // Determine route path from page file path
    // Remove "app/" prefix and "/page.tsx" suffix
    let seg = pageFile.replace(/^app\/?/, "");
    seg = seg.replace(/\/?page\.(tsx|jsx|js|ts)$/, "");
    if (seg === "" || seg === "/") {
      seg = "";
    }

    const segments = seg ? seg.split("/").filter(Boolean) : [];
    const params: string[] = [];

    const mappedSegments = segments.map((part) => {
      // Dynamic route segment [id] -> :id
      const dynMatch = /^\[([^\]]+)\]$/.exec(part);
      if (dynMatch) {
        params.push(dynMatch[1]);
        return `:${dynMatch[1]}`;
      }
      // Catch-all [...slug] -> *
      const catchAllMatch = /^\[\.\.\.([^\]]+)\]$/.exec(part);
      if (catchAllMatch) {
        params.push(catchAllMatch[1]);
        return "*";
      }
      return part;
    });

    const routePath = mappedSegments.length === 0 ? "/" : `/${mappedSegments.join("/")}`;

    // Find all layouts that apply to this page:
    // A layout applies if the page directory starts with the layout's directory.
    const pageDir = pageFile.slice(0, pageFile.lastIndexOf("/"));

    const applicableLayouts = layoutFiles.filter((layout) => {
      const layoutDir = layout.slice(0, layout.lastIndexOf("/"));
      if (!layoutDir || layoutDir === "app") return true; // root layout applies everywhere under app/
      return pageDir === layoutDir || pageDir.startsWith(`${layoutDir}/`);
    });

    routes.push({
      routePath,
      pageFile,
      layouts: applicableLayouts,
      params,
    });
  }

  // Sort routes so exact matches come before wildcard / dynamic params
  routes.sort((a, b) => {
    const aDyn = a.routePath.includes(":") || a.routePath.includes("*");
    const bDyn = b.routePath.includes(":") || b.routePath.includes("*");
    if (aDyn && !bDyn) return 1;
    if (!aDyn && bDyn) return -1;
    return a.routePath.localeCompare(b.routePath);
  });

  return {
    routes,
    layouts: layoutFiles,
    rootLayout,
  };
}

/**
 * Composes a stack of layouts around a page component.
 * Layouts are applied from outermost (index 0) to innermost (last index).
 */
export function composeLayouts(
  layouts: Array<ComponentType<{ children: ReactNode }>>,
  Page: ComponentType<any>,
  pageProps: any = {}
): ReactElement {
  return layouts.reduceRight<ReactElement>(
    (children, Layout) => React.createElement(Layout, null, children),
    React.createElement(Page, pageProps)
  );
}

/**
 * Generates the TypeScript source for src/App.tsx supporting nested layouts and routing.
 */
export function generateAppRouterCode(
  hierarchy: RouteHierarchy,
  options: { modernizeM3?: boolean; target?: string } = {}
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
  const routeBranches = routes.map((route) => {
    const pageVar = pageVarMap.get(route.pageFile)!;
    const layoutVars = route.layouts.map((l) => layoutVarMap.get(l)!).filter(Boolean);

    // Regex or exact match
    let matchCondition = `cleanPath === '${route.routePath}'`;
    let paramExtraction = "";

    if (route.params.length > 0) {
      const regexStr = route.routePath
        .replace(/:([a-zA-Z0-9_]+)/g, "(?<$1>[^/]+)")
        .replace(/\*/g, "(?<catchall>.*)");
      matchCondition = `new RegExp('^${regexStr}$').test(cleanPath)`;
      paramExtraction = `
      const match = cleanPath.match(new RegExp('^${regexStr}$'));
      const routeParams = match?.groups ?? {};
`;
    }

    return `    if (${matchCondition}) {${paramExtraction}
      return composeLayouts([${layoutVars.join(", ")}], ${pageVar}, { params: ${route.params.length > 0 ? "routeParams" : "{}"} });
    }`;
  });

  const m3Import = options.modernizeM3 ? `import '@aphrody/m3-theme/m3.css';\n` : "";

  return `// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { usePathname } from '@aphrody/m3-next-migrate/shims/navigation';
import { composeLayouts } from '@aphrody/m3-next-migrate/layout';
${m3Import}
// Layout Components
${layoutImports.join("\n")}

// Page Components
${pageImports.join("\n")}

export default function App() {
  const pathname = usePathname();
  const cleanPath = pathname || '/';

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
