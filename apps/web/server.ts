#!/usr/bin/env bun
import { join } from 'node:path';
import { analyzeCodebase } from './src/core/codebase-scanner';
import { TEMPLATES } from './src/templates/templates-data';
import { DOCS_ARTICLES } from './src/docs/docs-data';
import { handleOsRequest } from './src/os/os-router';

const port = Number(process.env.PORT || 3000);
const startTime = Date.now();

console.log(`🌸 Starting Aphrody Unified Web Server on port ${port}...`);

// Simple in-memory room store for arcade multiplayer frames
const rooms = new Map<string, Set<any>>();

const server = Bun.serve({
  port,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Aphrody OS & Alpine Bun Backend Router
    const osResponse = await handleOsRequest(req, url);
    if (osResponse) {
      return osResponse;
    }

    // 1. Upgrade WebSockets for live telemetry and Arcade Multiplayer
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || 'default';
      if (server.upgrade(req, { data: { room, id: Math.random().toString(36).slice(2, 9) } })) {
        return;
      }
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // 2. Metrics & Scanner
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

    // 3. Native Bun API Runners
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

    // 4. Live Server Benchmark Execution
    if (url.pathname === '/api/benchmarks/run' && req.method === 'POST') {
      const results: any[] = [];

      // Test 1: Bun.Transpiler AST throughput
      const transpilerIters = 10000;
      const transpiler = new Bun.Transpiler({ loader: 'tsx' });
      const testJsx = 'export function Widget({ title }) { return <div className="card"><h1>{title}</h1></div>; }';
      const t0 = performance.now();
      for (let i = 0; i < transpilerIters; i++) {
        transpiler.transformSync(testJsx);
      }
      const t1 = performance.now();
      const transpilerDuration = t1 - t0;
      results.push({
        name: 'Bun.Transpiler (TSX AST)',
        iterations: transpilerIters,
        durationMs: Math.round(transpilerDuration),
        opsPerSec: Math.round((transpilerIters / transpilerDuration) * 1000),
        environment: 'Bun Server',
      });

      // Test 2: Bun.deflateSync SIMD throughput
      const deflateIters = 5000;
      const samplePayload = new TextEncoder().encode('Aphrody unified monorepo framework running with high-performance native Web APIs and Bun runtime.'.repeat(20));
      const t2 = performance.now();
      for (let i = 0; i < deflateIters; i++) {
        Bun.deflateSync(samplePayload);
      }
      const t3 = performance.now();
      const deflateDuration = t3 - t2;
      results.push({
        name: 'Bun.deflateSync (SIMD libdeflate)',
        iterations: deflateIters,
        durationMs: Math.round(deflateDuration),
        opsPerSec: Math.round((deflateIters / deflateDuration) * 1000),
        environment: 'Bun Server',
      });

      // Test 3: Bun.password.hash (Argon2id)
      const argonIters = 8;
      const t4 = performance.now();
      for (let i = 0; i < argonIters; i++) {
        await Bun.password.hash('aphrody-secret-key', { algorithm: 'argon2id' });
      }
      const t5 = performance.now();
      const argonDuration = t5 - t4;
      results.push({
        name: 'Bun.password.hash (Argon2id SIMD)',
        iterations: argonIters,
        durationMs: Math.round(argonDuration),
        opsPerSec: Math.round((argonIters / argonDuration) * 1000),
        environment: 'Bun Server',
      });

      return Response.json({ results });
    }

    // 5. Templates & Docs API
    if (url.pathname === '/api/templates') {
      return Response.json(TEMPLATES);
    }

    if (url.pathname === '/api/docs') {
      return Response.json(DOCS_ARTICLES);
    }

    // 6. Multi-Target Bridge Ping
    if (url.pathname === '/api/bridge/ping' && req.method === 'POST') {
      return Response.json({
        status: 'ok',
        platform: process.platform,
        runtime: 'Bun ' + Bun.version,
        timestamp: Date.now(),
        nanoseconds: Bun.nanoseconds().toString(),
      });
    }

    // 7. Static Assets in dist/
    if (url.pathname.startsWith('/dist/')) {
      const filePath = join(import.meta.dir, url.pathname);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    // 8. HTML Entrypoint with HTMLRewriter injection
    const htmlFile = Bun.file(join(import.meta.dir, 'index.html'));
    if (await htmlFile.exists()) {
      const rewriter = new HTMLRewriter()
        .on('head', {
          element(el) {
            el.append(`<meta name="generator" content="Bun ${Bun.version}">`, { html: true });
            el.append(`<meta name="server-time" content="${new Date().toISOString()}">`, { html: true });
          },
        });
      return rewriter.transform(new Response(htmlFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open(ws) {
      const { room, id } = ws.data as { room: string; id: string };
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room)!.add(ws);
      ws.send(JSON.stringify({ type: 'joined', player_id: id }));
    },
    message(ws, message) {
      const { room } = ws.data as { room: string };
      const peers = rooms.get(room);
      if (peers) {
        for (const peer of peers) {
          if (peer !== ws) peer.send(message);
        }
      }
    },
    close(ws) {
      const { room } = ws.data as { room: string };
      rooms.get(room)?.delete(ws);
    },
  },
});

console.log(`🚀 Aphrody Unified Web live at http://localhost:${server.port}`);
