// SPDX-License-Identifier: Apache-2.0
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateAppRouterCode, type RouteHierarchy } from "./layout";

export interface ScaffoldOptions {
  projectName?: string;
  target?: "tauri" | "vite";
  outDir: string;
  modernizeM3?: boolean;
  hierarchy?: RouteHierarchy;
}

export async function scaffoldTargetProject(options: ScaffoldOptions): Promise<void> {
  const { projectName = "migrated-app", target = "tauri", outDir, modernizeM3 = false, hierarchy } = options;

  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, "src"), { recursive: true });

  // 1. package.json
  const pkgJson = {
    name: projectName,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts:
      target === "tauri"
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
      ...(target === "tauri"
        ? {
            "@tauri-apps/api": "^2.0.0",
            "@tauri-apps/plugin-shell": "^2.0.0",
          }
        : {}),
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.0",
      typescript: "^5.6.0",
      vite: "^6.0.0",
      ...(target === "tauri"
        ? {
            "@tauri-apps/cli": "^2.0.0",
          }
        : {}),
    },
    engines: {
      bun: ">=1.4.2",
    },
  };

  await writeFile(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2));

  // 2. vite.config.ts
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
  await writeFile(join(outDir, "vite.config.ts"), viteConfig);

  // 3. index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
  await writeFile(join(outDir, "index.html"), indexHtml);

  // 4. src/main.tsx
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
  await writeFile(join(outDir, "src", "main.tsx"), mainTsx);

  // 5. src/App.tsx (with nested layouts & router hierarchy if hierarchy provided)
  const appTsx = hierarchy
    ? generateAppRouterCode(hierarchy, { modernizeM3, target })
    : `// SPDX-License-Identifier: Apache-2.0
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
  await writeFile(join(outDir, "src", "App.tsx"), appTsx);

  // 6. src/server.ts (native Bun.serve desktop runner)
  const bunServerTs = `// SPDX-License-Identifier: Apache-2.0
import { createNextBunServer } from '@aphrody/m3-next-migrate/shims/server';

const port = Number(process.env.PORT) || 1420;
const server = createNextBunServer({
  port,
  staticDir: './dist',
});

console.log(\`Aphrody Bun native desktop/web server running at http://localhost:\${server.port}\`);
`;
  await writeFile(join(outDir, "src", "server.ts"), bunServerTs);

  // 7. If target is Tauri, scaffold Tauri v2 configuration
  if (target === "tauri") {
    const tauriDir = join(outDir, "src-tauri");
    const tauriSrcDir = join(tauriDir, "src");
    const tauriCapDir = join(tauriDir, "capabilities");
    await mkdir(tauriSrcDir, { recursive: true });
    await mkdir(tauriCapDir, { recursive: true });

    // tauri.conf.json
    const tauriConf = {
      $schema: "https://schema.tauri.app/config/2",
      productName: projectName,
      version: "0.1.0",
      identifier: `com.aphrody.${projectName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      build: {
        beforeDevCommand: "bun run dev",
        devUrl: "http://localhost:1420",
        beforeBuildCommand: "bun run build",
        frontendDist: "../dist",
      },
      app: {
        windows: [
          {
            title: projectName,
            width: 1200,
            height: 800,
            resizable: true,
          },
        ],
        security: {
          csp: null,
        },
      },
      bundle: {
        active: true,
        targets: "all",
      },
      plugins: {},
    };
    await writeFile(join(tauriDir, "tauri.conf.json"), JSON.stringify(tauriConf, null, 2));

    // Cargo.toml
    const cargoToml = `[package]
name = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, "-")}"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = [] }
tauri-plugin-shell = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
`;
    await writeFile(join(tauriDir, "Cargo.toml"), cargoToml);

    // build.rs
    const buildRs = `fn main() {
    tauri_build::build()
}
`;
    await writeFile(join(tauriDir, "build.rs"), buildRs);

    // src/main.rs
    const mainRs = `// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;
    await writeFile(join(tauriSrcDir, "main.rs"), mainRs);

    // capabilities/default.json
    const capDefault = {
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "default",
      description: "Default capabilities for the desktop app",
      windows: ["main"],
      permissions: ["core:default", "shell:default", "shell:allow-open"],
    };
    await writeFile(join(tauriCapDir, "default.json"), JSON.stringify(capDefault, null, 2));
  }
}
