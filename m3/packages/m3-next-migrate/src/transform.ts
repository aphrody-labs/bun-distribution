// SPDX-License-Identifier: Apache-2.0

import { matching, skippedSpans } from "@aphrody/next-bun/codemods/lex";

export interface TransformOptions {
  /** Target execution environment: 'tauri' desktop or 'vite' web SPA */
  target?: "tauri" | "vite";
  /** Path or package specifier for shims (e.g. '@aphrody/m3-next-migrate/shims' or './shims') */
  shimModule?: string;
  /** Strip 'use client' and 'use server' directives */
  stripDirectives?: boolean;
  /** Rewrite process.env.NEXT_PUBLIC_* to import.meta.env.VITE_* */
  rewriteEnv?: boolean;
  /** Adapt Next 16 async page props */
  adaptNext16AsyncProps?: boolean;
  /** Modernize UI components to authentic @aphrody/m3-primitives (Button, Input, Card, Badge, Tooltip, Collapsible) */
  modernizeM3?: boolean;
  /** Synchronize metadata / document.title to Tauri window title */
  syncMetadataTitle?: boolean;
  /** Adapt Root Layout <html> and <body> tags for desktop/SPA container */
  adaptRootLayout?: boolean;
  /** Apply aggressive n2b (Node to Bun) transforms for native desktop Bun runtime */
  n2b?: boolean;
}

export interface TransformResult {
  code: string;
  modified: boolean;
  transformations: string[];
  warnings: string[];
}

/** Merge JSX classes once while stripping the hydration-only flag and its value. */
function containerAttributes(attrs: string, className: string): string {
  let clean = attrs
    .replace(/\bsuppressHydrationWarning(?:\s*=\s*(?:\{[^}]*\}|["'][^"']*["']))?/g, "")
    .trim();
  const match = /\bclassName\s*=\s*/.exec(clean);
  if (!match) return 'className="' + className + '" ' + clean;
  const start = match.index + match[0].length;
  const spans = skippedSpans(clean);
  const token = spans.find((span) => span.start === start);
  const end = clean[start] === "{" ? matching(clean, start, spans) + 1 : token?.end;
  if (!end || end <= start)
    throw new Error("Cannot preserve the original Root Layout className expression");
  const expression =
    clean[start] === "{" ? clean.slice(start + 1, end - 1) : clean.slice(start, end);
  clean = (clean.slice(0, match.index) + clean.slice(end)).trim();
  return (
    "className={[" +
    JSON.stringify(className) +
    ", " +
    expression +
    '].filter(Boolean).join(" ")} ' +
    clean
  );
}

