// SPDX-License-Identifier: Apache-2.0
/** Native Bun + React app with the Next shims; the legacy vite target names the web host. */
import type { FileMap } from "../files.ts";
import { TAURI_3 } from "../pins.ts";
import { tauriShell, type TauriShellOptions } from "../tauri.ts";

export interface AppTemplateOptions {
  name: string;
  target?: "tauri" | "vite";
  modernizeM3?: boolean;
  appTsx?: string;
  /** Dependencies qualified by the private source owner before app creation. */
  dependencies?: Record<string, string>;
  /** Pure source planning for a separately registered canonical Rust shell owner. */
  tauri?: Partial<TauriShellOptions>;
}

const DEFAULT_APP = `// SPDX-License-Identifier: Apache-2.0
export default function App() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Aphrody M3 App</h1>
      <p className="mt-2 text-on-surface-variant">Migrated Next.js application</p>
    </main>
  );
}
`;

export function appFiles(options: AppTemplateOptions): FileMap {
  const { name, target = "tauri", modernizeM3 = false } = options;
  const tauri = target === "tauri";
  const pkg = {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      dev: "m3-bun dev",
      build: "m3-bun build",
      preview: "m3-bun serve",
      serve: "m3-bun serve",
      "dev:bun": "m3-bun dev",
      "start:bun": "m3-bun serve",
      typecheck: "tsc -p tsconfig.json --noEmit",
    },
    dependencies: {
      ...options.dependencies,
      react: "catalog:",
      "react-dom": "catalog:",
      "@aphrody/m3": "workspace:*",
      "@aphrody/m3-bun": "workspace:*",
      "@aphrody/m3-next-migrate": "workspace:*",
      ...(modernizeM3
        ? {
            "@aphrody/m3-primitives": "workspace:*",
            "@aphrody/m3-theme": "workspace:*",
            "@aphrody/m3-tokens": "workspace:*",
          }
        : {}),
      ...(tauri
        ? {
            "@aphrody/api": TAURI_3.jsApi,
            "@aphrody/plugin-opener": TAURI_3.jsPluginOpener,
          }
        : {}),
    },
    devDependencies: {
      "@types/bun": "catalog:",
      "@types/react": "catalog:",
      "@types/react-dom": "catalog:",
      "@aphrody/m3-config": "workspace:*",
      typescript: "catalog:",
      ...(tauri ? { "@tauri-apps/cli": TAURI_3.jsCli } : {}),
    },
    engines: { bun: ">=1.4.2" },
  };
  const main = `// SPDX-License-Identifier: Apache-2.0
import { createRoot } from 'react-dom/client';
import { NextMigrateProvider } from '@aphrody/m3-next-migrate/shims/provider';
import "m3:theme.css";
import "m3:fonts.css";
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <NextMigrateProvider mode="${target}"><App /></NextMigrateProvider>
);
`;
  const files: FileMap = {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "bunfig.toml": '[serve.static]\nplugins = ["@aphrody/m3/plugin"]\n',
    "m3.config.ts":
      'import { defineM3Config } from "@aphrody/m3/config";\nexport default defineM3Config({ entry: "src/index.html", port: 1420 });\n',
    "tsconfig.json":
      JSON.stringify(
        {
          extends: "@aphrody/m3-config/tsconfig.json",
          compilerOptions: { types: ["bun"] },
          include: ["src/**/*", "m3.config.ts"],
        },
        null,
        2,
      ) + "\n",
    "src/index.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
`,
    "src/main.tsx": main,
    "src/App.tsx": options.appTsx ?? DEFAULT_APP,
    ".gitignore": "node_modules/\ndist/\nbin/\n",
  };
  if (tauri) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    Object.assign(
      files,
      tauriShell({
        name,
        identifier: `com.aphrody.${slug}`,
        build: {
          beforeDevCommand: "bun run dev",
          devUrl: "http://localhost:1420",
          beforeBuildCommand: "bun run build",
          frontendDist: "../dist",
        },
        window: {
          mode: "config",
          title: name,
          width: 1200,
          height: 800,
          resizable: true,
        },
        withGlobalTauri: true,
        openerPlugin: true,
        serde: true,
        capabilitySchema: true,
        ...options.tauri,
      }),
    );
  }
  return files;
}
