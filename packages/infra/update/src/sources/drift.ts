// SPDX-License-Identifier: Apache-2.0
/**
 * Sources module: the single place for upstream source checkouts, upstream pins, forks and git state.
 *
 *   status|sync|verify   restore and inspect checkouts (./restore.ts, the former `upstream-sources` op)
 *   drift                remote head / newest tag / crates.io version vs every pin in tools/config/upstream-sources.json,
 *                        plus the Cargo git remotes of Cargo.lock
 *   forks                fork vs parent ahead/behind (GitHub API) for tools/config/update/forks.json
 *   prune [--apply]      remove the <id>.pre-bump-<ts> checkouts kept by bump
 *   pull [--apply] [--deps]
 *                        fast-forward tracked, clean git checkouts (Cargo path dependencies only with --deps)
 *   repo                 local repository state: branch, upstream ahead/behind, dirty paths, stashes
 *   bump [--only <id>] [--apply]
 *                        move a pin to the newest remote head (git) or version (crate). A temporary clone first proves
 *                        the local patches still apply; --apply then rewrites the manifest, keeps the old checkout as
 *                        <id>.pre-bump-<ts> and restores the new one. Any failure rolls the manifest back.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "../process.ts";
import { Ctx } from "../context.ts";
import { cmpVersion, registries } from "../deps/sync.ts";
import { gitSources, lsRemote, parseCargoLock } from "../deps/inventory.ts";
import {
  inspect,
  parseManifest,
  resolveSourceRoot,
  runUpstreamSources,
  syncSource,
  type Source,
} from "./restore.ts";

const git = (args: string[], cwd?: string) =>
  spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

export function refHead(url: string, ref: string): string | undefined {
  // Full ref names only: a bare "main" pattern also matches refs/heads/<user>/main.
  const names =
    ref === "HEAD"
      ? ["HEAD"]
      : ref.startsWith("refs/")
        ? [ref]
        : [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`];
  const r = git(["ls-remote", url, ...names]);
  if (r.status !== 0) return undefined;
  const lines = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"));
  const peeled = lines.find(([, name]) => name?.endsWith("^{}"));
  return (peeled ?? lines[0])?.[0];
}

export type DriftRow = {
  id: string;
  kind: string;
  role: string;
  pinned: boolean;
  current: string;
  latest?: string;
  newerTag?: string;
  behind: boolean;
  patches: number;
  note?: string;
};

export async function driftRows(c: Ctx): Promise<DriftRow[]> {
  const manifest = parseManifest(c.read("tools/config/upstream-sources.json"));
  const rows: DriftRow[] = [];
  for (const s of manifest.sources) {
    if (s.kind === "crate") {
      // oxlint-disable-next-line no-await-in-loop -- registry lookups are sequential: upstream registries rate-limit and the rows keep manifest order
      const latest = await registries
        .crate(s.crate!, s.version!.split(".")[0])
        .catch(() => undefined);
      rows.push({
        id: s.id,
        kind: "crate",
        role: s.role,
        pinned: s.pinned,
        current: s.version!,
        latest,
        behind: !s.hold && !!latest && cmpVersion(s.version!, latest) < 0,
        patches: s.patches?.length ?? 0,
        note: s.hold ? `held: ${s.hold}` : undefined,
      });
      continue;
    }
    const ref = s.ref ?? "HEAD";
    const head = refHead(s.url!, ref);
    const tags = lsRemote(s.url!);
    const cur = s.commit ?? "";
    rows.push({
      id: s.id,
      kind: "git",
      role: s.role,
      pinned: s.pinned,
      current: cur.slice(0, 10) || "(tracks ref)",
      latest: head?.slice(0, 10),
      newerTag: tags.latestTag,
      behind: !!head && !!cur && head !== cur,
      patches: s.patches?.length ?? 0,
      note: head ? undefined : `ref ${ref} unreachable`,
    });
  }
  return rows;
}

export type GitRemote = {
  url: string;
  pinned: string[];
  head?: string;
  moved: boolean;
  how: "rev" | "tag" | "branch" | "transitive";
};

/** Cargo git dependencies of Cargo.lock. Only `rev`/`branch` pins declared in the root Cargo.toml can be "moved"; tag pins
 *  are exact by definition and transitive ones belong to the source consumer that declares them. */
