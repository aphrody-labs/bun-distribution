// Banc B3, sonde P1 (processus à part : un abandon fatal de V8 ou de JSC doit être un résultat, pas la fin du banc).
import { spawnSync } from "node:child_process";

const isDeno = typeof Deno !== "undefined" && !!Deno.version;
const engine = isDeno
  ? `deno v8 ${Deno.version.v8}`
  : `bun webkit ${String(process.versions.webkit).slice(0, 12)}`;
const exe = isDeno ? Deno.execPath() : process.execPath;
const evalArgs = (code, extra = []) => (isDeno ? ["eval", ...extra, code] : [...extra, "-e", code]);
const run = (code, env = {}, extra = []) => {
  const r = spawnSync(exe, evalArgs(code, extra), {
    windowsHide: true,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60000,
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: String(r.stdout).trim().slice(0, 300),
    stderr: String(r.stderr).trim().split("\n")[0].slice(0, 200),
  };
};
const out = { engine, p: {} };
// P1 : émulation par Worker (aucun rappel de limite de tas n'existe sous JSC)
{
  const baseRss = process.memoryUsage().rss;
  const capMB = 300;
  const url = new URL("./b3-p1-worker.mjs", import.meta.url);
  const r = await new Promise((resolve) => {
    const w = new Worker(url, isDeno ? { type: "module" } : undefined);
    let detectedAt = 0;
    let peak = 0;
    let lastGrowthAt = 0;
    const started = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const rss = process.memoryUsage().rss;
      if (rss > peak) {
        peak = rss;
        lastGrowthAt = now;
      }
      if (!detectedAt && rss - baseRss > capMB * 2 ** 20) {
        detectedAt = now;
        w.terminate();
      }
      if (now - started > 20000) {
        clearInterval(timer);
        resolve({
          error: "timeout 20 s sans arrêt du Worker",
          peakOverBaseMB: Number(((peak - baseRss) / 2 ** 20).toFixed(0)),
        });
      } else if (detectedAt && rss - baseRss > 2 * 2 ** 30) {
        // garde-fou : l’arrêt demandé n’a pas stoppé la croissance, on sort avant d’épuiser l’hôte
        clearInterval(timer);
        console.log(
          JSON.stringify({
            engine,
            p: {
              P1: {
                pass: false,
                error: "dépassement de 2 Go après la demande d’arrêt",
                capMB,
                peakOverBaseMB: Number(((peak - baseRss) / 2 ** 20).toFixed(0)),
              },
            },
          }),
        );
        process.exit(2);
      } else if (detectedAt && now - detectedAt > 1500) {
        clearInterval(timer);
        resolve({
          capMB,
          detectMs: Number((detectedAt - started).toFixed(0)),
          growthStopsAfterTerminateMs: Number(Math.max(0, lastGrowthAt - detectedAt).toFixed(0)),
          peakOverBaseMB: Number(((peak - baseRss) / 2 ** 20).toFixed(0)),
          rssFinalOverBaseMB: Number(((rss - baseRss) / 2 ** 20).toFixed(0)),
        });
      }
    }, 5);
  });
  // le processus survit : un nouveau Worker évalue 1+1
  const next = await new Promise((resolve) => {
    const src = "postMessage(1+1)";
    const blob = new Blob([src], { type: "text/javascript" });
    const w2 = new Worker(URL.createObjectURL(blob), isDeno ? { type: "module" } : undefined);
    w2.addEventListener("message", (e) => resolve(e.data));
    setTimeout(() => resolve("timeout"), 5000);
  });
  out.p.P1 = {
    ...r,
    nextWorkerValue: next,
    pass: !r.error && r.peakOverBaseMB < 2 * capMB + 200 && next === 2,
    note: "émulation JS : sondage du RSS du processus et Worker.terminate ; le contexte terminé n'est pas réutilisable (Obscura V8 réutilise l'isolat après cancel_terminate_execution)",
  };
  if (isDeno) {
    const v8 = run("let a=[]; for(;;) { const c=[]; c.length=100000; a.push(c.fill(1)); }", {}, [
      "--v8-flags=--max-old-space-size=64",
    ]);
    out.p.P1.v8DefaultHeapLimit = {
      status: v8.status,
      signal: v8.signal,
      stderr: v8.stderr,
      note: "sans rappel installé, V8 abandonne le processus ; Obscura installe add_near_heap_limit_callback pour l'éviter",
    };
  }
}
console.log(JSON.stringify(out));
process.exit(0);
