#!/usr/bin/env bun
// Fact-checks the V8 (Obscura) <-> JSC (Bun) equivalence capability by capability against the exact
// revisions in use: the V8 symbols Obscura calls, the JSC/WTF headers of the WebKit prebuilt that Bun
// links (read on the VPS build cache, WEBKIT_VERSION pin) and the symbols the Bun fork already uses.
// Every probe is a fixed-string ripgrep; a capability is `covered` only when the V8 usage, a JSC header
// symbol and a Bun source symbol are all found (`jsc-only`: declared by JSC but unused by the Bun fork, so
// the embedder must call it; `bun-only`: only Bun's own V8 shim mentions it; `gap`: neither).
// ADJACENT lists near-misses that are not equivalents; MITIGATIONS lists building blocks (existence only).
//   bun scripts/audit/engine-equivalence.ts [--write]
import { $ } from "bun";
import { join, posix } from "node:path";
import { checkoutRoot } from "@aphrody/paths";
import { obscuraSourceRoot } from "../web/tools/obscura-sources.ts";

const ROOT = join(import.meta.dir, "../../../");
const BUN_CHECKOUT = checkoutRoot("bun");
const BUN_SRC = join(BUN_CHECKOUT, "src");
const OBSCURA_ROOT = obscuraSourceRoot(ROOT);
const OBSCURA = join(OBSCURA_ROOT, "obscura-js/src");
const OBSCURA_JS = join(OBSCURA_ROOT, "obscura-js/js");
const WEBKIT_PREBUILT = process.env.APHRODY_WEBKIT_INCLUDE;
if (!WEBKIT_PREBUILT)
  throw new Error("Set APHRODY_WEBKIT_INCLUDE to the qualified build host's WebKit include directory");
const VPS_JSC = [posix.join(WEBKIT_PREBUILT, "JavaScriptCore"), posix.join(WEBKIT_PREBUILT, "wtf")];

interface Capability {
  id: string;
  name: string;
  v8: string[];
  jsc: string[];
  bun: string[];
  note: string;
  /** Where the "v8" probes are searched: the Rust sources (default) or bootstrap.js (non-op Deno.core APIs). */
  v8Where?: Where;
}