export function cargoGitRemotes(c: Ctx): GitRemote[] {
  const root = c.read("Cargo.toml");
  const repos = gitSources(parseCargoLock(c.read("Cargo.lock")));
  return [...repos].map(([url, pins]) => {
    const head = lsRemote(url).head;
    const pinned = [...pins].filter(Boolean);
    const line = root.split("\n").find((l) => l.includes(url) && /git\s*=/.test(l)) ?? "";
    const how: GitRemote["how"] = !line
      ? "transitive"
      : /\btag\s*=/.test(line)
        ? "tag"
        : /\brev\s*=/.test(line)
          ? "rev"
          : "branch";
    const behind = !!head && !pinned.some((p) => head.startsWith(p.slice(0, 10)));
    return {
      url,
      pinned: pinned.map((p) => p.slice(0, 10)),
      head: head?.slice(0, 10),
      moved: behind && (how === "rev" || how === "branch"),
      how,
    };
  });
}

type ForkInfo = {
  repo: string;
  parent?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  error?: string;
};

async function ghJson(path: string): Promise<any> {
  const token =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    spawnSync("gh", ["auth", "token"], { encoding: "utf8" }).stdout.trim();
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "aphrody-update",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export async function forkInfo(repo: string, declaredParent?: string): Promise<ForkInfo> {
  try {
    const r = await ghJson(`/repos/${repo}`);
    if (!r.fork || !r.parent) {
      // Detached or mirrored repository: compare heads through the declared parent instead of the compare API.
      if (!declaredParent) return { repo, error: "not a fork (no parent)" };
      const branch = r.default_branch as string;
      const mine = refHead(`https://github.com/${repo}`, branch);
      const theirs = refHead(`https://github.com/${declaredParent}`, branch);
      return {
        repo,
        parent: declaredParent,
        branch,
        error:
          mine === theirs
            ? undefined
            : `detached fork: heads differ (${mine?.slice(0, 8)} vs parent ${theirs?.slice(0, 8)})`,
        ahead: undefined,
        behind: undefined,
      };
    }
    const parent = r.parent.full_name as string;
    const branch = r.default_branch as string;
    const cmp = await ghJson(
      `/repos/${parent}/compare/${r.parent.default_branch}...${repo.split("/")[0]}:${branch}`,
    );
    return { repo, parent, branch, ahead: cmp.ahead_by, behind: cmp.behind_by };
  } catch (e) {
    return { repo, error: (e as Error).message };
  }
}

export function repoState(cwd: string): string[] {
  const out: string[] = [];
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim();
  let up = git(["rev-list", "--left-right", "--count", "@{u}...HEAD"], cwd);
  if (up.status !== 0) {
    // No tracking branch: fall back to <remote>/<branch> for each remote.
    for (const remote of git(["remote"], cwd).stdout.split("\n").filter(Boolean)) {
      up = git(["rev-list", "--left-right", "--count", `${remote}/${branch}...HEAD`], cwd);
      if (up.status === 0) break;
    }
  }
  const [behind, ahead] = up.status === 0 ? up.stdout.trim().split(/\s+/) : ["?", "?"];
  const dirty = git(["status", "--porcelain"], cwd).stdout.split("\n").filter(Boolean).length;
  const stash = git(["stash", "list"], cwd).stdout.split("\n").filter(Boolean).length;
  out.push(
    `branch ${branch}: ${ahead} ahead / ${behind} behind upstream, ${dirty} changed path(s), ${stash} stash(es)`,
  );
  const remotes = git(["remote", "-v"], cwd)
    .stdout.split("\n")
    .filter((l) => l.endsWith("(fetch)"))
    .map((l) => l.replace(/\s+\(fetch\)$/, "").replace(/\s+/g, " "));
  for (const r of remotes) out.push(`remote ${r}`);
  return out;
}

// ---------------------------------------------------------------- bump

export function replaceInBlock(
  text: string,
  id: string,
  field: string,
  from: string,
  to: string,
): string {
  const start = text.indexOf(`"id": "${id}"`);
  if (start < 0) throw new Error(`manifest block ${id} not found`);
  const next = text.indexOf('"id": "', start + 5);
  const block = text.slice(start, next < 0 ? undefined : next);
  const re = new RegExp(`("${field}":\\s*")${from.replace(/[.+]/g, "\\$&")}"`);
  if (!re.test(block)) throw new Error(`${id}: ${field} ${from} not found`);
  return text.slice(0, start) + block.replace(re, `$1${to}"`) + (next < 0 ? "" : text.slice(next));
}

export async function bump(c: Ctx, only: string | undefined): Promise<number> {
  const file = "tools/config/upstream-sources.json";
  const original = c.read(file);
  const manifest = parseManifest(original);
  const root = resolveSourceRoot(c.root, manifest, undefined);
  const targets = manifest.sources.filter((s) => s.pinned && !s.hold && (!only || s.id === only));
  if (only && !targets.length) {
    console.error(`bump: ${only} is not a bumpable pinned source (unpinned or held)`);
    return 2;
  }
  let failures = 0;
  for (const s of targets) {
    const target =
      s.kind === "crate"
        ? // oxlint-disable-next-line no-await-in-loop -- drift probes run one source at a time: each syncs a shared checkout and the registries rate-limit
          await registries.crate(s.crate!, s.version!.split(".")[0]).catch(() => undefined)
        : refHead(s.url!, s.ref ?? "HEAD");
    const current = s.kind === "crate" ? s.version! : s.commit!;
    if (!target || target === current) {
      console.log(`ok     ${s.id} ${current.slice(0, 12)}`);
      continue;
    }
    // Prove the patches on a scratch checkout of the new pin before touching anything.
    const probeRoot = mkdtempSync(join(tmpdir(), "aphrody-bump-"));
    const probe: Source = {
      ...s,
      ...(s.kind === "crate" ? { version: target } : { commit: target }),
    };
    let verdict = "patches apply";
    try {
      // oxlint-disable-next-line no-await-in-loop -- probe patches are applied to a single shared probe checkout, one source at a time
      await syncSource(c.root, probeRoot, probe);
    } catch (e) {
      verdict = `PATCH FAILS: ${(e as Error).message.split("\n")[0]}`;
      failures++;
    }
    rmSync(probeRoot, { recursive: true, force: true });
    console.log(
      `${c.apply && !verdict.startsWith("PATCH") ? "bump  " : "plan  "} ${s.id} ${current.slice(0, 12)} -> ${target.slice(0, 12)}  (${verdict})`,
    );
    if (verdict.startsWith("PATCH")) {
      c.write(
        `.coord/shared/sources-bump-${s.id}.md`,
        `# ${s.id} bump blocked\n\n${current} -> ${target}\n\n${verdict}\n\nRebase the patch(es) ${(s.patches ?? []).map((p) => p.file).join(", ")} onto the new commit, then rerun \`yolo update sources bump --only ${s.id} --apply\`.\n`,
      );
      continue;
    }
    if (!c.apply) continue;
    const field = s.kind === "crate" ? "version" : "commit";
    const updated = replaceInBlock(c.read(file), s.id, field, current, target);
    c.write(file, updated);
    const dir = join(root, s.id);
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const kept = `${dir}.pre-bump-${stamp}`;
    if (existsSync(dir)) renameSync(dir, kept);
    try {
      const next = parseManifest(updated).sources.find((x) => x.id === s.id)!;
      // oxlint-disable-next-line no-await-in-loop -- each source is applied to the same root checkout in turn; the next sync depends on the previous result
      await syncSource(c.root, root, next);
      // oxlint-disable-next-line no-await-in-loop -- each source is applied to the same root checkout in turn; the next sync depends on the previous result
      const row = await inspect(root, next);
      if (row.state !== "ok") throw new Error(`state ${row.state}: ${row.detail}`);
      console.log(`done   ${s.id}; previous checkout kept at ${kept}`);
    } catch (e) {
      console.error(`ROLLBACK ${s.id}: ${(e as Error).message}`);
      writeFileSync(join(c.root, file), original);
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(kept)) renameSync(kept, dir);
      failures++;
    }
  }
  if (c.apply && targets.length) {
    const deps = readFileSync(join(c.root, "Cargo.toml"), "utf8")
      .split("\n")
      .filter((l) =>
        targets.some((s) =>
          new RegExp(`\\.\\./source/${s.id.replace(/[.+]/g, "\\$&")}["/]`).test(l),
        ),
      )
      .map((l) => l.split("=")[0]!.trim());
    if (deps.length)
      console.log(
        `next   verify Cargo consumers: scripts/build/rust/cargo-serial.sh check ${deps.map((d) => `-p ${d}`).join(" ")}`,
      );
  }
  return failures ? 1 : 0;
}