export function transformComponent(
  source: string,
  options: TransformOptions = {},
): TransformResult {
  const {
    target = "tauri",
    shimModule = "@aphrody/m3-next-migrate/shims",
    stripDirectives = true,
    rewriteEnv = true,
    adaptNext16AsyncProps = true,
    modernizeM3 = false,
    syncMetadataTitle = true,
    adaptRootLayout = true,
    n2b = true,
  } = options;

  let code = source;
  const transformations: string[] = [];
  const warnings: string[] = [];

  // 1. Directives: strip 'use client'
  if (stripDirectives) {
    const useClientRegex = /^[\t ]*(['"])use client\1;?[\r\n]*/m;
    if (useClientRegex.test(code)) {
      code = code.replace(useClientRegex, "");
      transformations.push("Stripped 'use client' directive (unneeded in client webview / SPA)");
    }

    // Directives: handle 'use server'
    const useServerFileRegex =
      /^((?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*)((?:['"]))use server\2;?[\r\n]*/;
    if (useServerFileRegex.test(code)) {
      code = code.replace(useServerFileRegex, "$1");
      transformations.push("Converted file-level 'use server' to client module");
      warnings.push(
        `File contained 'use server'. Its backend operations require the ${target} native host adapter before activation.`,
      );
    }
  }

  // 2. Import replacements
  // next/navigation
  const nextNavRegex = /from\s+['"]next\/navigation['"]/g;
  if (nextNavRegex.test(code)) {
    code = code.replace(nextNavRegex, `from '${shimModule}/navigation'`);
    transformations.push(`Rewrote 'next/navigation' import to '${shimModule}/navigation'`);
  }

  // next/link
  const nextLinkRegex = /from\s+['"]next\/link['"]/g;
  if (nextLinkRegex.test(code)) {
    code = code.replace(nextLinkRegex, `from '${shimModule}/link'`);
    transformations.push(`Rewrote 'next/link' import to '${shimModule}/link'`);
  }

  // next/image
  const nextImageRegex = /from\s+['"]next\/image['"]/g;
  if (nextImageRegex.test(code)) {
    code = code.replace(nextImageRegex, `from '${shimModule}/image'`);
    transformations.push(`Rewrote 'next/image' import to '${shimModule}/image'`);
  }

  // next/dynamic
  const nextDynamicRegex = /from\s+['"]next\/dynamic['"]/g;
  if (nextDynamicRegex.test(code)) {
    code = code.replace(nextDynamicRegex, `from '${shimModule}/dynamic'`);
    transformations.push(`Rewrote 'next/dynamic' import to '${shimModule}/dynamic'`);
  }

  // next/font/google
  const nextFontGoogleRegex = /from\s+['"]next\/font\/google['"]/g;
  if (nextFontGoogleRegex.test(code)) {
    code = code.replace(nextFontGoogleRegex, `from '${shimModule}/font'`);
    transformations.push(`Rewrote 'next/font/google' import to '${shimModule}/font'`);
  }

  // next/font/local
  const nextFontLocalRegex = /from\s+['"]next\/font\/local['"]/g;
  if (nextFontLocalRegex.test(code)) {
    code = code.replace(nextFontLocalRegex, `from '${shimModule}/font'`);
    transformations.push(`Rewrote 'next/font/local' import to '${shimModule}/font'`);
  }

  // next/headers
  const nextHeadersRegex = /from\s+['"]next\/headers['"]/g;
  if (nextHeadersRegex.test(code)) {
    code = code.replace(nextHeadersRegex, `from '${shimModule}/headers'`);
    transformations.push(`Rewrote 'next/headers' import to '${shimModule}/headers'`);
    warnings.push("Component used 'next/headers'. Shimmed with client cookies/headers store.");
  }

  // next/form
  const nextFormRegex = /from\s+['"]next\/form['"]/g;
  if (nextFormRegex.test(code)) {
    code = code.replace(nextFormRegex, `from '${shimModule}/form'`);
    transformations.push(`Rewrote 'next/form' import to '${shimModule}/form'`);
  }

  // next/router (Pages router legacy)
  const nextRouterLegacyRegex = /from\s+['"]next\/router['"]/g;
  if (nextRouterLegacyRegex.test(code)) {
    code = code.replace(nextRouterLegacyRegex, `from '${shimModule}/navigation'`);
    transformations.push(`Rewrote legacy 'next/router' import to '${shimModule}/navigation'`);
  }

  // next/head (Pages router legacy)
  const nextHeadRegex = /from\s+['"]next\/head['"]/g;
  if (nextHeadRegex.test(code)) {
    code = code.replace(nextHeadRegex, `from '${shimModule}/metadata'`);
    transformations.push(`Rewrote 'next/head' import to '${shimModule}/metadata'`);
  }

  // next types import: Metadata / ResolvingMetadata
  const nextMetadataTypeRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]next['"]/g;
  if (nextMetadataTypeRegex.test(code)) {
    code = code.replace(nextMetadataTypeRegex, (_match, specifiers) => {
      const parts = specifiers.split(",").map((s: string) => s.trim());
      const metadataParts = parts.filter(
        (s: string) => s === "Metadata" || s === "ResolvingMetadata" || s === "Viewport",
      );
      const otherParts = parts.filter(
        (s: string) => s !== "Metadata" && s !== "ResolvingMetadata" && s !== "Viewport",
      );

      let replacement = "";
      if (metadataParts.length > 0) {
        replacement += `import type { ${metadataParts.join(", ")} } from '${shimModule}/metadata';`;
      }
      if (otherParts.length > 0) {
        if (replacement) replacement += "\n";
        replacement += `import type { ${otherParts.join(", ")} } from 'next';`;
      }
      return replacement;
    });
    transformations.push(`Rewrote 'next' Metadata types import to '${shimModule}/metadata'`);
  }

  // next/server (Route Handlers & Middleware)
  const nextServerRegex = /from\s+['"]next\/server['"]/g;
  if (nextServerRegex.test(code)) {
    code = code.replace(nextServerRegex, `from '${shimModule}/server'`);
    transformations.push(
      `Rewrote 'next/server' import to '${shimModule}/server' (Bun Web Standards)`,
    );
  }

  // 2b. Aggressive n2b transformations
  if (n2b) {
    // Shebang rewrite to Bun
    const shebangRegex = /^#!\/usr\/bin\/env\s+node\b/m;
    if (shebangRegex.test(code)) {
      code = code.replace(shebangRegex, "#!/usr/bin/env bun");
      transformations.push("Rewrote shebang to #!/usr/bin/env bun");
    }

    // Node prefix for built-in imports
    const nodeBuiltinRegex =
      /from\s+['"](fs|fs\/promises|path|crypto|os|child_process|stream|util|buffer|http|https)['"]/g;
    if (nodeBuiltinRegex.test(code)) {
      code = code.replace(nodeBuiltinRegex, "from 'node:$1'");
      transformations.push("Standardized Node built-in imports to 'node:*' for Bun");
    }

    // Replace __dirname and __filename with import.meta
    if (/\b__dirname\b/.test(code)) {
      code = code.replace(/\b__dirname\b/g, "import.meta.dirname");
      transformations.push("Replaced __dirname with Bun native import.meta.dirname");
    }
    if (/\b__filename\b/.test(code)) {
      code = code.replace(/\b__filename\b/g, "import.meta.path");
      transformations.push("Replaced __filename with Bun native import.meta.path");
    }

    // Strip redundant dotenv calls (Bun loads .env automatically)
    const dotenvImportRegex = /import\s+['"]dotenv\/config['"];?[\r\n]*/g;
    if (dotenvImportRegex.test(code)) {
      code = code.replace(dotenvImportRegex, "");
      transformations.push("Removed redundant dotenv import (Bun loads .env automatically)");
    }
    const dotenvRequireRegex = /require\(['"]dotenv['"]\)\.config\([^)]*\);?[\r\n]*/g;
    if (dotenvRequireRegex.test(code)) {
      code = code.replace(dotenvRequireRegex, "");
      transformations.push("Removed redundant dotenv.config() call (Bun loads .env automatically)");
    }

    // Strip redundant node-fetch and cross-fetch imports (Bun has native global fetch)
    const nodeFetchRegex =
      /import\s+(?:fetch,\s*)?\{?[^}]*\}?\s*from\s+['"](?:node-fetch|cross-fetch)['"];?[\r\n]*/g;
    if (nodeFetchRegex.test(code)) {
      code = code.replace(nodeFetchRegex, "");
      transformations.push("Replaced node-fetch/cross-fetch with Bun native fetch");
    }
  }

  // 3. Modernize M3 Components (--m3)
  if (modernizeM3) {
    const m3ImportsToAdd = new Set<string>();

    // Button: rewrite button imports
    const buttonImportRegex =
      /import\s+\{([^}]+)\}\s+from\s+['"](?:@\/|\.\.?\/)*(?:components\/ui\/button|@radix-ui\/react-button)['"];?/g;
    if (buttonImportRegex.test(code)) {
      code = code.replace(buttonImportRegex, (_match, specifiers) => {
        specifiers.split(",").forEach((s: string) => {
          const item = s.trim();
          if (item) m3ImportsToAdd.add(item);
        });
        return "";
      });
      transformations.push("Modernized Button imports to @aphrody/m3-primitives");
    }

    // Input: rewrite input imports
    const inputImportRegex =
      /import\s+\{([^}]+)\}\s+from\s+['"](?:@\/|\.\.?\/)*(?:components\/ui\/input)['"];?/g;
    if (inputImportRegex.test(code)) {
      code = code.replace(inputImportRegex, (_match, specifiers) => {
        specifiers.split(",").forEach((s: string) => {
          const item = s.trim();
          if (item) m3ImportsToAdd.add(item);
        });
        return "";
      });
      transformations.push("Modernized Input imports to @aphrody/m3-primitives");
    }

    // Card: rewrite card imports
    const cardImportRegex =
      /import\s+\{([^}]+)\}\s+from\s+['"](?:@\/|\.\.?\/)*(?:components\/ui\/card)['"];?/g;
    if (cardImportRegex.test(code)) {
      code = code.replace(cardImportRegex, (_match, specifiers) => {
        specifiers.split(",").forEach((s: string) => {
          const item = s.trim();
          if (item) m3ImportsToAdd.add(item);
        });
        return "";
      });
      transformations.push("Modernized Card imports to @aphrody/m3-primitives");
    }

    // Badge: rewrite badge imports
    const badgeImportRegex =
      /import\s+\{([^}]+)\}\s+from\s+['"](?:@\/|\.\.?\/)*(?:components\/ui\/badge)['"];?/g;
    if (badgeImportRegex.test(code)) {
      code = code.replace(badgeImportRegex, (_match, specifiers) => {
        specifiers.split(",").forEach((s: string) => {
          const item = s.trim();
          if (item) m3ImportsToAdd.add(item);
        });
        return "";
      });
      transformations.push("Modernized Badge imports to @aphrody/m3-primitives");
    }

    // Tooltip: rewrite tooltip imports
    const tooltipImportRegex =
      /import\s+\{([^}]+)\}\s+from\s+['"](?:@\/|\.\.?\/)*(?:components\/ui\/tooltip|@radix-ui\/react-tooltip)['"];?/g;
    if (tooltipImportRegex.test(code)) {
      code = code.replace(tooltipImportRegex, (_match, specifiers) => {
        specifiers.split(",").forEach((s: string) => {
          const item = s.trim();
          if (item === "Tooltip") {
            // In @aphrody/m3-primitives, TooltipRoot is the primitive compound root
            m3ImportsToAdd.add("TooltipRoot");
            m3ImportsToAdd.add("Tooltip");
          } else if (item) {
            m3ImportsToAdd.add(item);
          }
        });
        return "";
      });
      transformations.push("Modernized Tooltip imports to @aphrody/m3-primitives");
    }

    // Collapsible: rewrite collapsible imports
    const collapsibleImportRegex =
      /import\s+\{([^}]+)\}\s+from\s+['"](?:@\/|\.\.?\/)*(?:components\/ui\/collapsible|@radix-ui\/react-collapsible)['"];?/g;
    if (collapsibleImportRegex.test(code)) {
      code = code.replace(collapsibleImportRegex, (_match, specifiers) => {
        specifiers.split(",").forEach((s: string) => {
          const item = s.trim();
          if (item) m3ImportsToAdd.add(item);
        });
        return "";
      });
      transformations.push("Modernized Collapsible imports to @aphrody/m3-primitives");
    }

    // Consolidate @aphrody/m3-primitives imports
    if (m3ImportsToAdd.size > 0) {
      // oxlint-disable-next-line unicorn/no-array-sort -- Sort the owned copy without requiring ES2023 in consumers.
      const sortedImports = Array.from(m3ImportsToAdd).sort();
      const importStatement = `import { ${sortedImports.join(", ")} } from '@aphrody/m3-primitives';\n`;
      code = importStatement + code;
    }

    // JSX transforms for Button variants:
    // destructive -> accent (M3 filled error look), secondary -> tonal, ghost -> text, outline -> outlined
    const btnDestructiveRegex = /<Button\b([^>]*)\bvariant=['"]destructive['"]/g;
    if (btnDestructiveRegex.test(code)) {
      code = code.replace(btnDestructiveRegex, "<Button$1variant='accent'");
      transformations.push("Mapped Button variant='destructive' to M3 'accent'");
    }

    const btnGhostRegex = /<Button\b([^>]*)\bvariant=['"]ghost['"]/g;
    if (btnGhostRegex.test(code)) {
      code = code.replace(btnGhostRegex, "<Button$1variant='text'");
      transformations.push("Mapped Button variant='ghost' to M3 'text'");
    }

    const btnOutlineRegex = /<Button\b([^>]*)\bvariant=['"]outline['"]/g;
    if (btnOutlineRegex.test(code)) {
      code = code.replace(btnOutlineRegex, "<Button$1variant='outlined'");
      transformations.push("Mapped Button variant='outline' to M3 'outlined'");
    }

    const btnSecondaryRegex = /<Button\b([^>]*)\bvariant=['"]secondary['"]/g;
    if (btnSecondaryRegex.test(code)) {
      code = code.replace(btnSecondaryRegex, "<Button$1variant='tonal'");
      transformations.push("Mapped Button variant='secondary' to M3 'tonal'");
    }

    // Tooltip JSX: if <Tooltip> wraps <TooltipTrigger>, rename to <TooltipRoot>
    if (code.includes("<TooltipTrigger")) {
      const openTooltipTagRegex = /<Tooltip(\s+[^>]*)?>(\s*<TooltipTrigger)/g;
      if (openTooltipTagRegex.test(code)) {
        code = code.replace(openTooltipTagRegex, "<TooltipRoot$1>$2");
        code = code.replace(/<\/Tooltip>/g, "</TooltipRoot>");
        transformations.push("Adapted compound <Tooltip> to M3 <TooltipRoot>");
      }
    }
  }

  // 4. Root Layout Adaptations (<html>, <body>)
  if (adaptRootLayout) {
    const hasHtmlTag = /<html\b[^>]*>/i.test(code);
    const hasBodyTag = /<body\b[^>]*>/i.test(code);

    if (hasHtmlTag || hasBodyTag) {
      // Replace <html ...> and </html>
      code = code.replace(/<html\b([^>]*)>/gi, (_match, attrs) => {
        return `<div data-root-layout ${containerAttributes(attrs, "m3-app-root")}>`;
      });
      code = code.replace(/<\/html>/gi, "</div>");

      // Replace <body ...> and </body>
      code = code.replace(/<body\b([^>]*)>/gi, (_match, attrs) => {
        return `<div ${containerAttributes(attrs, "m3-app-body")}>`;
      });
      code = code.replace(/<\/body>/gi, "</div>");

      transformations.push("Adapted Root Layout <html>/<body> tags to desktop/SPA containers");
    }
  }

  // 5. Environment variables
  if (rewriteEnv) {
    const nextPublicEnvRegex = /process\.env\.NEXT_PUBLIC_([a-zA-Z0-9_]+)/g;
    if (nextPublicEnvRegex.test(code)) {
      code = code.replace(nextPublicEnvRegex, (_match, varName) => {
        return `(import.meta.env.VITE_${varName} ?? import.meta.env.NEXT_PUBLIC_${varName})`;
      });
      transformations.push("Rewrote process.env.NEXT_PUBLIC_* to import.meta.env");
    }

    // Generic process.env.NODE_ENV
    code = code.replace(/process\.env\.NODE_ENV/g, "import.meta.env.MODE");
  }

  // 6. Adapt Next 16 async page props:
  // e.g. export default async function Page({ params, searchParams }: ...
  if (adaptNext16AsyncProps) {
    const asyncPageFnRegex = /export\s+default\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/;
    if (asyncPageFnRegex.test(code)) {
      code = code.replace(asyncPageFnRegex, "export default function $1($2)");
      transformations.push(
        "Adapted Next 16 async Page component signature to synchronous client component",
      );
    }

    // Replace `await params` or `await searchParams` with resolved values
    const awaitParamsRegex = /await\s+params\b/g;
    if (awaitParamsRegex.test(code)) {
      code = code.replace(awaitParamsRegex, "params");
      transformations.push("Normalized Next 16 `await params` to `params`");
    }

    const awaitSearchParamsRegex = /await\s+searchParams\b/g;
    if (awaitSearchParamsRegex.test(code)) {
      code = code.replace(awaitSearchParamsRegex, "searchParams");
      transformations.push("Normalized Next 16 `await searchParams` to `searchParams`");
    }
  }

  // 7. Check for Server Actions inside component: ("use server" inside async function)
  const inlineServerActionRegex =
    /(async\s+function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{)\s*(['"])use server\2;?/g;
  if (inlineServerActionRegex.test(code)) {
    code = code.replace(inlineServerActionRegex, "$1");
    transformations.push("Removed inline 'use server' inside component function");
    warnings.push(
      `Inline Server Action detected. Its backend operations require the ${target} native host adapter before activation.`,
    );
  }

  // 8. Metadata synchronization: export const metadata & generateMetadata
  if (syncMetadataTitle) {
    const hasStaticMetadata = /export\s+const\s+metadata(?::\s*Metadata)?\s*=\s*/.test(code);
    const hasGenerateMetadata = /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(code);

    if (hasStaticMetadata || hasGenerateMetadata) {
      let needsMetadataHookImport = false;

      // Inject useMetadata hook into default exported function
      const defaultExportFnRegex =
        /(export\s+default\s+function(?:\s+[A-Za-z0-9_]+)?\s*\([^)]*\)\s*\{)/;
      if (defaultExportFnRegex.test(code)) {
        if (hasStaticMetadata) {
          code = code.replace(defaultExportFnRegex, "$1\n  useMetadata(metadata);");
          needsMetadataHookImport = true;
          transformations.push(
            "Synchronized static metadata with Tauri window title and document.title",
          );
        } else if (hasGenerateMetadata) {
          code = code.replace(
            defaultExportFnRegex,
            "$1\n  useMetadata(() => generateMetadata(arguments[0] || ({} as any)), []);",
          );
          needsMetadataHookImport = true;
          transformations.push(
            "Synchronized dynamic generateMetadata with Tauri window title and document.title",
          );
        }
      }

      if (needsMetadataHookImport && !/import\s*\{[^}]*\buseMetadata\s*(?:,|\})/.test(code)) {
        code = `import { useMetadata } from '${shimModule}/metadata';\n` + code;
      }
    }

    // Native <title> or <meta> tags in JSX
    if (/<title\b[^>]*>([^<]+)<\/title>/i.test(code) || /<meta\b[^>]*>/i.test(code)) {
      transformations.push(
        "Observed <title>/<meta> tags for automatic document & Tauri window title sync",
      );
    }
  }

  return {
    code,
    modified: transformations.length > 0,
    transformations,
    warnings,
  };
}
