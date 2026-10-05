#!/usr/bin/env bun
// Fact-checks the V8 (Obscura) <-> JSC (Bun) equivalence capability by capability against the exact
// revisions in use: the V8 symbols Obscura calls, the JSC/WTF headers of the WebKit prebuilt that Bun
// links (read on the VPS build cache, WEBKIT_VERSION pin) and the symbols the Bun fork already uses.
// Every probe is a fixed-string ripgrep; a capability is `covered` only when the V8 usage, a JSC header
// symbol and a Bun source symbol are all found.
//   bun scripts/audit/engine-equivalence.ts [--write]
import { $ } from "bun";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const BUN_SRC = join(ROOT, "vendor/bun/src");
const OBSCURA = join(ROOT, "crates/web/obscura-js/src");
const WEBKIT_PREBUILT =
  "/srv/aphrody-build/cache/bun-forge/build-cache/webkit-5718a6ec579b9836-lto/include";
const VPS_JSC = `${WEBKIT_PREBUILT}/JavaScriptCore ${WEBKIT_PREBUILT}/wtf`;

interface Capability {
  id: string;
  name: string;
  v8: string[];
  jsc: string[];
  bun: string[];
  note: string;
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
    bun: ["overrideUserPreferredLanguages", "defaultLanguage"],
    note: "WTF::overrideUserPreferredLanguages replaces icu::set_default_locale.",
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
];

type Where = "obscura" | "jsc" | "bun" | "shim";

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function hits(symbol: string, where: Where): Promise<number> {
  const dir =
    where === "obscura"
      ? OBSCURA
      : where === "bun"
        ? BUN_SRC
        : where === "shim"
          ? join(BUN_SRC, "jsc/bindings/v8")
          : VPS_JSC;
  const cmd = `rg -F -c --no-messages -e ${shellQuote(symbol)} ${dir}`;
  const out =
    where === "jsc"
      ? await $`aphrody infra ssh exec --host vps ${cmd}`.nothrow().quiet().text()
      : await $`bash -c ${cmd}`.nothrow().quiet().text();
  let total = 0;
  for (const line of out.split("\n")) {
    const m = line.trim().match(/:(\d+)$/);
    if (m) total += Number(m[1]);
  }
  return total;
}

const symbols = async (list: string[], where: Where) =>
  Object.fromEntries(await Promise.all(list.map(async (s) => [s, await hits(s, where)] as const)));
const found = (r: Record<string, number>) => Object.values(r).some((n) => n > 0);

const receipt = await Promise.all(
  CAPABILITIES.map(async (c) => {
    const [v8, jsc, bun] = await Promise.all([
      symbols(c.v8, "obscura"),
      symbols(c.jsc, "jsc"),
      symbols(c.bun, "bun"),
    ]);
    const status = !found(v8)
      ? "v8-unused"
      : found(jsc) && found(bun)
        ? "covered"
        : found(bun)
          ? "bun-only"
          : "gap";
    return { id: c.id, name: c.name, status, note: c.note, v8, jsc, bun };
  }),
);
for (const r of receipt)
  console.log(
    r.status.padEnd(9),
    r.id.padEnd(15),
    JSON.stringify({ v8: r.v8, jsc: r.jsc, bun: r.bun }),
  );

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
    bunFork: (await $`git -C ${join(ROOT, "vendor/bun")} rev-parse HEAD`.text()).trim(),
    rustyV8:
      "v8 crate 150.4.0 (denoland/rusty_v8 tag v150.4.0, 5c15a6995c9bb4bacd3e341b59fff32c909c80bf)",
    forks: ["aphrody-labs/WebKit@bun-pin", "aphrody-labs/rusty_v8@obscura-pin-v150.4.0"],
  };
  const bunV8Shim = {
    path: "src/jsc/bindings/v8",
    note: "Isolate::AddNearHeapLimitCallback is stored but never fired (JSC has no near-heap-limit hook)",
    calls: shim,
  };
  await Bun.write(
    join(ROOT, "docs/plans/fusion/engine-equivalence-2026-10-05.json"),
    JSON.stringify({ pins, capabilities: receipt, bunV8Shim }, null, 2) + "\n",
  );
}