// ---------------------------------------------------------------- entry

export async function runSources(c: Ctx, args: string[]): Promise<number> {
  const sub = args[0] ?? "drift";
  const rest = args.slice(1);
  switch (sub) {
    case "status":
    case "sync":
    case "verify":
      return runUpstreamSources([
        sub,
        "--root",
        c.root,
        ...(c.apply ? ["--apply"] : []),
        ...(c.json ? ["--json"] : []),
        ...rest.filter((a) => a !== "--apply" && a !== "--json"),
      ]);
    case "drift": {
      let behind = 0;
      for (const r of await driftRows(c)) {
        behind += r.behind ? 1 : 0;
        console.log(
          `${r.behind ? "behind" : "ok    "} ${r.id.padEnd(26)} ${r.kind.padEnd(5)} ${r.pinned ? "pinned " : "tracked"} ${r.current.padEnd(12)} -> ${(r.latest ?? "?").padEnd(12)}${r.newerTag ? ` tag ${r.newerTag}` : ""}${r.patches ? ` patches:${r.patches}` : ""}${r.note ? ` (${r.note})` : ""}`,
        );
      }
      for (const g of cargoGitRemotes(c))
        console.log(
          `${g.moved ? "moved " : "ok    "} cargo-git ${g.url.replace("https://github.com/", "")} ${g.how} ${g.pinned.join(",") || "(tag)"} head ${g.head ?? "?"}`,
        );
      console.log(`drift  ${behind} source(s) behind their remote`);
      return 0;
    }
    case "forks": {
      const cfg = c.jsonFile<{
        forks: {
          repo: string;
          parent?: string;
          role?: string;
          pinFile?: string;
          pinKeys?: Record<string, string>;
        }[];
      }>("tools/config/update/forks.json", { forks: [] });
      for (const f of cfg.forks) {
        // oxlint-disable-next-line no-await-in-loop -- fork checks are sequential: GitHub API rate limits, and the report keeps fork order
        const i = await forkInfo(f.repo, f.parent);
        console.log(
          i.error
            ? `fork   ${f.repo} <- ${i.parent ?? "?"}: ${i.error}`
            : `fork   ${f.repo} <- ${i.parent} (${i.branch}): ${i.ahead ?? "same head"}${i.ahead === undefined ? "" : " ahead"}${i.behind === undefined ? "" : `, ${i.behind} behind`}${f.role ? `  [${f.role}]` : ""}`,
        );
        if (f.pinKeys?.upstreamCommit && f.parent && i.branch) {
          const live = refHead(`https://github.com/${f.parent}`, i.branch);
          const recorded = String(
            c.jsonFile<Record<string, string>>(f.pinFile ?? "", {})[f.pinKeys.upstreamCommit] ?? "",
          );
          if (live && recorded) {
            const gap =
              live === recorded
                ? undefined
                : // oxlint-disable-next-line no-await-in-loop -- GitHub compare calls are sequential (API rate limits); the report keeps fork order
                  await ghJson(`/repos/${f.parent}/compare/${recorded}...${live}`).then(
                    (x) => x.ahead_by as number,
                    () => undefined,
                  );
            console.log(
              `       recorded upstream ${recorded.slice(0, 10)} vs ${f.parent} head ${live.slice(0, 10)}${live === recorded ? "" : `  <- upstream moved${gap === undefined ? "" : ` by ${gap} commit(s)`}; merge with the fork checkout, rebuild, then update ${f.pinFile}`}`,
            );
          }
        }
        if (f.pinFile && c.exists(f.pinFile)) {
          const pin = c.jsonFile<Record<string, string>>(f.pinFile, {});
          for (const [label, key] of Object.entries(f.pinKeys ?? {}))
            console.log(`       ${f.pinFile} ${label}: ${String(pin[key] ?? "?").slice(0, 10)}`);
        }
      }
      return 0;
    }
    case "prune": {
      const root = resolveSourceRoot(
        c.root,
        parseManifest(c.read("tools/config/upstream-sources.json")),
        undefined,
      );
      const old = readdirSync(root).filter((d) => d.includes(".pre-bump-"));
      for (const d of old) {
        console.log(`${c.apply ? "remove" : "would remove"} ${join(root, d)}`);
        if (c.apply) rmSync(join(root, d), { recursive: true, force: true });
      }
      if (!old.length) console.log("prune  nothing to remove");
      return 0;
    }
    case "pull": {
      // Fast-forward tracked git checkouts. Cargo path dependencies are skipped unless --deps (a pull can break the build).
      const manifest = parseManifest(c.read("tools/config/upstream-sources.json"));
      const root = resolveSourceRoot(c.root, manifest, undefined);
      const withDeps = rest.includes("--deps");
      let failed = 0;
      let text = c.read("tools/config/upstream-sources.json");
      for (const s of manifest.sources.filter((x) => x.kind === "git" && !x.pinned)) {
        const dir = join(root, s.id);
        if (!existsSync(join(dir, ".git"))) {
          console.log(`skip   ${s.id} (no checkout)`);
          continue;
        }
        if (s.cargoPathDep && !withDeps) {
          console.log(`skip   ${s.id} (cargo path dependency; use --deps)`);
          continue;
        }
        if (git(["status", "--porcelain"], dir).stdout.trim()) {
          console.log(`skip   ${s.id} (dirty)`);
          continue;
        }
        if (!c.apply) {
          console.log(`would  pull ${s.id}`);
          continue;
        }
        const r = git(["pull", "--ff-only", "--quiet"], dir);
        if (r.status !== 0) {
          failed++;
          console.log(`fail   ${s.id}: ${r.stderr.trim().split("\n")[0]}`);
          continue;
        }
        const head = git(["rev-parse", "HEAD"], dir).stdout.trim();
        console.log(`pulled ${s.id} ${head.slice(0, 10)}`);
        if (s.commit && s.commit !== head)
          text = replaceInBlock(text, s.id, "commit", s.commit, head); // keep the recorded observation current
      }
      if (c.apply) c.write("tools/config/upstream-sources.json", text);
      return failed ? 1 : 0;
    }
    case "repo":
      for (const l of repoState(c.root)) console.log(`repo   ${l}`);
      return 0;
    case "bump": {
      const oi = rest.indexOf("--only");
      return bump(c, oi >= 0 ? rest[oi + 1] : undefined);
    }
    default:
      console.error(
        "usage: sources [status|sync|verify|drift|forks|repo|prune|pull|bump [--only <id>]]",
      );
      return 2;
  }
}
