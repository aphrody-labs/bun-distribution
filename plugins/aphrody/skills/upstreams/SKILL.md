---
name: upstreams
description: "Read any upstream (codex, ollama, mistral.rs, vllm, WSL, tauri-driver...) live without cloning it: catalogue, repository facts, directory listing, file content and code search through the aphrody CLI, the upstream_* MCP tools or aphrody-update."
---

# upstreams — live access to upstream code

Aphrody keeps almost no upstream code on disk. `config/upstream-sources.json` has two parts:

- `sources`: the four checkouts a build needs under `~/source` (Cargo path dependencies with local patches).
- `reference`: every other upstream. Never cloned by default; read it live.

Generated overview: `docs/reference/infra/UPSTREAMS.md` (do not edit by hand).

## Which door

| Need | MCP tool | CLI |
| --- | --- | --- |
| What upstreams exist, why, who uses them | `upstream_list` | `aphrody git upstream list` |
| Head, latest release, licence, pushed date, moved since observed | `upstream_info` | `aphrody git upstream info <id>` |
| List a directory at the live ref | `upstream_tree` (`id`, `path?`) | `aphrody git upstream tree <id> [path]` |
| Read one file at the live ref | `upstream_read` (`id`, `path`) | `aphrody git upstream read <id> <path>` |
| Search code inside one upstream | `upstream_search` (`id`, `query`) | `aphrody git upstream search <id> <query>` |
| Whole tree on disk (many files, grep) | none | `aphrody-update upstream fetch <id> [--path <dir>]` |

`upstream_read` cuts text over 256 KiB and files over 1 MB have no inline content: use `fetch` for those.
`upstream_search` needs `GH_TOKEN` or `GITHUB_TOKEN`; the other calls work anonymously within the GitHub rate limit.
`repo_path` (MCP) or `--path` (CLI) names the repository root; the default is `APHRODY_ROOT`, then the current directory.

## Maintenance (`aphrody-update upstream`)

| Command | Effect |
| --- | --- |
| `list [--tier build\|reference]` | catalogue with local state |
| `drift` | observed commit vs remote head, no checkout |
| `refresh --apply` | record the remote heads in the manifest |
| `fetch <id>` | shallow blob-less clone into `~/.cache/aphrody/upstream/<id>` (disposable, prints the path) |
| `prune --apply [--cache]` | remove non-vital checkouts under `~/source` (clean ones only) and optionally the cache |
| `docs --apply` | regenerate `docs/reference/infra/UPSTREAMS.md` |

The WSL build inputs (`WSL`, `WSL2-Linux-Kernel`, `wslg`, `terminal`, tier `build`) are restored only when a build needs
them: `aphrody-update sources sync --only <id> --apply`, then `upstream prune --apply`.

## Rules

- Never vendor or copy upstream code into the repository; record what was learned in `docs/`.
- A new reference upstream is one entry in `reference` (id, url, ref, tier, purpose, consumers); then `upstream docs --apply`.
- Something becomes a vital checkout only when a Cargo path dependency needs a local patch; add it to `sources` with the patch and marker.
