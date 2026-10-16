# Forks and submodules

`.gitmodules` is the only registry of the repository's submodules, and `scripts/forks.ts` is the only tool that
manages them (`bun run forks <command>`). It replaces ad hoc `git submodule` incantations and per-fork notes.

| Path                              | Kind                                                                                 | Upstream                                       |
| --------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `vendor/tailwindcss`              | tracked in-tree upstream source, not a gitlink                                       | `tailwindlabs/tailwindcss`                     |
| `vendor/base-ui`                  | tracked in-tree upstream source, not a gitlink                                       | `mui/base-ui`                                  |
| `vendor/material-web`             | fork                                                                                 | `material-components/material-web`             |
| `vendor/material-color-utilities` | fork                                                                                 | `material-foundation/material-color-utilities` |
| `vendor/material-design-icons`    | fork, sparse set owned by `packages/material-design-icons/scripts/sync-catalogue.ts` | `google/material-design-icons`                 |
| `packages/nie-ui`                 | first-party package (own repository, no upstream)                                    | none                                           |

Base UI and Tailwind retain their `UPSTREAM.json` source pins, licenses and imported source history. Their ownership is recorded in `infra/source-workspace.json`; the submodule commands below do not manage them. Root leaf integration, Tailwind Cargo/native artifacts and full upstream history qualification remain pending. Consumers currently resolve installed root catalog packages.

## `.gitmodules` keys

Git reads `path`, `url`, `branch` and `shallow`. The tool adds four keys that git ignores:

| Key               | Meaning                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream`        | URL of the original project the fork tracks                                                                                                                      |
| `upstream-branch` | its branch (default: the remote `HEAD`)                                                                                                                          |
| `sparse`          | space-separated cone paths to check out; empty means everything                                                                                                  |
| `sparse-script`   | a script (repository-relative) that owns the fork's sparse set; `sparse` and `sync` run `bun <script>` for that fork and never call `sparse-checkout` themselves |

The pin of a submodule is the gitlink commit of the superproject, never a branch name: `forks.ts pin` changes it.

## Commands

```sh
bun run forks list                         # every submodule: pin, state (absent, present, sparse), upstream
bun run forks status [name..] [--remote]   # worktree vs pin, dirty count; --remote compares the fork and upstream tips
bun run forks sync   <name..|all> [--strategy ff|merge|rebase] [--stage] [--push] [--apply]
bun run forks pin    <name> <sha|tag|branch> [--apply]
bun run forks sparse <name..|all> [path..] [--apply]
```

A name is the `.gitmodules` name, the path, or its last segment (`tailwindcss`). `--json` prints machine output for
`list` and `status`.

- **Plan first.** Every command that changes something prints its git steps and does nothing until `--apply`.
- **No clone for research.** `status --remote` and `pin` resolve refs with one `git ls-remote` per remote, in parallel.
  `pin` on an absent fork writes the gitlink with `git update-index --cacheinfo`; nothing is cloned.
- **`sync`** fetches the upstream branch into an initialised fork (shallow when `shallow = true`) and moves the checkout
  with `--ff-only` (default), `merge` or `rebase`. `--stage` stages the new pointer in the superproject; `--push` pushes
  `HEAD` to the fork's branch only after `merge-base --is-ancestor origin/<branch> HEAD`, never forced. Nothing commits.
  A fork whose `main` mirrors upstream fast-forwards; one that carries patches needs `--strategy merge|rebase`, or its
  patches live on their own branch (Yolo's `main` mirrors upstream, `yolo` holds the patches).
- **`sparse`** runs `git submodule update --init --depth 1 --filter=blob:none` and `sparse-checkout set --cone` with the
  `sparse` paths (or the paths given). Without paths it initialises the whole fork shallowly, and disables the sparse
  checkout only when the fork currently is one. `--check` verifies the set without changing anything.
- **A fork with `sparse-script`** is delegated. `vendor/material-design-icons` holds ~2.1M SVG files (about 5 GB): a cone
  checkout of `symbols/web` hangs git and a plain submodule checkout downloads every blob. Its set is materialised by
  `packages/material-design-icons/scripts/sync-catalogue.ts` (it lists the tree, batch-fetches the wanted blobs and sets an
  exact-path, non-cone sparse set). So `sparse` plans and runs exactly `bun <script>`, `sparse --check` runs
  `bun <script> --check`, paths are refused, an absent fork is refused rather than initialised (initialise it without
  checking files out: `git clone --no-checkout --depth 1 --filter=blob:none <url> <path> && git submodule absorbgitdirs -- <path>`),
  and `sync` runs the script after the merge so the files the new commit adds are materialised.
- **Blobless fetches.** `sync` fetches with `--filter=blob:none` whenever the fork is partial or sparse (a `sparse` set, a
  `sparse-script`, `remote.origin.promisor` or `core.sparseCheckout`): a fetch from the new `upstream` remote carries no
  filter of its own and would otherwise download every blob.

## Typical flows

```sh
bun run forks status --remote                      # which forks are behind their upstream
bun run forks sparse material-design-icons --apply # run the catalogue script (symbols are batch-fetched, exact-path sparse set)
bun run forks sparse material-design-icons --check # verify the catalogue is materialised, read-only
bun run forks sync material-web --apply --stage    # fast-forward to upstream, stage the pointer
git commit -m "chore: bump material-web"           # the commit stays with the owner
bun run forks pin tailwindcss v4.3.3 --apply       # pin to a tag without cloning
```

The commit that records a new pointer, and the pointers in aphrody, yolo and iecode that follow it, stay manual:
fetch, check ancestry (`git merge-base --is-ancestor origin/<branch> HEAD`), then push.

## Tests

`scripts/forks.test.ts` parses `.gitmodules` (including the real one, and asserts the Material Symbols fork is delegated and
never gets a cone or `sparse-checkout disable`) and runs `status`, `status --remote`, `sync`, `pin` and `sparse` against
throwaway local repositories (an upstream, a fork and a superproject with a submodule, plus a stub delegate script), so the
git behaviour is exercised without the network or the real forks.
