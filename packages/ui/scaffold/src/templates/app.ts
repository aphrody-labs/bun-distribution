// SPDX-License-Identifier: Apache-2.0
/** Vite + React app with the Next.js shims, as a desktop (Tauri 3) or web (Vite) target. */
import type { FileMap } from "../files.ts";
import { TAURI_3 } from "../pins.ts";
import { tauriShell, type TauriShellOptions } from "../tauri.ts";

export interface AppTemplateOptions {
  name: string;
  target?: "tauri" | "vite";
  /** Depend on the authentic `@aphrody/m3-*` packages and import the M3 theme. */
  modernizeM3?: boolean;
  /** Replaces `src/App.tsx` (the migrated route tree). */
  appTsx?: string;
  /** Overrides for the Tauri shell (identifier, icon, window). */
  tauri?: Partial<TauriShellOptions>;
}

const DEFAULT_APP = `// SPDX-License-Identifier: Apache-2.0
import React from 'react';

export default function App() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Aphrody M3 App</h1>
      <p className="mt-2 text-on-surface-variant">Migrated Next.js 16 application</p>
    </div>
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
    scripts: tauri
      ? {
          dev: "vite",
          build: "vite build",
          "dev:bun": "bun run src/server.ts",
          "start:bun": "bun run src/server.ts",
          "tauri:dev": "tauri dev",
          "tauri:build": "tauri build",
        }
      : {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
          "dev:bun": "bun run src/server.ts",
          "start:bun": "bun run src/server.ts",
        },
    dependencies: {
      react: "^19.0.0",
      "react-dom": "^19.0.0",
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
            "@tauri-apps/api": TAURI_3.jsApi,
            "@tauri-apps/plugin-opener": TAURI_3.jsPluginOpener,
          }
        : {}),
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.0",
      typescript: "^5.6.0",
      vite: "^6.0.0",
      ...(tauri ? { "@tauri-apps/cli": TAURI_3.jsCli } : {}),
    },
    engines: { bun: ">=1.4.2" },
  };

  const viteConfig = `// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_', 'NEXT_PUBLIC_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
`;

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

  const m3CssImport = modernizeM3 ? `import '@aphrody/m3-theme/m3.css';\n` : "";
  const mainTsx = `// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { createRoot } from 'react-dom/client';
import { NextMigrateProvider } from '@aphrody/m3-next-migrate/shims/provider';
${m3CssImport}import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <NextMigrateProvider mode="${target}">
        <App />
      </NextMigrateProvider>
    </React.StrictMode>
  );
}
`;

  const serverTs = `// SPDX-License-Identifier: Apache-2.0
import { createNextBunServer } from '@aphrody/m3-next-migrate/shims/server';

const port = Number(process.env.PORT) || 1420;
const server = createNextBunServer({
  port,
  staticDir: './dist',
});

console.log(\`Aphrody Bun native desktop/web server running at http://localhost:\${server.port}\`);
`;

  const files: FileMap = {
    "package.json": JSON.stringify(pkg, null, 2),
    "vite.config.ts": viteConfig,
    "index.html": indexHtml,
    "src/main.tsx": mainTsx,
    "src/App.tsx": options.appTsx ?? DEFAULT_APP,
    "src/server.ts": serverTs,
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
        window: { mode: "config", title: name, width: 1200, height: 800, resizable: true },
        // Exposes `window.__TAURI__` (invoke, opener) to the migrated shims.
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
