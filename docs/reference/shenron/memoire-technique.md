# Shenron Monorepo — Learning Memory

## 1. Drizzle Schema Pushes with Custom Postgres Schemas

- **Issue:** In PostgreSQL, Drizzle Kit targets the `"public"` schema by default. When using custom schemas (e.g., `"bot"`), configuring `schemaFilter` in `drizzle.config.ts` causes Drizzle Kit to detect untracked tables created dynamically by the bot/sync scripts (such as `invites_log`, `jails`, `users`) and prompt to drop them, risking massive data loss.
- **Solution:** Avoid running `drizzle-kit push` on database environments with dynamic custom schemas unless the schemas are fully mapped. Instead, apply schema changes using raw SQL migration queries (e.g. `ALTER TABLE bot.db_movies ADD COLUMN IF NOT EXISTS ...`).

## 2. BXC Scraping under Cloudflare

- **Issue:** French manga scan portals (`lelscanfr.com`, `scan-vf.net`) block standard HTTP fetch requests with HTTP 403.
- **Solution:** Use Bxc's headless browser engine via `bxc recon <url> --profile static --json` to bypass Cloudflare and retrieve the structured image asset links.

## 3. Agent Browser Sandbox in Virtual Environments

- **Issue:** Running browser automation inside VM environments fails with Chrome FATAL zygote sandbox errors.
- **Solution:** Always invoke the browser using the `--args "--no-sandbox"` flag (e.g., `agent-browser open <url> --args "--no-sandbox"`) to ensure successful launches.

## 4. TypeScript Union Inference with fetch Headers

- **Issue:** When conditionally defining fetch headers as `ref ? { Referer: ref, Origin: new URL(ref).origin } : {}`, TypeScript infers the union type `{ Referer: string; Origin: string; } | { Referer?: undefined; Origin?: undefined; }`. When passed to `fetch(..., { headers })`, TS throws a TS2769 compilation error because the empty object structure fails index signature checks on `HeadersInit`.
- **Solution:** Explicitly type the headers dictionary as `Record<string, string>` (e.g. `const headers: Record<string, string> = {}` and conditionally populate it) to ensure clean compatibility with `HeadersInit`.

## 5. Bun Spawn Executable Path in systemd Services

- **Issue:** Spawning subprocesses via `Bun.spawn` with a raw executable name (e.g. `"bun"`) fails with `ENOENT` under systemd due to minimal `PATH` environments.
- **Solution:** Always use the absolute executable path (e.g. `$HOME/.bun/bin/bun`, or `process.execPath`) for Bun when spawning background tasks from the bot service or associated scripts (such as `resolve-streams.ts` or `server.ts`).

## 6. HLS Proxying for Progressive MP4 Sources

- **Issue:** When resolving streams dynamically, some players return progressive MP4 files instead of HLS playlists. Parsing these as text playlists (`up.text()`) causes server memory spikes/leaks, parsing failures, and broken video downloads.
- **Solution:** Intercept the stream type (`type === "mp4"`) before any text parsing occurs, and stream the response body directly to the client with appropriate headers (`video/mp4` and attachment disposition). Enhance the frontend player (using Hls.js) to fall back to native video element source loading if it encounters a fatal error during manifest parsing.

## 7. ESLint 9 Flat Config & FlatCompat under Bun

- **Issue:** Under ESLint 9 with Bun, using `@eslint/eslintrc` `FlatCompat` to wrap legacy configurations (like `eslint-config-next`) fails with a cryptic `TypeError: JSON.stringify cannot serialize cyclic structures` when any validation error occurs (such as using `basePath` instead of `baseDirectory`).
- **Solution:** Migrate to a native ESLint 9 Flat Config array format. For Next.js projects, import and spread `eslint-config-next` directly (e.g., `...nextConfig`) as it natively supports Flat Config format, and override rules in a subsequent flat config block.

## 8. Missing `tsup` Monorepo Dependencies on Remote Environments

- **Issue:** Internal package directories inside a Turborepo monorepo can use build tools (like `tsup`) that are expected to be available globally or via the root workspace. If missing from the root `devDependencies` or the Bun dependencies catalog, remote build environments (like Vercel or compilation containers) will fail with `command not found: tsup` errors during `turbo run build`.
- **Solution:** Explicitly define and pin `tsup` in the root workspace `devDependencies` or monorepo dependency catalog to ensure availability during remote Turbo builds.

## 9. Systemd Protected Namespaces and Directory Initialization

- **Issue:** Systemd services configured with namespace directories or sandboxing parameters (e.g., `ReadWritePaths=` or `ProtectSystem=`) will crash with a `226/NAMESPACE` startup error if any of the target directories inside the sandbox (such as a local `.bun-cache` folder inside the workspace) do not exist on the filesystem.
- **Solution:** Ensure that all directories mapped in systemd configuration files (or folders where runtime engines automatically cache outputs) are pre-initialized during installation/deployment scripts (e.g. `mkdir -p apps/bot/.bun-cache`).

## 10. Bun Bundler Asset Resolution in HTML Templates

- **Issue:** Bun allows importing `.html` files directly in TypeScript, which triggers automatic bundling of all referenced assets in the HTML file. However, if a previous build step modified the HTML template to point to dynamic/hashed output assets (e.g., `<link href="./bot/dashboard-vdfat6mt.css">`), subsequent compilation attempts fail with `Could not resolve` errors.
- **Solution:** Maintain the HTML template with references only to original source asset files (`./src/dashboard/styles.compiled.css`) and restore it (e.g., via `git checkout`) before running compiler/bundler commands.

## 11. BXC Dragon Ball — reprise et files persistantes

- **Référence complète :** le relevé de crawl du 2026-09-14 n'est pas versionné dans ce checkout.
- **État vérifié le 2026-09-15 :** 3 311 pages officielles persistées, 116 URLs en attente, 0 retry et 0 dead-letter.
- **Reprise :** contrôler l’espace disque avant `bxc crawl-worker`, puis reprendre la file SQLite existante ; ne jamais recréer une file avec les URLs déjà terminées.
- **Profil :** `fast` est le profil de production mesuré ; `stealth` et `max` restent les replis navigateur. Le profil `http` (curl-impersonate) a été exposé au CLI et testé séparément.
- **Concurrence :** utiliser `--min-concurrency`, `--max-concurrency` et `--max-retries` ; réduire la taille des lots lorsque le cache headless remplit le disque.
- **Filtrage :** exclure images, CSS, JavaScript et fichiers binaires des files éditoriales. Les URLs d’images validées peuvent rester dans les métadonnées des pages.
