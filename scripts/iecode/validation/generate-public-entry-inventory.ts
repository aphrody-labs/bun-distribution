const read = (path: string) => Bun.file(path).text();
const cliOwners: Record<string, string> = {
  Net: "crates/nie/aphrody-nie-net/src/lib.rs",
  Launcher: "crates/nie/aphrody-nie-launcher/src/lib.rs",
  Live: "crates/nie/aphrody-nie-launcher/src/lib.rs",
  Vn: "crates/nie/aphrody-nie-explore/src/vn.rs",
  Rebuild: "crates/nie/aphrody-nie-re/src/workflow.rs",
  Recover: "crates/nie/aphrody-nie-re/src/workflow.rs",
  SeedUi: "crates/nie/aphrody-nie-seed/src/ui_names.rs",
  MenuPredecode: "crates/nie/aphrody-nie-explore/src/menu_predecode.rs",
  RefreshTypedJson: "crates/nie/aphrody-nie-formats/src/cfgbin.rs",
  Locales: "crates/nie/aphrody-nie-formats/src/locale.rs",
  Pdata: "crates/nie/aphrody-nie-re/src/lib.rs",
  Video: "crates/nie/aphrody-nie-explore/src/cinema.rs",
  UniformMap: "crates/nie/aphrody-nie-explore/src/uniform_map.rs",
  Format: "crates/nie/aphrody-nie-formats/src/lib.rs",
  Decode: "crates/nie/aphrody-nie-formats/src/lib.rs",
  Convert: "crates/nie/aphrody-nie-formats/src/lib.rs",
  Img: "crates/nie/aphrody-nie-formats/src/lib.rs",
  Textures: "crates/nie/aphrody-nie-formats/src/lib.rs",
  Vfs: "crates/nie/aphrody-nie-explore/src/lib.rs",
  Lua: "crates/nie/aphrody-nie-lua/src/lib.rs",
  LuaRun: "crates/nie/aphrody-nie-lua/src/lib.rs",
  LuaAudit: "crates/nie/aphrody-nie-lua/src/lib.rs",
  Save: "crates/nie/aphrody-nie-save/src/lib.rs",
  Wiki: "crates/nie/aphrody-nie-wiki/src/lib.rs",
  Mode: "crates/nie/aphrody-nie-explore/src/menu_mode_analysis.rs",
  Icons: "crates/nie/aphrody-nie-explore/src/menu_icons.rs",
  Avatar: "crates/nie/aphrody-nie-data/src/avatar.rs",
  Steam: "crates/nie/aphrody-nie-steam/src/lib.rs",
  Viola: "crates/nie/aphrody-nie-viola/src/lib.rs",
  Mod: "crates/nie/aphrody-nie-viola/src/lib.rs",
  Render: "crates/nie/aphrody-nie-render3d/src/lib.rs",
  Seed: "crates/nie/aphrody-nie-seed/src/lib.rs",
  Queue: "crates/nie/aphrody-nie-queue/src/lib.rs",
  Propagate: "crates/nie/aphrody-nie-re/src/lib.rs",
  Rtti: "crates/nie/aphrody-nie-re/src/lib.rs",
  Disasm: "crates/nie/aphrody-nie-re/src/lib.rs",
  Strings: "crates/nie/aphrody-nie-re/src/lib.rs",
  Coverage: "crates/nie/aphrody-nie-re/src/lib.rs",
  Index: "crates/nie/aphrody-nie-index/src/lib.rs",
  Play: "crates/nie/aphrody-nie-app/src/flow.rs",
  Ocgen: "crates/nie/aphrody-nie-ocgen/src/cli.rs",
  Atlas: "crates/nie/aphrody-nie-index/src/atlas.rs",
};
const cliHostRationale: Record<string, string> = {
  Info: "Info inventories the locally installed game and filesystem metadata.",
  Find: "Find searches host filesystem paths outside the mounted VFS abstraction.",
  Grep: "Grep searches host file contents through native filesystem walkers.",
  ComputerUse: "ComputerUse controls a local executable or Ghidra process boundary.",
  Mem: "Mem reads or modifies an identified local game process.",
  PatchEac: "PatchEac patches a local executable on disk.",
};
const cliEvidence: Record<string, [string, string]> = {
  SeedUi: ["crates/nie/aphrody-nie-cli/src/main.rs", "seed_ui::run("],
  MenuPredecode: ["crates/nie/aphrody-nie-cli/src/menu_predecode.rs", "let plan = plan(priority_paths,"],
  Avatar: ["crates/nie/aphrody-nie-cli/src/avatar_cmd.rs", "category_resource_prefix(cfg,"],
  Rebuild: ["crates/nie/aphrody-nie-cli/src/main.rs", "aphrody_nie_re::workflow::rebuild("],
  Recover: ["crates/nie/aphrody-nie-cli/src/main.rs", "aphrody_nie_re::workflow::recover_with_observer("],
  Vn: ["crates/nie/aphrody-nie-cli/src/vn_cmd.rs", "casting_entries("],
};
const ownerNeedle = (owner: string) => owner.match(/\/(nie-[a-z0-9-]+)\//)?.[1].replaceAll("-", "_") ?? "";
const mapping = (
  surface: string,
  entry: string,
  owner: string,
  classification: "portable" | "host_only" | "transport",
  rationale: string,
) => ({
  surface,
  entry,
  capability: entry
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase(),
  classification,
  owner,
  rationale,
});

const cliSource = await read("crates/nie/aphrody-nie-cli/src/main.rs");
const cliModulePaths = await Array.fromAsync(new Bun.Glob("*.rs").scan({ cwd: "crates/nie/aphrody-nie-cli/src" }));
const cliAdapterSources = [
  "crates/nie/aphrody-nie-cli/src/main.rs",
  ...cliModulePaths.map(path => `crates/nie/aphrody-nie-cli/src/${path}`),
];
const cliAdapterText = new Map(
  await Promise.all(cliAdapterSources.map(async path => [path, await read(path)] as const)),
);
const cliBlock = cliSource.match(/enum Cmd \{([\s\S]*?)\n\}/)?.[1] ?? "";
const cli = [...cliBlock.matchAll(/^    (?:#\[[^\n]+\]\n    )*([A-Z][A-Za-z0-9_]*)/gm)]
  .map(match => match[1])
  .filter(name => name !== "Mcp")
  .map(name => {
    const host = name in cliHostRationale;
    const owner = cliOwners[name] ?? "crates/nie/aphrody-nie-cli/src/main.rs";
    if (host) return mapping("cli", name, owner, "host_only", cliHostRationale[name]);
    const inferredNeedle = `${ownerNeedle(owner)}::`;
    const evidence = cliEvidence[name] ?? [
      cliAdapterSources.find(path => cliAdapterText.get(path)?.includes(inferredNeedle)) ?? "",
      inferredNeedle,
    ];
    return {
      ...mapping("cli", name, owner, "portable", `${name} delegates portable domain work to its named library owner.`),
      sourceEvidence: evidence,
    };
  });

const mcpSource = await read("crates/nie/aphrody-nie-cli/src/mcp.rs");
const mcpOwners: Record<string, [string, string]> = {
  vfs_list: ["crates/nie/aphrody-nie-explore/src/mcp_vfs.rs", "aphrody_nie_explore::mcp_vfs::list("],
  vfs_search: ["crates/nie/aphrody-nie-explore/src/mcp_vfs.rs", "aphrody_nie_explore::mcp_vfs::search("],
  vfs_stat: ["crates/nie/aphrody-nie-explore/src/mcp_vfs.rs", "aphrody_nie_explore::mcp_vfs::stat("],
  vfs_cat: ["crates/nie/aphrody-nie-explore/src/mcp_vfs.rs", "aphrody_nie_explore::mcp_vfs::cat("],
  asset_get: ["crates/nie/aphrody-nie-explore/src/mcp_vfs.rs", "aphrody_nie_explore::mcp_vfs::asset("],
  re_function: ["crates/nie/aphrody-nie-wiki/src/query.rs", "aphrody_nie_wiki::query::re_function_report("],
  re_coverage: ["crates/nie/aphrody-nie-wiki/src/query.rs", "aphrody_nie_wiki::query::re_coverage_report("],
};
const mcp = [...mcpSource.matchAll(/#\[tool\([\s\S]*?name = "([^"]+)"[\s\S]*?\)\]/g)].map(match => {
  const evidence = mcpOwners[match[1]];
  return {
    ...mapping(
      "mcp",
      match[1],
      evidence?.[0] ?? "crates/nie/aphrody-nie-cli/src/mcp.rs",
      "transport",
      `MCP tool ${match[1]} is an in-process transport adapter.`,
    ),
    ...(evidence ? { sourceEvidence: ["crates/nie/aphrody-nie-cli/src/mcp.rs", evidence[1]] } : {}),
  };
});

const inventory = {
  schema: "nie.public-entry-inventory/v1",
  proofLevel: "source-delegation",
  proofLimitation:
    "Verified call-chain evidence does not prove the absence of residual portable logic in bindings; that requires semantic audit and review.",
  generatedFrom: {
    cli: "Cmd",
    mcp: "#[tool(name)]",
  },
  entries: [...cli, ...mcp],
};
await Bun.write("scripts/iecode/validation/public-entry-inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ cli: cli.length, mcp: mcp.length }));