const CAPABILITIES: Capability[] = [
  {
    id: "snapshot",
    name: "Startup snapshot of bootstrap.js",
    v8: ["create_snapshot", "startup_snapshot"],
    jsc: ["StartupSnapshot", "SnapshotCreator"],
    bun: ["StartupSnapshot", "SnapshotCreator"],
    note: "JSC exposes no startup-snapshot API: bootstrap.js is evaluated at start-up, the bytecode cache is the mitigation.",
  },
  {
    id: "contexts",
    name: "Several global contexts in one VM (frame realms)",
    v8: ["Context::from_snapshot", "ContextScope::new"],
    jsc: ["JSGlobalContextCreateInGroup", "JSContextGroupCreate"],
    bun: ["JSGlobalContextCreateInGroup", "JSContextGroupCreate", "createGlobalObject"],
    note: "A JSContextGroup holds several global contexts: compatible with frame realms.",
  },
  {
    id: "code-cache",
    name: "Compiled-code cache",
    v8: ["CachedData", "ConsumeCodeCache"],
    jsc: ["CachedBytecode", "generateCachedBytecode"],
    bun: ["CachedBytecode", "generateCachedModuleByteCodeFromSourceCode"],
    note: "Bun already ships a bytecode cache over CachedBytecode.",
  },
  {
    id: "heap-limit",
    name: "Near-heap-limit callback and heap statistics",
    v8: ["add_near_heap_limit_callback", "get_heap_statistics"],
    jsc: ["setHeapSizeLimit", "NearHeapLimit", "heapSizeLimit"],
    bun: ["setHeapSizeLimit", "NearHeapLimit", "heapSizeLimit"],
    note: "No JSC header declares a heap limit hook; Bun's V8 shim stores the callback but never fires it. Needs a memory-cost poll or a WebKit patch.",
  },
  {
    id: "terminate",
    name: "Terminate a running script (watchdog)",
    v8: ["terminate_execution", "thread_safe_handle"],
    jsc: ["notifyNeedTermination", "JSContextGroupSetExecutionTimeLimit"],
    bun: ["notifyNeedTermination", "TerminationException"],
    note: "VM::notifyNeedTermination is the JSC counterpart of IsolateHandle::terminate_execution.",
  },
  {
    id: "flags",
    name: "Engine flags",
    v8: ["set_flags_from_string", "set_v8_flags"],
    jsc: ["Options::setOption", "Options::initialize"],
    bun: ["BUN_JSC_", "Options::setOption"],
    note: "V8 flag strings do not map one to one: translate or drop.",
  },
  {
    id: "locale",
    name: "Process default ICU locale",
    v8: ["set_default_locale"],
    jsc: ["overrideUserPreferredLanguages", "defaultLanguage"],
    // `defaultLanguage` only appears in Bun as `nullptr, // defaultLanguage` method-table slots: it is not a usage.
    bun: ["overrideUserPreferredLanguages"],
    note: "WTF::overrideUserPreferredLanguages is declared and exported by WTF but no Bun source calls it: the embedder (realm host) must call it. bun:jsc.setTimeZone sets the time zone, not the locale.",
  },
  {
    id: "modules",
    name: "ES module loader and evaluation",
    v8: ["load_side_es_module", "mod_evaluate"],
    jsc: ["JSModuleLoader", "moduleLoaderResolve"],
    bun: ["JSModuleLoader", "moduleLoaderResolve"],
    note: "Bun owns its module loader hooks (resolve, fetch, evaluate).",
  },
  {
    id: "host-functions",
    name: "Host functions (ops) callable from JS",
    v8: ["#[op2"],
    jsc: ["JSObjectMakeFunctionWithCallback", "JSC_DEFINE_HOST_FUNCTION"],
    bun: ["JSC_DEFINE_HOST_FUNCTION", "JSHostFn"],
    note: "The 74 synchronous ops map to host functions; there is no async op to port.",
  },
  {
    id: "microtasks",
    name: "Microtask queue draining",
    v8: ["perform_microtask_checkpoint", "poll_event_loop"],
    jsc: ["drainMicrotasks", "MicrotaskQueue"],
    bun: ["drainMicrotasks", "runMicrotasks"],
    note: "The event loop becomes Bun's instead of deno_core plus tokio.",
  },
  {
    id: "exceptions",
    name: "Exceptions and try/catch scopes",
    v8: ["TryCatch", "tc_scope"],
    jsc: ["ThrowScope", "CatchScope"],
    bun: ["ThrowScope", "CatchScope"],
    note: "JSC::ThrowScope and CatchScope replace v8::TryCatch.",
  },
  {
    id: "timers",
    name: "Timer queue driven by the host event loop (Deno.core.createTimer and cancelTimer)",
    v8: ["createTimer", "cancelTimer"],
    v8Where: "obscura-js",
    jsc: [],
    bun: ["EventLoopTimer"],
    note: "Not a V8 API: bootstrap.js calls deno_core's timer queue (a refed timer keeps the event loop alive). JSC has no timer API; Bun's EventLoopTimer is the embedder-side counterpart the realm host must expose.",
  },
  {
    id: "rejections",
    name: "Unhandled and handled promise-rejection hooks and the uncaught-exception reporter",
    v8: ["setUnhandledPromiseRejectionHandler", "setHandledPromiseRejectionHandler", "setReportExceptionCallback"],
    v8Where: "obscura-js",
    jsc: ["promiseRejectionTracker", "reportUncaughtExceptionAtEventLoop"],
    bun: ["promiseRejectionTracker", "reportUncaughtExceptionAtEventLoop"],
    note: "bootstrap.js installs three deno_core callbacks. JSGlobalObjectMethodTable has promiseRejectionTracker and reportUncaughtExceptionAtEventLoop, which Bun already implements.",
  },
];

