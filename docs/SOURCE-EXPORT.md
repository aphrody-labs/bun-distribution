# Pinned source export

`factory/source-export.ts` exports the full source mounts in `sources.lock.json`.
It is a library for the factory orchestrator. Import `exportPinnedSources(output,
options)`; running this module alone does not start a download.

The output contains `sources/` and `sources.receipt.json`. A receipt is complete
only after every mount, gitlink, source file and LFS payload has passed its gates.
An unavailable object, unsupported source path, deadline or truncated metadata
produces an incomplete receipt. The caller must refuse packaging that receipt.
`expectedRepositories` records the planned mount count. File counts, byte counts,
the final pointer list and tree hash describe the entire tree only when
`integrityComplete` is true; earlier progress receipts do not claim a completed
filesystem inventory.

## Acquisition and topology

An archive is acquired once per `repository@revision`. Repeated mounts reuse it
and retain their own parent, submodule path and revision. Different revisions
remain separate acquisitions. Archive cache entries are rehashed before reuse.
There is no clone, fetch, checkout, install, source build or execution of source
scripts in this helper.
Local Git commands disable fsmonitor, hooks, pagers and lazy object fetching.
Partial/promisor repositories are refused before object reads, including on
older Git versions that do not implement the lazy-fetch environment gate.

There are two acquisition routes:

