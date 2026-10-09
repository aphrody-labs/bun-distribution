#!/usr/bin/env bun
import { join } from 'node:path';
import { analyzeCodebase } from './src/core/codebase-scanner';

const port = Number(process.env.PORT || 3000);
const startTime = Date.now();

console.log(`🌸 Starting Aphrody Web Server on port ${port}...`);

const server = Bun.serve({
  port,
  async fetch(req, server) {
    const url = new URL(req.url);

    // 1. Upgrade WebSockets
    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // 2. API Routes
    if (url.pathname === '/api/metrics') {
      const memory = process.memoryUsage();
      return Response.json({
        bunVersion: Bun.version,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        memoryUsageMb: memory.heapUsed / (1024 * 1024),
        timestampNs: Bun.nanoseconds().toString(),
        platform: process.platform,
        arch: process.arch,
        cpus: navigator.hardwareConcurrency || 8,
        targetEnvironment: 'web',
      });
    }

    if (url.pathname === '/api/codebase/scan') {
      const analysis = await analyzeCodebase();
      return Response.json(analysis);
    }

    if (url.pathname === '/api/transpile' && req.method === 'POST') {
      const body = await req.json();
      const transpiler = new Bun.Transpiler({ loader: body.loader || 'tsx' });
      const code = transpiler.transformSync(body.code || '');
      return Response.json({ code });
    }

    if (url.pathname === '/api/password/hash' && req.method === 'POST') {
      const body = await req.json();
      const algorithm = body.algorithm === 'bcrypt' ? 'bcrypt' : 'argon2id';
      const hash = await Bun.password.hash(body.password || '', { algorithm });
      return Response.json({ hash });
    }

    if (url.pathname === '/api/deflate' && req.method === 'POST') {
      const body = await req.json();
      const encoder = new TextEncoder();
      const raw = encoder.encode(body.text || '');
      const compressed = Bun.deflateSync(raw);
      const ratio = `${raw.byteLength} bytes -> ${compressed.byteLength} bytes (${((compressed.byteLength / raw.byteLength) * 100).toFixed(1)}%)`;
      return Response.json({ ratio, compressedSize: compressed.byteLength });
    }

    if (url.pathname === '/api/html-rewriter' && req.method === 'POST') {
      const body = await req.json();
      const rewriter = new HTMLRewriter()
        .on('h1', {
          element(el) {
            el.setAttribute('data-m3-heading', 'true');
            el.before('<span class="m3-badge">⚡ Bun HTMLRewriter</span> ', { html: true });
          },
        })
        .on('p', {
          element(el) {
            el.after('<footer class="m3-footer"><small>Rewritten at ' + new Date().toISOString() + '</small></footer>', { html: true });
          },
        });
      const rewritten = await rewriter.transform(new Response(body.html || '')).text();
      return Response.json({ rewritten });
    }

    if (url.pathname === '/api/bridge/ping' && req.method === 'POST') {
      return Response.json({
        status: 'ok',
        platform: process.platform,
        runtime: 'Bun ' + Bun.version,
        timestamp: Date.now(),
      });
    }

    // 3. Static Assets in dist/
    if (url.pathname.startsWith('/dist/')) {
      const filePath = join(import.meta.dir, url.pathname);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    // 4. HTML Entrypoint with HTMLRewriter injection
    const htmlFile = Bun.file(join(import.meta.dir, 'index.html'));
    if (await htmlFile.exists()) {
      const rewriter = new HTMLRewriter()
        .on('head', {
          element(el) {
            el.append(`<meta name="generator" content="Bun ${Bun.version}">`, { html: true });
            el.append(`<meta name="server-time" content="${new Date().toISOString()}">`, { html: true });
          }
        });
      return rewriter.transform(new Response(htmlFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    message(ws, message) {
      ws.send(JSON.stringify({ echo: message, timestamp: Date.now() }));
    },
  },
});

console.log(`🚀 Aphrody Web live at http://localhost:${server.port}`);
