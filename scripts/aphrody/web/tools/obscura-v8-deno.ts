#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//! Showcase de V8 et de deno_core dans Obscura (locked Bun OS provider), entièrement calculé depuis le code :
//! versions épinglées, extension `obscura_dom` (ops #[op2] par thème, rapides ou asynchrones), API publique
//! d'ObscuraJsRuntime, snapshot V8, drapeaux V8, garde de tas, watchdog CDP et globals de bootstrap.js.
//! Puis exécution réelle : une page locale (Bun.serve, port 0) sollicite V8 et les ops Deno d'Obscura à travers
//! `aphrody web browser snapshot`, et renvoie ses résultats au serveur Bun. Aucun accès réseau externe.
//!
//!   bun scripts/tools/web/obscura-v8-deno.ts [--static | --live] [--json] [--bin <aphrody>]

import { resolve, join } from "node:path";
import { obscuraSourceRoot } from "./obscura-sources";

const REPO = resolve(import.meta.dir, "../../../../../../../aphrody");
const WEB = obscuraSourceRoot(REPO);
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const wantStatic = !args.includes("--live");
const wantLive = !args.includes("--static");
const color = (c: number) => (s: string) =>
  asJson || !Bun.enableANSIColors ? s : `\x1b[${c}m${s}\x1b[0m`;
const [green, red, yellow, dim, bold] = [color(32), color(31), color(33), color(2), color(1)];
const read = (p: string) => Bun.file(join(p.startsWith("obscura") ? WEB : REPO, p)).text();
const exists = (p: string) => Bun.file(join(REPO, p)).exists();

// ───────────────────────────── inventaire statique ─────────────────────────────

function lockVersions(lock: string, names: string[]) {
  const out: Record<string, string> = {};
  for (const m of lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g))
    if (names.includes(m[1]!) && !out[m[1]!]) out[m[1]!] = m[2]!;
  return out;
}

const THEMES: [string, RegExp][] = [
  ["DOM", /^op_(dom|script_|shadow_)/],
  ["CSS / CSSOM", /^op_(external_stylesheet|stylesheet|cssom|css_supports)/],
  ["Console et erreurs", /^op_(console|report_browser_exception|runtime_events)/],
  ["Réseau et cookies", /^op_(fetch|abort_signal|get_cookies|set_cookie)/],
  ["Navigation et historique", /^op_(navigate|session_history|history)/],
  [
    "Frames et realms",
    /^op_(frame|initial_frame|register_document_realm|document_realm|post_frame_message)/,
  ],
  ["Tâches et boucle", /^op_(sleep|async_runtime|posted_task|begin_render_task)/],
  ["CDP", /^op_binding_called/],
  ["WebCrypto", /^op_(subtle|random_bytes)/],
  ["URL, encodages, import map", /^op_(url|document_domain|encoding|text_decode|add_import_map)/],
  [
    "Rendu et layout (feature render)",
    /^op_(layout|canvas|image|load_image|computed_style|set_hovered|resize_observer|intersection_observer|element_scroll|scroll|waapi|set_dynamic_fonts)/,
  ],
];

type Op = {
  name: string;
  line: number;
  kind: "fast" | "nofast" | "slow";
  async: boolean;
  render: boolean;
};

function parseOps(src: string) {
  const lines = src.split("\n");
  const ops: Op[] = [];
  for (let i = 0; i < lines.length; i++) {
    const attr = lines[i]!.match(/^#\[op2(?:\((\w+)\))?\]/);
    if (!attr) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const f = lines[j]!.match(/^(?:pub(?:\(crate\))? )?(async )?fn (op_\w+)/);
      if (!f) continue;
      const before = lines.slice(Math.max(0, i - 3), i).join("\n");
      ops.push({
        name: f[2]!,
        line: j + 1,
        kind: attr[1] === "fast" ? "fast" : attr[1] === "nofast" ? "nofast" : "slow",
        async: Boolean(f[1]),
        render: before.includes('feature = "render"'),
      });
      break;
    }
  }
  const start = src.indexOf("pub fn build_extension");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const registered = new Set([...body.matchAll(/\b(op_\w+)\(\)/g)].map((m) => m[1]!));
  return { ops, registered, extensionLine: src.slice(0, start).split("\n").length };
}

const lineOf = (src: string, needle: string | RegExp) => {
  const lines = src.split("\n");
  const i = lines.findIndex((l) =>
    typeof needle === "string" ? l.includes(needle) : needle.test(l),
  );
  return i < 0 ? null : i + 1;
};