// Near-misses: symbols that exist but are NOT an equivalent (kept out of the status logic on purpose).
const ADJACENT: Record<string, { jsc?: string[]; bun?: string[]; why: string }> = {
  "heap-limit": {
    jsc: ["gcMaxHeapSize", "forceRAMSize", "maxHeapSizeAsRAMSizeMultiple"],
    why: "At the WebKit pin 5718a6ec, Heap.cpp uses Options::gcMaxHeapSize as a GC-request threshold on bytes allocated in the cycle: it bounds garbage, not live memory, and has no callback or termination.",
  },
  locale: {
    jsc: ["setTimeZoneOverride"],
    bun: ["setTimeZone"],
    why: "bun:jsc.setTimeZone calls WTF::setTimeZoneOverride: a time-zone override, not the default locale.",
  },
};

// Mitigations: presence of building blocks for a gap or for a partial equivalent (existence only, behaviour untested).
const MITIGATIONS: {
  id: string;
  name: string;
  jsc: string[];
  bun: string[];
  note: string;
}[] = [
  {
    id: "heap-limit",
    name: "Poll the heap from the host, then terminate",
    jsc: ["JSGetMemoryUsageStatistics", "extraMemorySize", "notifyNeedTermination"],
    bun: ["percentAvailableMemoryInUse", "functionMemoryUsageStatistics", "functionCreateMemoryFootprint"],
    note: "bun:jsc exports heapStats, memoryUsage and percentAvailableMemoryInUse; the host would poll and call the termination path. Existence only: probe P1 of docs/plans/fusion/bench/METHOD.md must exercise it.",
  },
  {
    id: "contexts",
    name: "Frame realms through ShadowRealm or node:vm contexts",
    jsc: ["ShadowRealmObject", "useShadowRealm"],
    bun: ["ShadowRealm", "NodeVMGlobalObject"],
    note: "Alternatives to JSContextGroup/JSGlobalContextCreateInGroup for one realm per frame.",
  },
  {
    id: "code-cache",
    name: "Bytecode cache reachable from JS (node:vm cachedData)",
    jsc: ["CachedBytecode"],
    bun: ["produceCachedData", "cachedData"],
    note: "Enables the one-hour node:vm trial of decision 14 before any Rust port.",
  },
  {
    id: "flags",
    name: "JSC options settable by environment",
    jsc: ["useJIT", "Options::useJIT"],
    bun: ["BUN_JSC_", "Options::setOption"],
    note: "BUN_JSC_<option> sets a JSC option; useJIT=0 gives the interpreter-only lane required by METHOD C5.",
  },
];

type Where = "obscura" | "obscura-js" | "jsc" | "bun" | "shim";

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function hits(symbol: string, where: Where): Promise<number> {
  const dir =
    where === "obscura"
      ? OBSCURA
      : where === "obscura-js"
        ? OBSCURA_JS
        : where === "bun"
          ? BUN_SRC
          : where === "shim"
            ? join(BUN_SRC, "jsc/bindings/v8")
            : VPS_JSC.map(shellQuote).join(" ");
  const out =
    where === "jsc"
      ? await $`aphrody infra ssh exec --host vps ${`rg -F -c --no-messages -e ${shellQuote(symbol)} ${dir}`}`
          .nothrow()
          .quiet()
          .text()
      : await $`rg -F -c --no-messages -e ${symbol} ${dir}`.nothrow().quiet().text();
  let total = 0;
  for (const line of out.split("\n")) {
    const m = line.trim().match(/:(\d+)$/);
    if (m) total += Number(m[1]);
  }
  return total;
}

const symbols = async (list: string[], where: Where) =>
  Object.fromEntries(await Promise.all(list.map(async s => [s, await hits(s, where)] as const)));
