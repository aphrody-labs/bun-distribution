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
    } finally {
      server.stop(true);
    }
  });
});