async function inventory() {
  const [lock, opsSrc, runtime, flags, watchdog, boot, build, cdpRuntime, jsToml] =
    await Promise.all([
      read("Cargo.lock"),
      read("obscura-js/src/ops.rs"),
      read("obscura-js/src/runtime.rs"),
      read("obscura-js/src/v8_flags.rs"),
      read("obscura-js/src/cdp_watchdog.rs"),
      read("obscura-js/js/bootstrap.js"),
      read("obscura-js/build.rs"),
      read("obscura-cdp/src/domains/runtime.rs"),
      read("obscura-js/Cargo.toml"),
    ]);
  const versions = lockVersions(lock, [
    "deno_core",
    "v8",
    "serde_v8",
    "deno_ops",
    "deno_error",
    "deno_unsync",
  ]);

  let deno: Record<string, unknown> = {
    fork: "absent (bun scripts/tools/vendor/fetch.ts fetch deno)",
  };
  if (await exists("vendor/deno/Cargo.lock")) {
    const [dlock, cli] = await Promise.all([
      read("vendor/deno/Cargo.lock"),
      read("vendor/deno/cli/Cargo.toml"),
    ]);
    const dv = lockVersions(dlock, ["deno_core", "v8", "deno_runtime"]);
    deno = {
      fork: "vendor/deno (aphrody-labs/deno)",
      version: cli.match(/^version = "([^"]+)"/m)?.[1],
      ...dv,
      sameDenoCore: dv.deno_core === versions.deno_core,
      sameV8: dv.v8 === versions.v8,
    };
  }

  const { ops, registered, extensionLine } = parseOps(opsSrc);
  const themes = THEMES.map(([theme, re]) => ({
    theme,
    ops: ops.filter((o) => re.test(o.name)),
  })).filter((t) => t.ops.length);
  const other = ops.filter((o) => !THEMES.some(([, re]) => re.test(o.name)));
  if (other.length) themes.push({ theme: "Autres", ops: other });

  const publicApi = [...runtime.matchAll(/^\s{4}pub (async )?fn (\w+)/gm)].map((m) => m[2]!);
  return {
    versions,
    deno,
    obscuraJsDeps: [...jsToml.matchAll(/^(deno_\w+)\s*=\s*(.+)$/gm)].map(
      (m) => `${m[1]} = ${m[2]!.trim()}`,
    ),
    extension: {
      file: `${join(WEB, "obscura-js/src/ops.rs")}:${extensionLine}`,
      declared: ops.length,
      registered: ops.filter((o) => registered.has(o.name)).length,
      notRegistered: ops.filter((o) => !registered.has(o.name)).map((o) => `${o.name}:${o.line}`),
      fast: ops.filter((o) => o.kind === "fast").length,
      nofast: ops.filter((o) => o.kind === "nofast").length,
      slow: ops.filter((o) => o.kind === "slow").length,
      async: ops.filter((o) => o.async).length,
      renderOnly: ops.filter((o) => o.render).length,
      themes: themes.map((t) => ({
        theme: t.theme,
        ops: t.ops.map((o) => `${o.name}${o.kind === "fast" ? "⚡" : ""}${o.async ? "⏳" : ""}`),
      })),
    },
    runtime: {
      lines: runtime.split("\n").length,
      publicApi,
      snapshot: `runtime.rs:${lineOf(runtime, 'include_bytes!(env!("OBSCURA_SNAPSHOT_PATH"))')} ← build.rs:${lineOf(build, "fn generate_host_snapshot") ?? lineOf(build, "create_snapshot")} (deno_core::snapshot::create_snapshot de bootstrap.js)`,
      jsRuntimeNew: `runtime.rs:${lineOf(runtime, /JsRuntime::new\(/)}`,
      isolateLock: `runtime.rs:${lineOf(runtime, "static ISOLATE_CREATE_LOCK")}`,
      heapGuard: `runtime.rs:${lineOf(runtime, "add_near_heap_limit_callback")}`,
      icuLocale: `runtime.rs:${lineOf(runtime, "set_default_locale")}`,
      opsHandoff: `runtime.rs:${lineOf(runtime, "fn take_ops_handoff")}`,
    },
    v8Flags: [...flags.matchAll(/^pub fn (\w+)/gm)].map((m) => m[1]!),
    watchdog: [...watchdog.matchAll(/^\s*pub fn (\w+)/gm)].map((m) => m[1]!),
    bootstrap: {
      lines: boot.split("\n").length,
      globals: new Set([...boot.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]!))
        .size,
      denoCoreCapture: `bootstrap.js:${lineOf(boot, "globalThis.Deno.core")}`,
      handoff: `bootstrap.js:${lineOf(boot, "globalThis.__obscura_core_handoff =")}`,
    },
    cdpRuntimeMethods: [...cdpRuntime.matchAll(/^\s*"([a-zA-Z]+)" =>/gm)].map(
      (m) => `Runtime.${m[1]}`,
    ),
    tests: Object.fromEntries(
      await Promise.all(
        ["obscura-js", "obscura", "obscura-browser", "obscura-cdp"].map(async (c) => [
          c,
          (
            await Array.fromAsync(new Bun.Glob("*.rs").scan({ cwd: join(WEB, c, "tests") })).catch(
              () => [],
            )
          ).length,
        ]),
      ),
    ),
  };
}

