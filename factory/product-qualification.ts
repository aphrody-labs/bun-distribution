// SPDX-License-Identifier: MIT
import { mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { productIdentity, sameProductIdentity, verifyProductPayload } from "../container/product-payload.ts";
import { verifyQualifiedProduct, type ProductQualification } from "../container/verify-product.ts";

const productSkills = [
  "replica-architect", "replica-backend", "replica-brand", "replica-build",
  "replica-deploy", "replica-design", "replica-diff", "replica-entrepreneur",
  "replica-launch", "replica-recon", "replica-test",
];

/** Qualify CLI discovery, route targets and the frozen CLI-WASM runtime path. */
export async function qualifyProductPayload(workspace: string, receiptPath: string, executable: string, output: string) {
  if (process.platform !== "linux") throw new Error("Product CLI qualification runs on the Linux factory");
  workspace = resolve(workspace);
  executable = await realpath(executable);
  output = resolve(output);
  const destination = relative(workspace, output);
  if (!destination || (destination !== ".." && !destination.startsWith(`..${sep}`) && !isAbsolute(destination)))
    throw new Error("Product qualification receipt must be outside the frozen workspace");
  const input = await Bun.file(receiptPath).json();
  const target = process.arch === "x64" ? "linux-x64" : process.arch === "arm64" ? "linux-arm64" : "";
  const expected = { target, runtime: input.runtime };
  const receipt = await verifyProductPayload(workspace, receiptPath, expected);
  if (!sameProductIdentity(await productIdentity(executable), receipt.runtime))
    throw new Error("Product qualification executable differs from its prepared runtime");
  const evidence = [];
  let commands: { group: string; name: string }[] = [];
  for (const args of [["--help"], ["commands", "--all", "--json"], ["commands", "--check"]]) {
    const result = await runProcess([resolve(executable), "--no-env-file", "src/cli.ts", ...args], workspace, {
      timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
      env: { ...Bun.env, BUN_BE_BUN: undefined },
    });
    if (result.code !== 0) throw new Error(`Product CLI qualification failed (${args.join(" ")}): ${result.stderr.slice(-3000)}`);
    if (args.includes("--json")) {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!Array.isArray(parsed) || parsed.some(entry => !entry || typeof entry.group !== "string" || typeof entry.name !== "string"))
        throw new Error("Product command discovery returned an invalid catalog");
      commands = parsed;
    }
    evidence.push({ args, exitCode: result.code, stdoutSHA256: new Bun.CryptoHasher("sha256").update(result.stdout).digest("hex") });
  }
  if (!["mcp", "agent-plugin", "wasm", "design", "engine", "re", "rea"]
    .every(name => commands.some(entry => entry.group === "" && entry.name === name)))
    throw new Error("Product CLI is missing a required native or first-party capability route");
  const designArgs = [
    "--no-env-file", join(workspace, "packages/m3-design/src/cli.ts"), "compile", "--prompt",
    "Responsive M3 monitoring dashboard for a desktop operator",
  ];
  const designResult = await runProcess([resolve(executable), ...designArgs], workspace, {
    timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
    env: { ...Bun.env, BUN_BE_BUN: undefined },
  });
  if (designResult.code !== 0)
    throw new Error(`Product M3 design qualification failed: ${designResult.stderr.slice(-3000)}`);
  const scoreMatch = designResult.stdout.match(/Scores: (\{[^\r\n]+\})/);
  const scores = scoreMatch ? JSON.parse(scoreMatch[1]!) as Record<string, unknown> : undefined;
  const designFiles = ["src/theme.css", "src/tokens.json", "src/index.tsx"];
  if (!scores || !["philosophy", "hierarchy", "detail", "functionalParity", "innovation"]
      .every(axis => typeof scores[axis] === "number" && Number.isFinite(scores[axis]) && scores[axis] >= 0 && scores[axis] <= 100) ||
    !designFiles.every(path => designResult.stdout.includes(`- ${path} (`)))
    throw new Error("Product M3 design compiler omitted generated files or valid self-critique scores");
  evidence.push({ args: designArgs, exitCode: designResult.code,
    stdoutSHA256: new Bun.CryptoHasher("sha256").update(designResult.stdout).digest("hex"),
    generatedFiles: designFiles, critiqueScores: scores });
  const wasmArgs = ["--no-env-file", "-e", [
    'import { loadCliWasm } from "./packages/cli-wasm/src/index.ts";',
    'const wasm = await Bun.file("./packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm").bytes();',
    "const cli = await loadCliWasm(wasm);",
    'const report = { version: cli.version, abi: cli.rag.abiVersion, manifest: JSON.parse(cli.rag.manifest()), help: cli.run(["--help"]) };',
    "console.log(JSON.stringify(report));",
  ].join("\n")];
  const wasmResult = await runProcess([resolve(executable), ...wasmArgs], workspace, {
    timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
    env: { ...Bun.env, BUN_BE_BUN: undefined },
  });
  if (wasmResult.code !== 0)
    throw new Error(`Product CLI-WASM qualification failed: ${wasmResult.stderr.slice(-3000)}`);
  const wasmReport = JSON.parse(wasmResult.stdout) as {
    version?: unknown;
    abi?: unknown;
    manifest?: { abi?: unknown };
    help?: { code?: unknown; stdout?: unknown };
  };
  if (typeof wasmReport.version !== "string" || !wasmReport.version || !Number.isSafeInteger(wasmReport.abi) ||
    wasmReport.abi !== wasmReport.manifest?.abi || wasmReport.help?.code !== 0 ||
    typeof wasmReport.help.stdout !== "string" || !wasmReport.help.stdout)
    throw new Error("Product CLI-WASM returned invalid version, ABI or pure-command help evidence");
  evidence.push({ args: wasmArgs, exitCode: wasmResult.code,
    stdoutSHA256: new Bun.CryptoHasher("sha256").update(wasmResult.stdout).digest("hex"),
    wasmVersion: wasmReport.version, wasmAbi: wasmReport.abi, pureHelp: true });
  const ffiArgs = ["--no-env-file", "-e", [
    'import { loadNativeLibrary } from "./packages/aphrody-bun/src/library.ts";',
    "const ffi = loadNativeLibrary();",
    'console.log(JSON.stringify({ aphrody: ffi.symbols.aphrody_abi_version(), web: ffi.symbols.aphrody_web_bridge_abi_version(), bun: ffi.symbols.bun_rs_abi_version(), zerocopy: ffi.symbols.aphrody_zerocopy_abi_version() }));',
  ].join("\n")];
  const ffiResult = await runProcess([resolve(executable), ...ffiArgs], workspace, {
    timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
    env: { ...Bun.env, BUN_BE_BUN: undefined, APHRODY_FFI_LIB: undefined, APHRODY_FFI_DEV: undefined },
  });
  if (ffiResult.code !== 0) throw new Error(`Product FFI qualification failed: ${ffiResult.stderr.slice(-3000)}`);
  const ffiAbi = JSON.parse(ffiResult.stdout) as Record<string, unknown>;
  if (ffiAbi.aphrody !== 1 || ffiAbi.web !== 5 || ffiAbi.bun !== 1 || ffiAbi.zerocopy !== 1)
    throw new Error("Product FFI returned an incompatible native ABI");
  evidence.push({ args: ffiArgs, exitCode: ffiResult.code,
    stdoutSHA256: new Bun.CryptoHasher("sha256").update(ffiResult.stdout).digest("hex"), ffiAbi });
  const isolatedHome = join(resolve(Bun.env.TMPDIR ?? "/tmp"), `bun-os-plugin-qualification-${crypto.randomUUID()}`);
  const pluginArgs = ["--no-env-file", "agent-plugin", "install", "all", "--home", isolatedHome, "--dry-run", "--json"];
  const pluginResult = await runProcess([resolve(executable), ...pluginArgs], workspace, {
    timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
    env: { ...Bun.env, HOME: isolatedHome, BUN_INSTALL: undefined, CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined, OPENCODE_CONFIG_DIR: undefined, OPENCODE_CONFIG: undefined,
      XDG_CONFIG_HOME: undefined, BUN_BE_BUN: undefined },
  });
  if (pluginResult.code !== 0) throw new Error(`Product agent-plugin qualification failed: ${pluginResult.stderr.slice(-3000)}`);
  const pluginReport = JSON.parse(pluginResult.stdout) as { targets?: unknown[]; actions?: unknown[] };
  const pluginTargets = pluginReport.targets ?? [];
  const pluginActions = pluginReport.actions ?? [];
  const requiredPluginTargets = ["claude", "codex", "gemini", "opencode", "local", "agy"];
  if (!requiredPluginTargets.every(target => pluginTargets.includes(target)) || !pluginActions.length)
    throw new Error("Product agent-plugin archive did not produce plans for every provider adapter");
  evidence.push({ args: pluginArgs, exitCode: pluginResult.code,
    stdoutSHA256: new Bun.CryptoHasher("sha256").update(pluginResult.stdout).digest("hex"),
      pluginTargets, actionCount: pluginActions.length, dryRun: true });

  const mcpArgs = ["--no-env-file", "mcp", "--profile", "codex", "--page-size", "1000", "--cwd", workspace];
  const mcpMessages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bun-os-product-qualification", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "resources/list", params: {} },
    { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "bun://skills/bun-native" } },
    { jsonrpc: "2.0", id: 5, method: "prompts/list", params: {} },
    { jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "bun://skills/ui-ux-pro-max" } },
    { jsonrpc: "2.0", id: 7, method: "resources/read", params: { uri: "bun://skills/replica-architect" } },
  ];
  const mcpInput = new TextEncoder().encode(mcpMessages.map(message => JSON.stringify(message)).join("\n") + "\n");
  const mcpResult = await runProcess([resolve(executable), ...mcpArgs], workspace, {
    timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024, input: mcpInput,
    env: { ...Bun.env, HOME: isolatedHome, BUN_MCP_PROFILE: "codex", BUN_MCP_SKILLS_PATH: [
      join(workspace, "vendor/rea/plugin/skills"),
      join(workspace, "packages/m3-design/intelligence"),
      join(workspace, "packages/replica-skills/skills"),
    ].join(":"),
      BUN_MCP_MEMORY_DB: undefined, REDIS_URL: undefined, VALKEY_URL: undefined, CODEX_HOME: undefined,
      BUN_BE_BUN: undefined },
  });
  if (mcpResult.code !== 0) throw new Error(`Product MCP qualification failed: ${mcpResult.stderr.slice(-3000)}`);
  const mcpReplies = mcpResult.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line) as {
    id?: number;
    result?: {
      protocolVersion?: string;
      serverInfo?: { name?: string };
      capabilities?: { tools?: unknown };
      tools?: { name?: string }[];
      resources?: { uri?: string }[];
      contents?: { uri?: string; text?: string }[];
      prompts?: { name?: string }[];
    };
    error?: { message?: string };
  });
  const response = (id: number) => {
    const reply = mcpReplies.find(item => item.id === id);
    if (!reply || reply.error || !reply.result)
      throw new Error(`Product MCP request ${id} failed: ${reply?.error?.message ?? "missing JSON-RPC response"}`);
    return reply.result;
  };
  const initialized = response(1);
  const tools = response(2).tools ?? [];
  const resources = response(3).resources ?? [];
  const skill = response(4).contents?.[0];
  const prompts = response(5).prompts ?? [];
  const uiUxSkill = response(6).contents?.[0];
  const replicaSkill = response(7).contents?.[0];
  const toolNames = tools.map(tool => tool.name);
  if (initialized.protocolVersion !== "2025-06-18" || initialized.serverInfo?.name !== "bun" || !initialized.capabilities?.tools ||
    !["docs_search", "skills_list", "skill_read", "graph_query"].every(name => toolNames.includes(name)) ||
    !resources.some(resource => resource.uri === "bun://docs/llms.txt") ||
    skill?.uri !== "bun://skills/bun-native" || typeof skill.text !== "string" || !skill.text.trim() ||
    uiUxSkill?.uri !== "bun://skills/ui-ux-pro-max" || typeof uiUxSkill.text !== "string" || !uiUxSkill.text.includes("Material 3 contract") ||
    replicaSkill?.uri !== "bun://skills/replica-architect" || typeof replicaSkill.text !== "string" || !replicaSkill.text.includes("# replica-architect") ||
    !productSkills.every(name => resources.some(resource => resource.uri === `bun://skills/${name}`) && prompts.some(prompt => prompt.name === name)) ||
    !prompts.some(prompt => prompt.name === "bun-native") || !prompts.some(prompt => prompt.name === "ui-ux-pro-max"))
    throw new Error("Product MCP protocol, tools, docs, Bun, M3 design or Replica skills and prompts are incomplete");
  evidence.push({ args: mcpArgs, exitCode: mcpResult.code,
    stdoutSHA256: new Bun.CryptoHasher("sha256").update(mcpResult.stdout).digest("hex"),
    protocolVersion: initialized.protocolVersion, toolCount: tools.length, resourceCount: resources.length,
    embeddedSkill: skill.uri, skillBytes: new TextEncoder().encode(skill.text).length,
    productDesignSkill: uiUxSkill.uri, productDesignSkillBytes: new TextEncoder().encode(uiUxSkill.text).length,
    replicaSkills: productSkills, replicaArchitectSkillBytes: new TextEncoder().encode(replicaSkill.text).length, promptCount: prompts.length });
  await verifyProductPayload(workspace, receiptPath, expected);
  if (!sameProductIdentity(await productIdentity(executable), receipt.runtime))
    throw new Error("Product runtime changed during CLI qualification");
  const qualification: ProductQualification = {
    schemaVersion: 1, kind: "bun-os-product-qualification", passed: true,
    target: receipt.target, sourceRevision: receipt.sourceRevision,
    installedTreeSHA256: receipt.installedTreeSHA256, runtimeSHA256: receipt.runtime.sha256,
    installedModesSHA256: receipt.installedModesSHA256,
    gates: ["product-cli", "cli-wasm", "ffi", "agent-plugin", "mcp"],
  };
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  const physicalDestination = relative(await realpath(workspace), resolve(parent, basename(output)));
  if (!physicalDestination || (physicalDestination !== ".." && !physicalDestination.startsWith(`..${sep}`) && !isAbsolute(physicalDestination)))
    throw new Error("Product qualification output resolves inside the frozen workspace");
  const file = await open(output, "wx");
  try {
    await file.writeFile(JSON.stringify({ ...qualification,
      scope: "CLI discovery, route targets, CLI-WASM, native FFI ABI, agent-plugin dry-run and MCP protocol/tools/resources/prompts", evidence,
      commandCount: commands.length, nativeCommandsQualified: false, fullProductQualified: false }, null, 2) + "\n");
  } finally { await file.close(); }
  await verifyQualifiedProduct(workspace, receiptPath, output, expected);
  return qualification;
}
