// Banc B3, sondes de capacité P1 à P5 (PASS/FAIL, pas de vitesse), identiques sous Bun (JSC) et Deno (V8) autant que possible.
//   P1 limite de tas : émulation JS (Worker + sondage du RSS + terminate) ; pas un rappel de limite de tas
//   P2 arrêt d'un script : vm timeout sur une boucle infinie, puis réutilisation du contexte
//   P3 locale par défaut : lecture de l'environnement au démarrage et au runtime
//   P4 drapeaux moteur : BUN_JSC_useJIT=0 et option inconnue ; --v8-flags=--jitless et drapeau inconnu
//   P5 microtâches : vidage synchrone (bun:jsc.drainMicrotasks) ou vm microtaskMode afterEvaluate
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const isDeno = typeof Deno !== "undefined" && !!Deno.version;
const engine = isDeno
  ? `deno v8 ${Deno.version.v8}`
  : `bun webkit ${String(process.versions.webkit).slice(0, 12)}`;
const exe = isDeno ? Deno.execPath() : process.execPath;
const evalArgs = (code, extra = []) => (isDeno ? ["eval", ...extra, code] : [...extra, "-e", code]);
const envWith = (patch) => {
  const e = { ...process.env };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete e[k];
    else e[k] = v;
  }
  return e;
};
const run = (code, env = {}, extra = []) => {
  const r = spawnSync(exe, evalArgs(code, extra), {
    windowsHide: true,
    env: envWith(env),
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

// P2
{
  const ctx = vm.createContext({});
  const t0 = performance.now();
  let err;
  try {
    vm.runInContext("for(;;){}", ctx, { timeout: 200 });
  } catch (e) {
    err = e;
  }
  const elapsedMs = performance.now() - t0;
  let after;
  try {
    after = vm.runInContext("1+1", ctx);
  } catch (e) {
    after = "ERR " + String(e).slice(0, 80);
  }
  out.p.P2 = {
    timeoutMs: 200,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    errorCode: err?.code ?? String(err).slice(0, 80),
    contextReusableValue: after,
    pass: !!err && elapsedMs <= 400 && after === 2,
  };
}

// P5
{
  const r = {};
  try {
    const ctx = vm.createContext({}, { microtaskMode: "afterEvaluate" });
    vm.runInContext("var x = 0; Promise.resolve().then(() => { x = 1; }); 0", ctx);
    r.vmAfterEvaluateDrainsMicrotasks = vm.runInContext("x", ctx) === 1;
  } catch (e) {
    r.vmAfterEvaluateError = String(e).slice(0, 100);
  }
  if (!isDeno) {
    try {
      const jsc = await import("bun:jsc");
      let x = 0;
      Promise.resolve().then(() => {
        x = 1;
        return x;
      });
      jsc.drainMicrotasks();
      r.jscDrainMicrotasksSync = x === 1;
    } catch (e) {
      r.jscError = String(e).slice(0, 100);
    }
  }
  r.pass = r.jscDrainMicrotasksSync === true || r.vmAfterEvaluateDrainsMicrotasks === true;
  out.p.P5 = r;
}

// P3
{
  const probe =
    "console.log(new Intl.NumberFormat().resolvedOptions().locale + ' ' + new Intl.NumberFormat().format(1234567.891))";
  const atRuntime = "process.env.LC_ALL='ja_JP.UTF-8'; process.env.LANG='ja_JP.UTF-8'; " + probe;
  out.p.P3 = {
    default: run(probe).stdout,
    LC_ALL_fr_FR: run(probe, { LC_ALL: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8" }).stdout,
    LANG_de_DE: run(probe, { LC_ALL: null, LANGUAGE: null, LANG: "de_DE.UTF-8" }).stdout,
    envSetBeforeFirstIntlUse: run(atRuntime, { LC_ALL: null, LANGUAGE: null, LANG: "C" }).stdout,
    environment: {
      LANG: process.env.LANG ?? null,
      LC_ALL: process.env.LC_ALL ?? null,
      LANGUAGE: process.env.LANGUAGE ?? null,
    },
    note: "lecture de l'environnement seulement : aucun appel à WTF::overrideUserPreferredLanguages ni à icu::set_default_locale ne peut être fait depuis JS",
  };
}

// P4
{
  const loop = "let s=0; for (let i=0;i<30000000;i++) s=(s+i*i)%1000003; console.log(s)";
  const t = (env, extra) => {
    const a = performance.now();
    const r = run(loop, env, extra);
    return {
      ms: Number((performance.now() - a).toFixed(0)),
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  };
  out.p.P4 = isDeno
    ? {
        jit: t({}, []),
        jitless: t({}, ["--v8-flags=--jitless"]),
        unknownFlag: run("1", {}, ["--v8-flags=--no-such-flag-xyz"]),
      }
    : {
        jit: t({}, []),
        useJIT0: t({ BUN_JSC_useJIT: "0" }, []),
        unknownOption: run("console.log('ran')", { BUN_JSC_notAnOptionXyz: "1" }),
      };
}

// P1 : dans un processus enfant (voir b3-p1.mjs)
{
  const here = new URL("./b3-p1.mjs", import.meta.url).pathname;
  const r = spawnSync(exe, isDeno ? ["run", "--allow-all", here] : [here], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 90000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(String(r.stdout).trim().split("\n").at(-1)).p.P1;
  } catch {}
  out.p.P1 = parsed ?? {
    pass: false,
    crashed: true,
    status: r.status,
    signal: r.signal,
    stderr: String(r.stderr).trim().split("\n")[0].slice(0, 200),
  };
}
console.log(JSON.stringify(out));
process.exit(0);