// ───────────────────────────── page exécutée par Obscura ─────────────────────────────

const WASM_ADD = [
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
];

async function pbkdf2Expected() {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("pw"),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode("sel"), iterations: 1000, hash: "SHA-256" },
    key,
    256,
  );
  return Buffer.from(bits).toString("hex");
}

const page = (pbkdf2: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>obscura-v8-deno</title>
<script type="importmap">{"imports":{"lib":"/lib.js"}}</script></head>
<body><pre id="out">[]</pre><div id="host"></div>
<iframe id="f" src="/frame.html"></iframe><x-early></x-early>
<script type="module">
const frameMessages = [];
addEventListener("message", e => { if (String(e.data).startsWith("frame:")) frameMessages.push(String(e.data)); });
const results = [];
const out = document.getElementById("out");
const assert = (c, m) => { if (!c) throw new Error("assertion : " + m); };
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("délai " + ms + " ms")), ms))]);
async function probe(name, via, fn, gap) {
  const t = performance.now();
  try {
    const detail = await timeout(Promise.resolve().then(fn), 4000);
    results.push({ name, via, gap, ok: true, ms: performance.now() - t, detail: String(detail).slice(0, 170) });
  } catch (e) {
    results.push({ name, via, gap, ok: false, ms: performance.now() - t, detail: String(e && e.message || e).slice(0, 170) });
  }
  out.textContent = JSON.stringify(results);
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();

// ── V8 ──
await probe("Deno et Deno.core invisibles pour la page", "runtime.rs take_ops_handoff · bootstrap.js", () => {
  assert(typeof Deno === "undefined", "Deno exposé");
  assert(typeof __obscura_core_handoff === "undefined" && typeof __obscuraCore === "undefined", "handoff exposé");
  const d = Object.getOwnPropertyDescriptor(globalThis, "__obscura_core_handoff");
  return "typeof Deno, __obscuraCore, __obscura_core_handoff = undefined · nom pré-réservé non énumérable : " + (d ? "oui" : "non");
});
await probe("Piles V8 et Error.captureStackTrace", "V8", () => {
  const o = {};
  Error.captureStackTrace(o);
  assert(typeof Error.stackTraceLimit === "number", "stackTraceLimit");
  const s = new Error("x").stack;
  assert(s.includes("    at "), "format de pile V8");
  return s.split("\\n")[1].trim();
});
await probe("ECMAScript de V8 15.0", "V8", async () => {
  const have = [];
  if (Iterator.from([1, 2, 3, 4]).filter(x => x % 2 === 0).toArray().join() === "2,4") have.push("Iterator helpers");
  if (new Set([1, 2]).union(new Set([3])).size === 3) have.push("Set.union");
  if (typeof RegExp.escape === "function" && new RegExp(RegExp.escape("a.b")).test("a.b") && !new RegExp(RegExp.escape("a.b")).test("axb")) have.push("RegExp.escape");
  if (typeof Promise.try === "function" && (await Promise.try(() => 3)) === 3) have.push("Promise.try");
  if (typeof Float16Array === "function" && new Float16Array([1.5])[0] === 1.5) have.push("Float16Array");
  if (typeof Math.sumPrecise === "function" && Math.sumPrecise([1e20, 0.1, -1e20]) === 0.1) have.push("Math.sumPrecise");
  if (typeof Error.isError === "function" && Error.isError(new Error())) have.push("Error.isError");
  if ((await Array.fromAsync((async function* () { yield 1; yield 2; })())).length === 2) have.push("Array.fromAsync");
  if (typeof Temporal === "object") have.push("Temporal");
  if (typeof Uint8Array.prototype.toBase64 === "function") have.push("Uint8Array.toBase64");
  assert(have.length >= 6, have.join());
  return have.join(", ");
});
await probe("using / Symbol.dispose (évalué à part)", "V8", () => {
  const log = new Function("log", "{ using a = { [Symbol.dispose]() { log.push('a'); } }; using b = { [Symbol.dispose]() { log.push('b'); } }; } return log;")([]);
  assert(log.join() === "b,a", log.join());
  return "libération LIFO : b puis a";
});
await probe("WebAssembly", "V8 (Liftoff puis TurboFan)", async () => {
  const { instance } = await WebAssembly.instantiate(new Uint8Array(${JSON.stringify(WASM_ADD)}));
  assert(instance.exports.add(40, 2) === 42, "add");
  return "add(40, 2) = 42";
});
await probe("ICU : locale par défaut forcée", "runtime.rs set_default_locale(\\"en-US\\")", () => {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const fr = new Intl.NumberFormat("fr-FR").format(1234567.8).replace(/\\s/g, " ");
  assert(fr === "1 234 567,8", fr);
  return "locale " + locale + " · fr-FR " + fr + " · " + navigator.language;
});
await probe("structuredClone (ValueSerializer V8)", "V8 · bootstrap.js", () => {
  const c = structuredClone({ m: new Map([[1, { d: new Date(0) }]]), r: /x/gi, b: new Uint8Array([1, 2]) });
  assert(c.m.get(1).d.getTime() === 0 && c.r.flags === "gi" && c.b[1] === 2, "clone");
  return "Map, Date, RegExp, Uint8Array clonés";
});
await probe("JIT : boucle chaude", "V8 (Ignition → Sparkplug → Maglev → TurboFan)", () => {
  const t = performance.now();
  let s = 0;
  for (let i = 0; i < 2e7; i++) s = (s + i * 3) | 0;
  return (performance.now() - t).toFixed(1) + " ms pour 2e7 itérations (s=" + s + ")";
});
await probe("SharedArrayBuffer / isolation", "V8", () => "SharedArrayBuffer " + typeof SharedArrayBuffer + " · crossOriginIsolated " + globalThis.crossOriginIsolated);

// ── ops Deno de l'extension obscura_dom ──
await probe("SHA-256 + HMAC", "op_subtle_digest · op_subtle_hmac", async () => {
  const d = hex(await crypto.subtle.digest("SHA-256", enc.encode("abc")));
  assert(d.startsWith("ba7816bf"), d);
  const key = await crypto.subtle.importKey("raw", enc.encode("k"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("m"));
  assert(await crypto.subtle.verify("HMAC", key, sig, enc.encode("m")), "verify");
  return "sha256(abc)=" + d.slice(0, 16) + "… · HMAC vérifié";
});
await probe("AES-GCM, AES-CBC, AES-CTR", "op_subtle_aes_gcm · op_subtle_aes_cbc · op_subtle_aes_ctr", async () => {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const modes = [["AES-GCM", { name: "AES-GCM", iv: iv.slice(0, 12) }], ["AES-CBC", { name: "AES-CBC", iv }], ["AES-CTR", { name: "AES-CTR", counter: iv, length: 64 }]];
  for (const [name, params] of modes) {
    const key = await crypto.subtle.importKey("raw", raw, name, false, ["encrypt", "decrypt"]);
    const ct = await crypto.subtle.encrypt(params, key, enc.encode("secret"));
    const pt = new TextDecoder().decode(await crypto.subtle.decrypt(params, key, ct));
    assert(pt === "secret", name);
  }
  return "3 modes, aller-retour exact";
});
await probe("PBKDF2 (vecteur calculé par Bun) + HKDF", "op_subtle_pbkdf2 · op_subtle_hkdf", async () => {
  const key = await crypto.subtle.importKey("raw", enc.encode("pw"), "PBKDF2", false, ["deriveBits"]);
  const bits = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode("sel"), iterations: 1000, hash: "SHA-256" }, key, 256));
  assert(bits === "${pbkdf2}", "PBKDF2 diffère de Bun : " + bits);
  const hk = await crypto.subtle.importKey("raw", enc.encode("ikm"), "HKDF", false, ["deriveBits"]);
  const h = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode("s"), info: enc.encode("i") }, hk, 128);
  return "PBKDF2 identique à Bun (" + bits.slice(0, 12) + "…) · HKDF " + h.byteLength + " o";
});
await probe("Aléa", "op_random_bytes", () => {
  const a = crypto.getRandomValues(new Uint32Array(4));
  assert(new Set(a).size > 1, "aléa");
  return crypto.randomUUID();
});
await probe("URL / URLSearchParams", "op_url_parse · op_url_resolve · op_url_encode_query", () => {
  assert(new URL("../a?b=1#h", "http://x.com/p/q").href === "http://x.com/a?b=1#h", "résolution");
  const sp = new URLSearchParams({ b: "é", a: "1" });
  sp.sort();
  return new URL("../a?b=1#h", "http://x.com/p/q").href + " · " + sp;
});
await probe("URLPattern", "bootstrap.js:16965", () => {
  const id = new URLPattern({ pathname: "/u/:id" }).exec("http://h/u/42")?.pathname.groups.id;
  assert(id === "42", "exec() → " + id);
  return "groupe id = " + id;
}, "bouchon : exec() renvoie toujours null");
await probe("TextDecoder multi-encodages", "op_encoding_for_label · op_text_decode", () => {
  const euro = new TextDecoder("windows-1252").decode(new Uint8Array([0x80]));
  const hi = new TextDecoder("utf-16le").decode(new Uint8Array([104, 0, 105, 0]));
  assert(euro === "€" && hi === "hi", euro + hi);
  return "windows-1252 0x80 → € · utf-16le → hi";
});
await probe("Timers et microtâches", "op_sleep (async)", async () => {
  const order = [];
  const t = performance.now();
  await new Promise(done => {
    setTimeout(() => { order.push("timeout"); done(); }, 20);
    Promise.resolve().then(() => order.push("promise"));
    queueMicrotask(() => order.push("micro"));
  });
  assert(order.join() === "promise,micro,timeout", order.join());
  return order.join(" > ") + " · " + (performance.now() - t).toFixed(1) + " ms pour setTimeout(20)";
});
await probe("fetch same-origin", "op_fetch_url · op_fetch_body", async () => {
  const r = await fetch("/data.json");
  const j = await r.json();
  assert(r.status === 200 && j.v === 7, "réponse");
  return r.status + " " + r.headers.get("content-type") + " · v=" + j.v;
});
await probe("AbortController sur fetch", "op_fetch_cancel_handle · op_abort_signal_state", async () => {
  const c = new AbortController();
  setTimeout(() => c.abort(), 50);
  try {
    await fetch("/slow", { signal: c.signal });
    throw new Error("non interrompu");
  } catch (e) {
    assert(e.name === "AbortError", e.name + " " + e.message);
    return "AbortError après 50 ms";
  }
}, "abort() pendant op_fetch_url : requête ni annulée ni rejetée (le signal dépendant ne suit pas sa source)");
await probe("XMLHttpRequest", "bootstrap.js XHR → op_fetch_url", () => new Promise((res, rej) => {
  const x = new XMLHttpRequest();
  x.open("GET", "/data.json");
  x.onload = () => (x.status === 200 && JSON.parse(x.responseText).v === 7 ? res("XHR " + x.status) : rej(new Error("XHR " + x.status)));
  x.onerror = () => rej(new Error("XHR erreur"));
  x.send();
}));
await probe("Cookies", "op_get_cookies · op_set_cookie", () => {
  document.cookie = "page=v8; Path=/";
  assert(document.cookie.includes("page=v8"), document.cookie);
  return document.cookie;
});
await probe("History API", "op_session_history", () => {
  history.pushState({ a: 1 }, "", "/etat");
  assert(location.pathname === "/etat" && history.state.a === 1, location.pathname);
  return "pathname " + location.pathname + " · length " + history.length;
});
await probe("DOM + MutationObserver", "op_dom", async () => {
  const host = document.getElementById("host");
  const seen = [];
  const mo = new MutationObserver(list => seen.push(...list.map(m => m.type)));
  mo.observe(host, { childList: true, attributes: true, subtree: true });
  for (let i = 0; i < 5; i++) {
    const li = document.createElement("li");
    li.className = "item";
    li.textContent = "n" + i;
    host.appendChild(li);
  }
  host.setAttribute("data-x", "1");
  await new Promise(r => setTimeout(r, 0));
  mo.disconnect();
  assert(document.querySelectorAll("#host li.item").length === 5, "querySelectorAll");
  return document.querySelectorAll("#host li.item").length + " éléments · mutations " + seen.join(",");
});
await probe("Shadow DOM", "op_shadow_attach · op_shadow_root_info", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = el.attachShadow({ mode: "open" });
  root.innerHTML = "<span class=s>ombre</span>";
  assert(el.shadowRoot === root && root.querySelector(".s").textContent === "ombre", "shadowRoot");
  return "shadowRoot ouvert, " + root.childNodes.length + " nœud";
});
await probe("Custom elements : mise à niveau à define", "bootstrap.js _upgradeElement", () => {
  let n = 0;
  customElements.define("x-early", class extends HTMLElement { connectedCallback() { n++; } });
  assert(n === 1 && document.querySelector("x-early") instanceof HTMLElement, "upgrade");
  return "<x-early> présent avant define : construit et connecté";
});
await probe("Custom elements : connectedCallback à l'insertion", "bootstrap.js CustomElementRegistry", async () => {
  let connected = false;
  customElements.define("x-late", class extends HTMLElement { connectedCallback() { connected = true; } });
  document.body.appendChild(document.createElement("x-late"));
  await new Promise(r => setTimeout(r, 0));
  assert(connected, "connectedCallback non appelé");
  return "connectedCallback appelé";
}, "insertion après define : aucune réaction connectedCallback");
await probe("DOMParser / XMLSerializer", "op_dom", () => {
  const d = new DOMParser().parseFromString("<p><b>x</b></p>", "text/html");
  assert(d.querySelector("b").textContent === "x", "parse");
  return new XMLSerializer().serializeToString(d.querySelector("p"));
});
await probe("CSSOM et style calculé", "op_cssom_* · op_computed_style · op_css_supports", () => {
  const style = document.createElement("style");
  style.textContent = ".rouge { color: rgb(255, 0, 0); }";
  document.head.appendChild(style);
  const el = document.createElement("span");
  el.className = "rouge";
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  return "feuilles " + document.styleSheets.length + " · color " + c + " · CSS.supports(grid) " + (globalThis.CSS?.supports?.("display", "grid") ?? "n/d");
});
await probe("Module ESM + import map", "module_loader.rs ObscuraModuleLoader · op_add_import_map", async () => {
  const m = await import("lib");
  assert(m.answer === 42 && m.default(1) === "lib:1", "module");
  return "import(\\"lib\\") → /lib.js · answer " + m.answer;
});
await probe("iframe : realm séparé", "frame.rs FrameRealm · op_register_document_realm · op_initial_frame", () => {
  const f = document.getElementById("f");
  assert(f.contentWindow && f.contentWindow.Array !== Array, "realm");
  assert(f.contentDocument.body.textContent.includes("cadre"), "document du cadre");
  return "contentWindow.Array ≠ Array · document du cadre chargé";
});
await probe("postMessage cadre → parent", "op_post_frame_message · __obscura_deliverMessage", async () => {
  for (let i = 0; i < 20 && !frameMessages.length; i++) await new Promise(r => setTimeout(r, 50));
  assert(frameMessages.length, "aucun message en 1 s");
  return frameMessages.join(", ");
}, "le script du cadre ne remet pas son message au parent");
await probe("Stockage", "bootstrap.js localStorage / sessionStorage", () => {
  localStorage.setItem("k", "v");
  sessionStorage.setItem("s", "w");
  assert(localStorage.getItem("k") === "v" && sessionStorage.getItem("s") === "w", "stockage");
  return "localStorage " + localStorage.length + " · sessionStorage " + sessionStorage.length;
});
await probe("requestAnimationFrame / requestIdleCallback", "op_begin_render_task · idle_deadline", async () => {
  const ts = await new Promise(r => requestAnimationFrame(r));
  const idle = await new Promise(r => (globalThis.requestIdleCallback ? requestIdleCallback(d => r(d.timeRemaining())) : r("absent")));
  return "rAF t=" + Number(ts).toFixed(1) + " · idle " + idle;
});
await probe("WebSocket vers Bun.serve", "bootstrap.js:16370", () => new Promise((res, rej) => {
  const ws = new WebSocket("ws://" + location.host + "/ws");
  ws.onopen = () => ws.send("ping");
  ws.onmessage = e => { ws.close(); res("écho " + e.data); };
  ws.onerror = () => rej(new Error("WebSocket"));
  setTimeout(() => rej(new Error("open simulé, aucun écho en 500 ms")), 500);
}), "bouchon : open simulé, send() ignoré, aucune socket réelle");
await probe("Blob / createObjectURL", "bootstrap.js __blobStore", async () => {
  const b = new Blob(["abc"], { type: "text/plain" });
  const url = URL.createObjectURL(b);
  assert((await b.text()) === "abc", "Blob.text");
  return url.slice(0, 24) + "… · " + b.size + " o";
});
await probe("console → CDP", "op_console_msg", () => {
  console.log("obscura-v8-deno: console.log depuis la page");
  return "message émis vers le domaine Runtime.consoleAPICalled";
});