- An explicitly configured clean checkout or existing Git object repository.
  Git resolves the exact commit and streams its recursive file/gitlink inventory.
  A private bare view in the export cache reads the existing object store. Its
  `info/attributes` disables `export-ignore` and `export-subst`, so committed
  files are retained without changing the owner's attributes or metadata.
  The extracted file count and gitlinks must match the inventory. This follows
  the [Git archive attribute contract](https://git-scm.com/docs/git-archive#_attributes).
- GitHub commit and recursive Git-tree metadata, followed by the commit's
  codeload archive. Every extracted file and symlink is checked against its Git
  blob SHA-1, size and mode; every expected blob must be present. Truncated trees
  are refused before archive acquisition. The [GitHub tree API](https://docs.github.com/en/rest/git/trees#get-a-tree)
  limits recursive results to 100,000 entries and 7 MB. A large icons tree needs
  a qualified existing local Git repository rather than an assumed complete API
  result. Archives that omit committed files or automatically expand LFS bytes
  fail this route's Git-blob check; use the local Git route and an LFS owner.

The archive SHA-256 records the acquired bytes. It is not a publisher checksum
or a substitute for the commit/tree checks. GitHub compression can change while
the pinned source files remain identical, as described in its
[source archive contract](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives).

## Capacity gate

Provide `estimates` for every distinct `repository@revision` before invoking the
helper. Each estimate contains positive `archiveBytes`, nonnegative
`expandedBytes`, and positive `entries`. Values are safe integer upper bounds.
`expandedBytes` includes the final materialized LFS bytes; `entries` includes
files, directories and symlinks. Measurements belong to the source/factory
owner, using an existing inventory or a previously measured archive. A guessed
small estimate cannot qualify the icons tree.

Before any Git inventory or network acquisition, the helper measures available
bytes and inodes on the output and cache filesystems. The budget includes every
logical mount, one retained archive and an LFS cache per distinct acquisition,
metadata allowance, allocation-block overhead, and reserves. Defaults retain
2 GiB and 100,000 inodes on each filesystem. Windows inode counts are recorded
as `null`, because NTFS allocates file records dynamically; its file-allocation
cost remains in the byte budget. Acquisition and extraction also enforce the
provided upper bounds while streaming.

This gate does not make an icons acquisition cheap. Inventory its archive size,
expanded bytes, file count, destination mount and free inodes before scheduling
it on the VPS. No new icons clone is needed by this helper. Existing metadata,
including metadata whose deletion was review-rejected, is read-only input and
is never cleaned, rewritten or recreated.

## LFS ownership

Pointers follow the [Git LFS specification](https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md):
canonical v1 text, a lowercase SHA-256 OID and an exact byte size. Unknown pointer
extensions remain incomplete because their transformations require an owner
adapter.

A LFS payload can come from:

1. The corresponding regular tracked file in a clean configured checkout whose
   `HEAD` equals the pinned revision. An unsmudged pointer is not accepted as its
   payload.
2. The `lfsOwner(request)` callback, which supplies a bounded readable stream.
   The request carries repository, revision, path, OID, size and cancellation
   signal. The owner must authorize that source object and supply only source
   payloads. The exporter never reads a provider's credential, session, cookie,
   database or model store.

Both routes verify SHA-256 and byte size into a private incoming file. Only then
is the source pointer atomically replaced. Verified LFS objects are reused per
repository/OID. A missing local payload falls back to an explicitly configured
owner. A failure leaves the source pointer and a sanitized issue in the receipt.

`createLfsBatchOwner({ endpoint, headers, allowedDownloadHosts })` supplies the
[Git LFS basic Batch API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md)
adapter. The credentials owner supplies request headers in memory. The adapter
checks the returned OID/size, accepts HTTPS only, requires an exact approved
object hostname, and refuses redirects. Batch authorization is never forwarded
to an object host; only that object's action headers are used. Tokens, signed
URLs, response bodies and subprocess stderr are never logged or stored in
receipts. Inject this callback from the trusted factory orchestrator, rather
than placing secrets in source-export JSON configuration.

## Filesystem and job boundaries

The streaming tar/gzip reader handles Git's regular files, directories,
symlinks, PAX headers and GNU long names. It refuses traversal, `.git` metadata,
special files, hardlinks and unsupported sparse
formats. It retains a symlink's exact target text, including an external target,
and never copies through that link. Source parents and local LFS paths must be
real directories; symbolic ancestors cannot redirect a nested source mount.
Files use normalized Git executable permissions; source directories are
readable by the container's runtime user.

`protectedRoots` adds explicitly isolated inputs to the path guard. The home
`.aphrody`, `.codex` and `.claude` stores and configured `APHRODY_HOME` are also
refused automatically. Committed repository plugin/instruction directories
such as Bun's `.claude` remain source files; isolated home sessions are never
copied. Archive export
reads committed Git objects; it never copies untracked, ignored or working-tree
directories. Clean checks cover tracked files; ignored/generated inputs are
neither included nor deleted. Worktrees with tracked changes are refused.
Cleanliness checks disable external clean/process/smudge filters. A materialized
LFS file reported as modified under that setting is accepted only when its raw
SHA-256 and size match the committed `HEAD` pointer. Custom transformations
cannot make arbitrary changed working files qualify as clean.
Native Windows paths and symlink creation must be supported by that host;
unrepresentable filenames or insufficient symlink privileges remain incomplete.
Executable bits are checked after writing; a filesystem that cannot retain
the required POSIX modes cannot certify an executable source tree. Native
Windows can orchestrate materialization on the qualified SSH/Linux factory.
The helper never starts WSL.

The output uses the same exclusive `.assembling` lock as the current distribution
assembler. The cache has a separate exclusive `.source-export.lock`. Claims
record a PID and nonce and are released only by their owner; existing locks are
not stolen. Do not run two assemblers against one output. Use a fresh output
after a partial source extraction; the entire `sources/` root must initially be
empty, so unrelated pre-existing files cannot be certified. Empty gitlink
directories produced by the current export can receive their pinned child.
Verified archive/LFS cache objects can be
reused. No recursive cleanup or cache pruning is performed. Only a newly created
failed incoming stream file is removed by its creator.

The default job deadline is 30 minutes. Git metadata commands are bounded at
120 seconds, recursive inventories and archive commands at 600 seconds, with
the whole-job signal able to cancel them earlier. Callback waits and streamed
reads obey the whole-job cancellation signal. The factory must also launch its
caller in a bounded background `Bun.spawn` job, retain the live PID/handle and
log paths, and avoid synchronous long shell commands. On the VPS acquire the
shared native `flock -n` heavy lock from the host's qualified factory config;
the current qualified path is `/home/ubuntu/build/locks/heavy.lock`. Keep the
active factory/restore trees and unpushed sources protected.

## Distribution integration

The root owner can replace the body of `assembleSources` with a call to
`exportPinnedSources`. Extend its configuration with the estimates, cache and
protected-root fields; resolve checkout/object-repository paths explicitly.
The helper accepts keys in this order: `repository@revision`, source id,
repository. A configured repeated mount can supply the acquisition for its
matching peers. Put clean worktrees in `checkouts`; put existing bare Git
repositories in `repositories`. A bare repository supplies committed archive
objects, never a working-tree LFS payload.

```ts
import { exportPinnedSources } from "../factory/source-export.ts";

const receipt = await exportPinnedSources(output, {
  lock: await readLock(),
  checkouts: config.checkouts,
  repositories: config.sourceRepositories,
  estimates: config.sourceEstimates,
  cache: config.sourceCache,
  protectedRoots: config.protectedRoots,
  lfsOwner: configuredLfsOwner,
  githubHeaders: configuredGithubHeaders,
});
if (!receipt.complete) throw new Error("Source export incomplete; inspect sources.receipt.json");
return receipt;
```

This snippet belongs in the existing root-owned assembler after extending its
configuration; it is not a standalone job. The current assembler/container files
are not changed by this helper. Retain `stageRuntime`'s exact source-lock and
tree-hash gates. The helper's final tree SHA-256 matches the existing
`container/source-integrity.ts` contract, with cancellation checks added. It
hashes paths, entry types, file bytes and symlink target text; permissions are
not part of that existing hash contract.

Keep the source cache outside the staged Docker context, or add `.source-cache`
to the root-owned `.dockerignore`. Only `sources/` and its complete receipt
belong in the image; cache archives, temporary bare views, credentials and
incomplete outputs do not.

Scoped qualification commands:

```text
bun check factory/source-export.ts --threads=2 --no-pretty
bun lint --deny-warnings factory/source-export.ts
bun fmt --check -c bun-format.json factory/source-export.ts
```

These commands qualify source code only. Full source acquisition, an LFS
provider transfer, tar extraction, Docker packaging and production execution
require their own factory receipts and have not been established by a type or
format check.
