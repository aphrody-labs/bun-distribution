// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { startDesktopUiServer } from "./serve-desktop-ui.ts";

describe("serve-desktop-ui", () => {
  test("serves health, index, static assets, SPA fallback, and exploits native Bun capabilities", async () => {
    // Port 0 picks a dynamic available port
    const server = startDesktopUiServer({ port: 0, host: "127.0.0.1" });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      // 1. Health check
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.status).toBe("ok");
      expect(healthData.app).toBe("aphrody-app");
      expect(healthData.desktop).toBe("tauri-v3");
      expect(healthData.views).toContain("main");
      expect(healthData.areas).toContain("chat");
      expect(healthData.bun.features).toContain("wyhash-etags");
      expect(healthData.bun.features).toContain("websocket");

      // 2. Index HTML
      const indexRes = await fetch(`${baseUrl}/`);
      expect(indexRes.status).toBe(200);
      expect(indexRes.headers.get("content-type")).toContain("text/html");
      const htmlText = await indexRes.text();
      expect(htmlText).toContain("Aphrody OS");
      expect(htmlText).toContain('<div id="root"></div>');

      // 3. Static asset: app.css with ETag
      const cssRes = await fetch(`${baseUrl}/app.css`);
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get("content-type")).toContain("text/css");
      const etag = cssRes.headers.get("etag");
      expect(etag).toBeDefined();

      // 3b. Verify HTTP 304 Not Modified using Bun wyhash ETag
      if (etag) {
        const notModRes = await fetch(`${baseUrl}/app.css`, {
          headers: { "if-none-match": etag },
        });
        expect(notModRes.status).toBe(304);
      }

      // 3c. Verify Gzip compression via Bun.gzipSync
      const gzipRes = await fetch(`${baseUrl}/app.css`, {
        headers: { "accept-encoding": "gzip" },
      });
      expect(gzipRes.status).toBe(200);
      expect(gzipRes.headers.get("content-encoding")).toBe("gzip");

      // 4. SPA Fallback: /chat and /files
      const chatRes = await fetch(`${baseUrl}/chat`);
      expect(chatRes.status).toBe(200);
      expect(chatRes.headers.get("content-type")).toContain("text/html");
      const chatHtml = await chatRes.text();
      expect(chatHtml).toContain("Aphrody OS");

      // 5. Font asset
      const fontRes = await fetch(`${baseUrl}/fonts/GoogleSansFlex-latin.woff2`);
      expect(fontRes.status).toBe(200);
      expect(fontRes.headers.get("content-type")).toBe("font/woff2");

      // 6. Live i18n API
      const i18nInfoRes = await fetch(`${baseUrl}/api/i18n`);
      expect(i18nInfoRes.status).toBe(200);
      const i18nInfo = await i18nInfoRes.json();
      expect(i18nInfo.supportedLocales).toContain("en");
      expect(i18nInfo.supportedLocales).toContain("fr");

      const i18nEnRes = await fetch(`${baseUrl}/api/i18n/en`);
      expect(i18nEnRes.status).toBe(200);
      const enCatalog = await i18nEnRes.json();
      expect(enCatalog.common.save).toBe("Save");
      expect(enCatalog.subsystems.web).toBe("Web & Obscura Engine");
      expect(enCatalog.koharu.title).toBe("Koharu Document & Vision Engine");
      expect(enCatalog.shenron.title).toBe("Shenron Agent & DBFR Engine");

      const i18nFrRes = await fetch(`${baseUrl}/api/i18n/fr`);
      expect(i18nFrRes.status).toBe(200);
      const frCatalog = await i18nFrRes.json();
      expect(frCatalog.common.save).toBe("Enregistrer");
      expect(frCatalog.subsystems.web).toBe("Moteur Web & Obscura");
      expect(frCatalog.koharu.title).toBe("Moteur Document & Vision Koharu");
      expect(frCatalog.shenron.title).toBe("Moteur d'Agent Shenron & DBFR");

      // 7. Live Backend Capabilities reflection API
      const capRes = await fetch(`${baseUrl}/api/capabilities`);
      expect(capRes.status).toBe(200);
      const cap = await capRes.json();
      expect(cap.sourceOfTruth).toBe("backend-native");
      expect(cap.backend.kernel.subsystems).toContain("web");
      expect(cap.backend.kernel.subsystems).toContain("window");
      expect(cap.backend.kernel.subsystems).toContain("systemd");
      expect(cap.backend.drive.daemon).toBe("sd-daemon");
      expect(cap.backend.koharu.engine).toBe("deep-learning-ocr");
      expect(cap.backend.shenron.persona).toBe("shenron");
      expect(cap.backend.shell.engine).toBe("nushell");

      // 8. Live Material 3 tokens API
      const tokensRes = await fetch(`${baseUrl}/api/tokens`);
      expect(tokensRes.status).toBe(200);
      const tokens = await tokensRes.json();
      expect(tokens.colorRoles).toBe(36);
      expect(tokens.tonalPalettes).toBe(13);

      // 9. Live SQLite Cache stats API
      const cacheRes = await fetch(`${baseUrl}/api/cache/stats`);
      expect(cacheRes.status).toBe(200);
      const cacheData = await cacheRes.json();
      expect(typeof cacheData.totalEntries).toBe("number");

      // 10. Native WebSocket connection on /ws
      const wsUrl = `ws://127.0.0.1:${server.port}/ws`;
      const wsMessage = await new Promise<string>((resolveWs, rejectWs) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
          ws.close();
          rejectWs(new Error("WebSocket timeout"));
        }, 2000);

        ws.onmessage = (event) => {
          clearTimeout(timer);
          ws.close();
          resolveWs(String(event.data));
        };
        ws.onerror = (err) => {
          clearTimeout(timer);
          rejectWs(err);
        };
      });

      const parsedWs = JSON.parse(wsMessage);
      expect(parsedWs.type).toBe("ready");

      // 11. Transparent in-browser Tauri IPC Bridge injection in HTML
      expect(htmlText).toContain("aphrody-tauri-unified-bridge");
      expect(htmlText).toContain("window.__TAURI_INTERNALS__");
      expect(htmlText).toContain("window.__TAURI__");

      // 12. Transparent Tauri command dispatch: aphrody_meta
      const metaRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_meta" }),
      });
      expect(metaRes.status).toBe(200);
      const metaData = await metaRes.json();
      expect(metaData.app_version).toBe("1.0.0-canary");
      expect(metaData.mode).toBe("unified-tauri-web");
      expect(metaData.subsystems).toContain("systemd");
      expect(metaData.subsystems).toContain("web");

      // 13. Transparent Tauri command dispatch: aphrody_hardware_telemetry
      const telemRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_hardware_telemetry" }),
      });
      expect(telemRes.status).toBe(200);
      const telemData = await telemRes.json();
      expect(telemData.cpu.cores).toBeGreaterThan(0);
      expect(telemData.memory.total).toBeGreaterThan(0);
      expect(typeof telemData.platform).toBe("string");

      // 14. Transparent Tauri command dispatch: aphrody_model_catalog
      const modelsRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_model_catalog" }),
      });
      expect(modelsRes.status).toBe(200);
      const modelsData = await modelsRes.json();
      expect(Array.isArray(modelsData)).toBe(true);
      expect(modelsData.length).toBeGreaterThan(0);

      // 15. Unified applications registry API: /api/apps (active apps only, RG & Shenron quarantined)
      const appsRes = await fetch(`${baseUrl}/api/apps`);
      expect(appsRes.status).toBe(200);
      const appsData = await appsRes.json();
      expect(appsData.ecosystem).toBe("aphrody-unified-monorepo");
      const appIds = appsData.apps.map((a: any) => a.id);
      expect(appIds).toContain("aphrody-app");
      expect(appIds).toContain("koharu-editor");
      expect(appIds).toContain("cli");
      expect(appIds).toContain("m3-framework");
      // Shenron is quarantined pending production-readiness qualification
      expect(appIds).not.toContain("shenron-site");
      const quarantinedIds = appsData.quarantinedApps.map((a: any) => a.id);
      expect(quarantinedIds).toContain("shenron-site");

      // 16. M3 Window Controls & Chrome: aphrody_shell_window
      const winStateRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_shell_window", args: { action: "state" } }),
      });
      expect(winStateRes.status).toBe(200);
      const winState = (await winStateRes.json()) as any;
      expect(winState.closed).toBe(false);
      expect(winState.state.label).toBe("main");
      expect(winState.state.title).toBe("Aphrody OS");
      expect(winState.state.theme).toBe("dark");

      const themeRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "aphrody_shell_window",
          args: { action: "set_theme", theme: "light" },
        }),
      });
      expect(themeRes.status).toBe(200);
      const themeData = (await themeRes.json()) as any;
      expect(themeData.state.theme).toBe("light");

      // 17. Quickbar Spotlight Launcher: aphrody_quickbar
      const quickbarRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_quickbar", args: { action: "toggle" } }),
      });
      expect(quickbarRes.status).toBe(200);
      const quickbarData = (await quickbarRes.json()) as any;
      expect(quickbarData.success).toBe(true);

      // 18. Filesystem browsing: aphrody_fs_read_dir & aphrody_fs_read_text
      const fsDirRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_fs_read_dir", args: { path: "crates/ui/app" } }),
      });
      expect(fsDirRes.status).toBe(200);
      const fsDirData = (await fsDirRes.json()) as any;
      expect(fsDirData.entries.length).toBeGreaterThan(0);
      const fileNames = fsDirData.entries.map((e: any) => e.name);
      expect(fileNames).toContain("src");
      expect(fileNames).toContain("Cargo.toml");

      const fsTextRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "aphrody_fs_read_text",
          args: { path: "crates/ui/app/Cargo.toml" },
        }),
      });
      expect(fsTextRes.status).toBe(200);
      const fsTextData = (await fsTextRes.json()) as any;
      expect(fsTextData.content).toContain('name = "aphrody-app"');
      expect(fsTextData.size).toBeGreaterThan(0);

      // 19. Spacedrive Explorer integration: plugin:aphrody-drive|*
      const driveStatusRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "plugin:aphrody-drive|get_daemon_status" }),
      });
      expect(driveStatusRes.status).toBe(200);
      const driveStatus = (await driveStatusRes.json()) as any;
      expect(driveStatus.is_running).toBe(true);
      expect(driveStatus.socket_addr).toBe("127.0.0.1:4242");

      const driveReqRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "plugin:aphrody-drive|daemon_request",
          args: { request: { query: "volumes.list" } },
        }),
      });
      expect(driveReqRes.status).toBe(200);
      const driveReqData = (await driveReqRes.json()) as any;
      expect(driveReqData.result.volumes).toContain("local");
      expect(driveReqData.result.volumes).toContain("s3");

      // 20. Koharu OCR & Manga reading: koharu_rpc & aphrody_ocr
      const koharuRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "koharu_rpc", args: { method: "ping" } }),
      });
      expect(koharuRes.status).toBe(200);
      const koharuData = (await koharuRes.json()) as any;
      expect(koharuData.engine).toBe("deep-learning-ocr");

      const ocrRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_ocr", args: { image_b64: "" } }),
      });
      expect(ocrRes.status).toBe(200);
      const ocrData = (await ocrRes.json()) as any;
      expect(ocrData.confidence).toBeGreaterThan(0.9);

      // 21. Shenron Grounded Assistant runtime quarantine guard
      // By default (without APHRODY_SHENRON_PRODUCTION_READY=1), Shenron is quarantined out of UI/App
      const shenronGuardedRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_shenron_chat", args: { message: "Test query" } }),
      });
      expect(shenronGuardedRes.status).toBe(400);
      const shenronGuardedData = await shenronGuardedRes.json();
      expect(shenronGuardedData.error).toContain(
        "Shenron and RG are kept out of Aphrody UI and App",
      );

      // When production-ready qualification is explicitly enabled
      process.env.APHRODY_SHENRON_PRODUCTION_READY = "1";
      const shenronAllowedRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_shenron_chat", args: { message: "Test query" } }),
      });
      expect(shenronAllowedRes.status).toBe(200);
      const shenronAllowedData = (await shenronAllowedRes.json()) as any;
      expect(shenronAllowedData.source).toBe("dragonballfr.com");
      delete process.env.APHRODY_SHENRON_PRODUCTION_READY;

      // 22. Multi-window Pet & Widget surfaces
      const petRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_pet", args: { action: "status" } }),
      });
      expect(petRes.status).toBe(200);
      const petData = (await petRes.json()) as any;
      expect(petData.pet).toBe(true);

      const widgetRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_widget", args: { action: "status" } }),
      });
      expect(widgetRes.status).toBe(200);
      const widgetData = (await widgetRes.json()) as any;
      expect(widgetData.widget).toBe(true);

      // 23. App-Server JSON-RPC & Session Streaming
      const streamRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "aphrody_session_stream", args: { thread_id: "thread-123" } }),
      });
      expect(streamRes.status).toBe(200);
      const streamData = (await streamRes.json()) as any;
      expect(streamData.subscribed).toBe(true);
      expect(streamData.thread_id).toBe("thread-123");

      const unstreamRes = await fetch(`${baseUrl}/api/tauri/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "aphrody_session_unstream",
          args: { thread_id: "thread-123" },
        }),
      });
      expect(unstreamRes.status).toBe(200);
      const unstreamData = (await unstreamRes.json()) as any;
      expect(unstreamData.unsubscribed).toBe(true);

      // 24. Google Design & Real-Time M3 Showcase route
      const showcaseRes = await fetch(`${baseUrl}/m3`);
      expect(showcaseRes.status).toBe(200);
      expect(showcaseRes.headers.get("content-type")).toContain("text/html");
      const showcaseHtml = await showcaseRes.text();
      expect(showcaseHtml).toContain("Material Design 3 (M3)");
      expect(showcaseHtml).toContain("Google Design System");
      expect(showcaseHtml).toContain("Compilateur de Design IA M3");

      // Also accessible via /design and /google-design
      const designRes = await fetch(`${baseUrl}/design`);
      expect(designRes.status).toBe(200);

      // 25. Gemini Web M3 Real-Time Design Compiler endpoint
      const compileRes = await fetch(`${baseUrl}/api/m3/design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Modern analytical dashboard with deep blue cards and side drawer",
          seedColor: "#0288D1",
        }),
      });
      expect(compileRes.status).toBe(200);
      const compileData = await compileRes.json();
      expect(compileData.brief).toBeDefined();
      expect(compileData.brief.outputKind).toBe("dashboard");
      expect(compileData.brief.layoutType).toBe("feed");
      expect(compileData.files.length).toBeGreaterThan(0);
      expect(compileData.critique).toBeDefined();
    } finally {
      server.stop(true);
    }
  });
});