out.textContent = JSON.stringify(results);
await fetch("/report", { method: "POST", body: JSON.stringify({ results, ua: navigator.userAgent }) });
</script></body></html>`;

async function live(bin: string) {
  const report = Promise.withResolvers<{ results: Probe[]; ua: string }>();
  const pbkdf2 = await pbkdf2Expected();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": () =>
        new Response(page(pbkdf2), { headers: { "content-type": "text/html; charset=utf-8" } }),
      "/etat": () =>
        new Response(page(pbkdf2), { headers: { "content-type": "text/html; charset=utf-8" } }),
      "/lib.js": () =>
        new Response(
          `export const answer = 42;\nexport default function hello(n) { return "lib:" + n; }\n`,
          {
            headers: { "content-type": "text/javascript" },
          },
        ),
      "/data.json": () =>
        Response.json({ v: 7, list: [1, 2, 3] }, { headers: { "set-cookie": "srv=bun; Path=/" } }),
      "/slow": async () => (await Bun.sleep(5000), new Response("trop tard")),
      "/frame.html": () =>
        new Response(
          `<!doctype html><html><body>cadre<script>parent.postMessage("frame:" + (1 + 1), "*")</script></body></html>`,
          {
            headers: { "content-type": "text/html" },
          },
        ),
      "/report": {
        POST: async (req) => {
          report.resolve(await req.json());
          return new Response("ok");
        },
      },
    },
    fetch(req, srv) {
      if (new URL(req.url).pathname === "/ws" && srv.upgrade(req)) return;
      return new Response("introuvable", { status: 404 });
    },
    websocket: {
      message: (ws, m) => {
        ws.send(m);
      },
    },
  });
  const version = Bun.spawnSync([bin, "--version"], { windowsHide: true }).stdout.toString().trim();
  const t0 = performance.now();
  const proc = Bun.spawn([bin, "web", "browser", "snapshot", server.url.href, "--json"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const snapshot = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([o, e, code]) => ({ o, e, code, ms: performance.now() - t0 }));
  const first = await Promise.race([
    report.promise.then((r) => ({ kind: "report" as const, r })),
    snapshot.then((s) => ({ kind: "snapshot" as const, s })),
  ]);
  let reportMs: number | null = null;
  let results: Probe[] = [];
  let ua = "";
  if (first.kind === "report") {
    reportMs = performance.now() - t0;
    ({ results, ua } = first.r);
  } else {
    const late = await Promise.race([report.promise, Bun.sleep(3000).then(() => null)]);
    if (late) ({ results, ua } = late);
  }
  const snap = await Promise.race([
    snapshot,
    Bun.sleep(30_000).then(() => (proc.kill(), snapshot)),
  ]);
  server.stop(true);
  if (!results.length) {
    // Pas de rapport POST : relire les résultats partiels écrits dans <pre id="out"> de l'instantané.
    try {
      const text = JSON.parse(snap.o).snapshot as string;
      const json = text.slice(text.indexOf("[{"), text.lastIndexOf("}]") + 2);
      results = JSON.parse(json);
    } catch {}
  }
  return {
    binary: bin,
    version,
    snapshotMs: snap.ms,
    reportMs,
    exitCode: snap.code,
    stderr: snap.e.trim().slice(-400),
    ua,
    results,
  };
}

type Probe = { name: string; via: string; ok: boolean; ms: number; detail: string; gap?: string };

// ───────────────────────────── sortie ─────────────────────────────

const bin =
  args[args.indexOf("--bin") + 1] && args.includes("--bin")
    ? args[args.indexOf("--bin") + 1]!
    : (Bun.which("aphrody") ?? join(REPO, "target/release/aphrody"));
const inv = wantStatic ? await inventory() : null;
const run = wantLive ? await live(bin) : null;

if (asJson) {
  console.log(JSON.stringify({ inventory: inv, live: run }, null, 2));
} else {
  if (inv) {
    console.log(bold("── V8 et deno_core dans Obscura : inventaire depuis le code ──"));
    console.log(
      `versions (Cargo.lock)   ${Object.entries(inv.versions)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ")}`,
    );
    console.log(
      `fork Deno               ${Object.entries(inv.deno)
        .map(([k, v]) => `${k}=${v}`)
        .join(" · ")}`,
    );
    console.log(`obscura-js              ${inv.obscuraJsDeps.join(" · ")}`);
    const e = inv.extension;
    console.log(
      `extension obscura_dom   ${e.file} : ${e.declared} #[op2] déclarées, ${e.registered} enregistrées, ${e.fast} rapides (fast API V8), ${e.nofast} nofast, ${e.slow} standard, ${e.async} asynchrones, ${e.renderOnly} sous feature render` +
        (e.notRegistered.length ? ` · non enregistrées : ${e.notRegistered.join(", ")}` : ""),
    );
    for (const t of e.themes) console.log(`  ${t.theme.padEnd(32)} ${dim(t.ops.join(" "))}`);
    console.log(
      dim(
        "  ⚡ = op rapide (appel direct depuis le JIT V8), ⏳ = op asynchrone (future Rust sur la boucle deno_core)",
      ),
    );
    const r = inv.runtime;
    console.log(
      `ObscuraJsRuntime        runtime.rs ${r.lines} lignes, ${r.publicApi.length} méthodes publiques : ${dim(r.publicApi.slice(0, 18).join(", "))}…`,
    );
    console.log(
      `  JsRuntime::new        ${r.jsRuntimeNew} · verrou de création d'isolat ${r.isolateLock} · locale ICU ${r.icuLocale}`,
    );
    console.log(`  snapshot V8           ${r.snapshot}`);
    console.log(
      `  garde de tas          ${r.heapGuard} (terminate_execution à l'approche de la limite)`,
    );
    console.log(
      `  passage des ops       ${r.opsHandoff} · ${inv.bootstrap.denoCoreCapture} · ${inv.bootstrap.handoff}`,
    );
    console.log(`drapeaux V8             v8_flags.rs : ${inv.v8Flags.join(", ")}`);
    console.log(`watchdog CDP            cdp_watchdog.rs : ${inv.watchdog.join(", ")}`);
    console.log(
      `bootstrap.js            ${inv.bootstrap.lines} lignes, ${inv.bootstrap.globals} globals posés (snapshotés au build)`,
    );
    console.log(`CDP Runtime → V8        ${inv.cdpRuntimeMethods.join(", ")}`);
    console.log(
      `tests                   ${Object.entries(inv.tests)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ")}`,
    );
  }
  if (run) {
    console.log(bold(`\n── Exécution réelle dans Obscura (${run.version}) ──`));
    for (const p of run.results) {
      const mark = p.ok ? green("✓") : p.gap ? yellow("⚠") : red("✗");
      const detail = p.ok
        ? dim(p.detail + (p.gap ? ` (écart résolu : ${p.gap})` : ""))
        : p.gap
          ? yellow(`écart connu : ${p.gap} — ${p.detail}`)
          : red(p.detail);
      console.log(
        `${mark} ${p.name} ${dim(`(${p.ms.toFixed(1)} ms)`)}\n    ${detail}\n    ${dim(p.via)}`,
      );
    }
    const ok = run.results.filter((p) => p.ok).length;
    const gaps = run.results.filter((p) => !p.ok && p.gap).length;
    const failed = run.results.filter((p) => !p.ok && !p.gap).length;
    console.log(
      `\n${failed === 0 && ok > 0 ? green("CAPACITÉS OK") : red(`${failed} ÉCHEC(S)`)} — ${ok}/${run.results.length} sondes, ${gaps} écart(s) connu(s) d'Obscura · ` +
        `instantané ${run.snapshotMs.toFixed(0)} ms (indicatif)${run.reportMs ? ` · rapport reçu à ${run.reportMs.toFixed(0)} ms` : " · rapport POST non reçu, résultats lus dans l'instantané"} · UA ${run.ua.slice(0, 40)}`,
    );
    if (run.exitCode !== 0)
      console.log(red(`aphrody web browser snapshot : code ${run.exitCode} ${run.stderr}`));
  }
}
process.exit(run && (run.results.length === 0 || run.results.some((p) => !p.ok && !p.gap)) ? 1 : 0);