const found = (r: Record<string, number>) => Object.values(r).some(n => n > 0);

const receipt = await Promise.all(
  CAPABILITIES.map(async c => {
    const [v8, jsc, bun] = await Promise.all([
      symbols(c.v8, c.v8Where ?? "obscura"),
      symbols(c.jsc, "jsc"),
      symbols(c.bun, "bun"),
    ]);
    const status = !found(v8)
      ? "v8-unused"
      : found(jsc) && found(bun)
        ? "covered"
        : found(jsc)
          ? "jsc-only"
          : found(bun)
            ? "bun-only"
            : "gap";
    const adj = ADJACENT[c.id];
    const adjacent = adj
      ? {
          why: adj.why,
          jsc: adj.jsc ? await symbols(adj.jsc, "jsc") : undefined,
          bun: adj.bun ? await symbols(adj.bun, "bun") : undefined,
        }
      : undefined;
    return {
      id: c.id,
      name: c.name,
      status,
      note: c.note,
      v8,
      jsc,
      bun,
      adjacent,
    };
  }),
);
for (const r of receipt)
  console.log(r.status.padEnd(9), r.id.padEnd(15), JSON.stringify({ v8: r.v8, jsc: r.jsc, bun: r.bun }));

const mitigations = await Promise.all(
  MITIGATIONS.map(async m => {
    const [jsc, bun] = await Promise.all([symbols(m.jsc, "jsc"), symbols(m.bun, "bun")]);
    return {
      id: m.id,
      name: m.name,
      status: found(jsc) && found(bun) ? "available" : "incomplete",
      note: m.note,
      jsc,
      bun,
    };
  }),
);
for (const m of mitigations)
  console.log(m.status.padEnd(9), `${m.id}/mitigation`.padEnd(15), JSON.stringify({ jsc: m.jsc, bun: m.bun }));
for (const r of receipt)
  if (r.adjacent)
    console.log("adjacent ".padEnd(9), r.id.padEnd(15), JSON.stringify({ jsc: r.adjacent.jsc, bun: r.adjacent.bun }));

// Bun also ships a V8 C++ API shim over JSC (node-addon compatibility). rusty_v8 links the real V8, so the
// shim cannot run Obscura's engine layer; it is probed to record which Obscura-used V8 C++ calls it implements.
const shim = await symbols(
  [
    "Isolate::TerminateExecution",
    "Context::New",
    "ScriptCompiler::CachedData",
    "SnapshotCreator",
    "TryCatch::TryCatch",
    "Isolate::GetHeapStatistics",
    "V8::SetFlagsFromString",
    "Isolate::AddNearHeapLimitCallback",
    "FunctionTemplate::New",
    "HandleScope::HandleScope",
  ],
  "shim",
);
console.log("bun v8 shim", JSON.stringify(shim));

if (process.argv.includes("--write")) {
  const pins = {
    webkit: "5718a6ec579b98362ea7276a426deedcc6281ef5",
    bunFork: (await $`git -C ${BUN_CHECKOUT} rev-parse HEAD`.text()).trim(),
    rustyV8: "v8 crate 150.4.0 (denoland/rusty_v8 tag v150.4.0, 5c15a6995c9bb4bacd3e341b59fff32c909c80bf)",
    forks: ["aphrody-labs/WebKit@bun-pin", "aphrody-labs/rusty_v8@obscura-pin-v150.4.0"],
  };
  const bunV8Shim = {
    path: "src/jsc/bindings/v8",
    note: "Isolate::AddNearHeapLimitCallback is stored but never fired (JSC has no near-heap-limit hook)",
    calls: shim,
  };
  await Bun.write(
    join(ROOT, "docs/plans/fusion/engine-equivalence-2026-10-05.json"),
    JSON.stringify({ pins, capabilities: receipt, mitigations, bunV8Shim }, null, 2) + "\n",
  );
}
