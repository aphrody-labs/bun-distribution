// Banc B3, mesures S3 et S4 : coût de création d'un realm et d'évaluation de bootstrap.js d'Obscura dans un contexte
// node:vm, identique sous Bun (JSC) et Deno (V8). Le dernier argument est un JSON {mode, src, cacheFile, warm, ctxN}.
//   mode "run"     : S3 (création de contextes vides), S4 à froid, puis S4 à chaud (même nom de fichier, puis noms uniques)
//   mode "produce" : évalue une fois puis écrit le cache de code (createCachedData) dans cacheFile
//   mode "consume" : S4 à froid avec le cache de code lu dans cacheFile (processus frais), puis à chaud
// Les ops de Deno.core sont simulés (retour undefined) ; createTimer et les trois rappels d'exception et de rejet sont des
// fonctions vides : bootstrap.js n'appelle que op_session_history et op_dom à son niveau racine.
import vm from "node:vm";
import { readFileSync, writeFileSync } from "node:fs";

const args = JSON.parse(process.argv.at(-1));
const { mode, src, cacheFile, warm = 10, ctxN = 100 } = args;
const isDeno = typeof Deno !== "undefined" && !!Deno.version;
const engine = isDeno
  ? `deno v8 ${Deno.version.v8}`
  : `bun webkit ${String(process.versions.webkit).slice(0, 12)}`;
const SRC = readFileSync(src, "utf8");
const now = () => performance.now();
const vmhwmMB = () => {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
    return m ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
};
const core = () => ({
  ops: new Proxy({}, { get: () => () => undefined }),
  createTimer: () => 1,
  cancelTimer() {},
  setReportExceptionCallback() {},
  setUnhandledPromiseRejectionHandler() {},
  setHandledPromiseRejectionHandler() {},
});
const median = (a) => {
  const s = a.toSorted((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

function evalOnce(filename, cachedData) {
  const t0 = now();
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  ctx.Deno = { core: core() };
  const t1 = now();
  const script = new vm.Script(SRC, cachedData ? { filename, cachedData } : { filename });
  const t2 = now();
  script.runInContext(ctx);
  const t3 = now();
  return {
    ctxMs: t1 - t0,
    compileMs: t2 - t1,
    runMs: t3 - t2,
    totalMs: t3 - t0,
    rejected: script.cachedDataRejected ?? null,
    script,
  };
}
const strip = ({ script: _s, ...r }) => r;
const out = { engine, mode, nodeCompat: isDeno ? "deno node:vm" : "bun node:vm" };

if (mode === "produce") {
  const first = evalOnce("bootstrap.js");
  const t = now();
  const data = first.script.createCachedData();
  out.createCachedDataMs = now() - t;
  writeFileSync(cacheFile, data);
  out.cacheBytes = data.length;
  out.first = strip(first);
} else {
  if (mode === "run") {
    const ctxMs = [];
    for (let i = 0; i < ctxN; i++) {
      const t = now();
      vm.createContext({});
      ctxMs.push(now() - t);
    }
    out.s3 = { n: ctxN, firstMs: ctxMs[0], medianMs: median(ctxMs), maxMs: Math.max(...ctxMs) };
  }
  let cached;
  if (mode === "consume") {
    const t = now();
    cached = readFileSync(cacheFile);
    out.cacheReadMs = now() - t;
  }
  out.cold = strip(evalOnce("bootstrap.js", cached));
  out.warmHit = Array.from({ length: warm }, () => strip(evalOnce("bootstrap.js", cached)));
  if (mode === "run")
    out.warmMiss = Array.from({ length: warm }, (_, i) =>
      strip(evalOnce(`bootstrap-unique-${i}.js`)),
    );
}
out.vmHWMMB = vmhwmMB();
console.log(JSON.stringify(out));
