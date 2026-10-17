#!/usr/bin/env bun
// Arch Linux / Omarchy / Hyprland MCP server (JSON-RPC 2.0 over stdio, newline-delimited).
import { read, search } from "./docs.ts";

type Json = Record<string, unknown>;
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const obj = (properties: Json, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

const archHost = process.env.ARCH_MCP_HOST;
const localArch = !!Bun.which("pacman");

/** Run a read-only command on the local Arch system or through `aphrody-infra ssh exec`. */
async function run(argv: string[], timeoutSecs = 60): Promise<string> {
  const cmd = localArch
    ? argv
    : archHost
      ? ["aphrody-infra", "ssh", "exec", "--host", archHost, "--", ...argv]
      : undefined;
  if (!cmd) throw new Error("no local pacman and ARCH_MCP_HOST unset (an aphrody-infra SSH host running Arch)");
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(timeoutSecs),
    },
    timeout: (timeoutSecs + 15) * 1000,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !out) throw new Error(err.trim() || `exit ${code}`);
  return (out + (err.trim() ? `\n[stderr]\n${err}` : "")).slice(0, 60_000);
}

const shellArg = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const safeArgs = (args: unknown): string[] => {
  const list = Array.isArray(args) ? args.map(String) : [];
  for (const a of list) if (/[;&|`$<>\n]/.test(a)) throw new Error(`rejected argument: ${a}`);
  return list;
};

const pacmanRead = /^-(Q|Si|Ss|Sl|Sg|F|Qi|Ql|Qo|Qs|Qdt|Qm|Qe|Qk|Qkk)[a-z]*$/;
const hyprRead = new Set([
  "version",
  "monitors",
  "workspaces",
  "activeworkspace",
  "clients",
  "activewindow",
  "devices",
  "layers",
  "binds",
  "getoption",
  "rollinglog",
  "systeminfo",
  "configerrors",
]);
const systemctlRead = new Set([
  "status",
  "list-units",
  "list-unit-files",
  "list-timers",
  "is-active",
  "is-enabled",
  "is-failed",
  "show",
  "cat",
  "--failed",
]);

async function aur(params: URLSearchParams | string): Promise<unknown> {
  const url =
    typeof params === "string"
      ? `https://aur.archlinux.org/rpc/v5/${params}`
      : `https://aur.archlinux.org/rpc/v5/info?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`AUR RPC ${res.status}`);
  return res.json();
}

/** Static PKGBUILD checks that need no Arch host. */
function lintPkgbuild(src: string): string[] {
  const issues: string[] = [];
  for (const v of ["pkgname", "pkgver", "pkgrel", "arch", "license"])
    if (!new RegExp(`^${v}=`, "m").test(src)) issues.push(`missing ${v}`);
  if (!/^pkgdesc=/m.test(src)) issues.push("missing pkgdesc");
  if (/^source=/m.test(src) && !/^(b2|sha\d+|md5)sums(_\w+)?=/m.test(src)) issues.push("source without checksums");
  if (/\bsudo\b/.test(src)) issues.push("sudo used inside PKGBUILD");
  if (/\$srcdir|\$pkgdir/.test(src) && !/"\$\{?(src|pkg)dir/.test(src)) issues.push("unquoted $srcdir/$pkgdir");
  if (/^package\(\)/m.test(src) === false && !/^package_\w+\(\)/m.test(src)) issues.push("missing package() function");
  if (/cd \$srcdir|cd "\$srcdir"$/m.test(src)) issues.push("cd into $srcdir without a subdirectory");
  return issues;
}

const tools = [
  {
    name: "arch_wiki_search",
    description: "Full-text search (FTS5, bm25) of the offline Arch Wiki (arch-wiki-docs, English).",
    inputSchema: obj({ query: str("Search terms"), limit: num("Max hits (default 10)") }, ["query"]),
  },
  {
    name: "omarchy_manual_search",
    description: "Full-text search of the offline Omarchy manual.",
    inputSchema: obj({ query: str("Search terms"), limit: num("Max hits (default 10)") }, ["query"]),
  },
  {
    name: "docs_read",
    description: "Read an Arch Wiki or Omarchy manual page by exact title or path from a search hit.",
    inputSchema: obj(
      {
        page: str("Title or path"),
        offset: num("Character offset"),
        max: num("Max characters (default 12000)"),
      },
      ["page"],
    ),
  },
  {
    name: "aur_search",
    description: "Search the AUR (RPC v5).",
    inputSchema: obj(
      {
        query: str("Search term"),
        by: str(
          "name | name-desc (default) | maintainer | depends | makedepends | optdepends | checkdepends | provides | conflicts | replaces | keywords | groups | submitter | comaintainers",
        ),
      },
      ["query"],
    ),
  },
  {
    name: "aur_info",
    description: "AUR package details (version, votes, maintainer, dependencies, out-of-date flag).",
    inputSchema: obj({ names: { type: "array", items: { type: "string" } } }, ["names"]),
  },
  {
    name: "aur_pkgbuild",
    description: "Fetch the current PKGBUILD of an AUR package.",
    inputSchema: obj({ name: str("AUR package base") }, ["name"]),
  },
  {
    name: "arch_package_search",
    description: "Search official Arch repositories (archlinux.org packages JSON API).",
    inputSchema: obj(
      {
        query: str("Search term (q) or exact name"),
        exact: { type: "boolean", description: "Exact name match" },
        repo: str("core | extra | multilib | ... (optional)"),
      },
      ["query"],
    ),
  },
  {
    name: "pacman_query",
    description:
      "Read-only pacman query (-Q*, -Si, -Ss, -Sl, -Sg, -F*) or expac/pactree/checkupdates on the local Arch system or ARCH_MCP_HOST.",
    inputSchema: obj(
      {
        tool: str("pacman (default) | expac | pactree | checkupdates"),
        args: { type: "array", items: { type: "string" } },
      },
      ["args"],
    ),
  },
  {
    name: "systemd_query",
    description:
      "Read-only systemctl (status, list-units, list-timers, is-*, show, cat, --failed) or journalctl (-u UNIT, -n, -p, -b, --since).",
    inputSchema: obj(
      {
        tool: str("systemctl | journalctl"),
        args: { type: "array", items: { type: "string" } },
        user: { type: "boolean", description: "Use --user" },
      },
      ["tool", "args"],
    ),
  },
  {
    name: "hyprctl_query",
    description:
      "Read-only hyprctl JSON query: version, monitors, workspaces, activeworkspace, clients, activewindow, devices, layers, binds, getoption, systeminfo, configerrors.",
    inputSchema: obj({ command: str("hyprctl subcommand"), arg: str("Optional argument") }, ["command"]),
  },
  {
    name: "pkgbuild_lint",
    description: "Lint a PKGBUILD: static checks here, plus namcap on the Arch host when available.",
    inputSchema: obj({ content: str("PKGBUILD source") }, ["content"]),
  },
];

async function call(name: string, a: Json): Promise<unknown> {
  const limit = Number(a.limit ?? 10);
  switch (name) {
    case "arch_wiki_search":
      return search(String(a.query), "wiki", limit);
    case "omarchy_manual_search":
      return search(String(a.query), "omarchy", limit);
    case "docs_read":
      return read(String(a.page), Number(a.offset ?? 0), Number(a.max ?? 12_000));
    case "aur_search":
      return aur(`search/${encodeURIComponent(String(a.query))}?by=${encodeURIComponent(String(a.by ?? "name-desc"))}`);
    case "aur_info": {
      const p = new URLSearchParams();
      for (const n of (a.names as string[]) ?? []) p.append("arg[]", n);
      return aur(p);
    }
    case "aur_pkgbuild": {
      const res = await fetch(
        `https://aur.archlinux.org/cgit/aur.git/plain/PKGBUILD?h=${encodeURIComponent(String(a.name))}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) throw new Error(`AUR cgit ${res.status}`);
      return res.text();
    }
    case "arch_package_search": {
      const p = new URLSearchParams({
        [a.exact ? "name" : "q"]: String(a.query),
      });
      if (a.repo) p.set("repo", String(a.repo));
      const res = await fetch(`https://archlinux.org/packages/search/json/?${p}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json()) as { results: Json[] };
      return data.results.slice(0, 25).map(r => ({
        repo: r.repo,
        name: r.pkgname,
        version: `${r.pkgver}-${r.pkgrel}`,
        desc: r.pkgdesc,
        url: r.url,
      }));
    }
    case "pacman_query": {
      const tool = String(a.tool ?? "pacman");
      const args = safeArgs(a.args);
      if (tool === "pacman") {
        if (!args[0] || !pacmanRead.test(args[0])) throw new Error("only read-only pacman operations are allowed");
      } else if (!["expac", "pactree", "checkupdates"].includes(tool)) throw new Error(`tool not allowed: ${tool}`);
      return run([tool, ...args]);
    }
    case "systemd_query": {
      const tool = String(a.tool);
      const args = safeArgs(a.args);
      if (tool === "systemctl") {
        if (!args[0] || !systemctlRead.has(args[0])) throw new Error("only read-only systemctl verbs are allowed");
      } else if (tool === "journalctl") {
        if (args.some(x => /^--(vacuum|rotate|flush|sync|relinquish)/.test(x)))
          throw new Error("journal maintenance is not allowed");
        if (!args.includes("-n") && !args.some(x => x.startsWith("--lines"))) args.push("-n", "200");
        args.push("--no-pager");
      } else throw new Error(`tool not allowed: ${tool}`);
      return run([tool, ...(a.user ? ["--user"] : []), ...args]);
    }
    case "hyprctl_query": {
      const command = String(a.command);
      if (!hyprRead.has(command)) throw new Error(`hyprctl ${command} is not a read-only query`);
      return run(["hyprctl", "-j", command, ...(a.arg ? safeArgs([a.arg]) : [])]);
    }
    case "pkgbuild_lint": {
      const content = String(a.content);
      const result: Json = { static: lintPkgbuild(content) };
      if (localArch || archHost) {
        const b64 = Buffer.from(content).toString("base64");
        const script = `d=$(mktemp -d) && echo ${b64} | base64 -d > "$d/PKGBUILD" && namcap "$d/PKGBUILD"; r=$?; rm -rf "$d"; exit $r`;
        // The SSH transport joins argv into a remote shell line, so quote only there.
        result.namcap = await run(["sh", "-c", localArch ? script : shellArg(script)]).catch(
          (e: Error) => `namcap unavailable: ${e.message}`,
        );
      }
      return result;
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function handle(msg: Json): Promise<Json | null> {
  const { id, method } = msg;
  const params = (msg.params ?? {}) as Json;
  const ok = (result: unknown): Json => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: (params.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "bun-arch-mcp", version: "1.4.4" },
      });
    case "tools/list":
      return ok({ tools });
    case "tools/call":
      try {
        const out = await call(params.name as string, (params.arguments ?? {}) as Json);
        return ok({
          content: [
            {
              type: "text",
              text: typeof out === "string" ? out : JSON.stringify(out, null, 2),
            },
          ],
        });
      } catch (err) {
        return ok({
          content: [{ type: "text", text: String((err as Error).message ?? err) }],
          isError: true,
        });
      }
    case "ping":
      return ok({});
    default:
      if (id === undefined) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${String(method)}` },
      };
  }
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    void handle(JSON.parse(line) as Json).then(reply => {
      if (reply) void Bun.write(Bun.stdout, `${JSON.stringify(reply)}\n`);
    });
  }
}
