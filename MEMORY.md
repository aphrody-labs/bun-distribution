# Project decisions and session evidence

## Shared app asset store — 2026-10-14

Moved the only shared asset inputs from the retired Bun Libraries checkout to
the Bun OS owner's canonical `.local/assets/`: `manifest.json` (SHA-256
`36a1b825dfeb20e209f022d65f928db8510cd1035cfaf746cbf29e480625a4bc`) and
`reference.json` (SHA-256
`f6c0f6e9a332839e95fb403a7c9eb5eab3343b6529ae39da834a3e8a8754cda1`). Bun
parsed both files after the same-volume move and verified their hashes; the old
asset directory is absent. The Bun OS build/docs already resolve the reference
from this owner path. No app build or tests ran.

## FilmCraft Windows artifact ownership — 2026-10-14

Moved the existing Windows video artifact, its report and runtime pin from the
retired Bun Libraries local output into Bun OS `.local/apps/bun-os/`. Updated
the Bun OS build report and shared build receipt to the new owner path. The
212,555,776-byte executable retained SHA-256
`3882d6b68c65cb54861e786d2dbd2e1976ffb81d52ebc8232c2b1c32e5990691`; Bun
parsed both receipts and verified the path and artifact identity. Its pinned
runtime is `2ae8fc65fba1d05c423a2433b1195835109942b6`; the receipt still marks
app behavior and deployment false. No build or tests ran.

## Runtime source preflight — 2026-10-13

- The distribution plan now inspects Bun's selected checkout with bounded Git
  calls from the shared process owner. It reports the lock pin, checkout HEAD,
  cleanliness, pin match and whether a runtime build is eligible.
- The observed lock is `c209b95e`; the selected checkout was `4958106d`, dirty,
  so the plan reports `eligible: false`. No runtime build was started from this
  checkout. This is a dated observation; concurrent Bun work remains protected.
- Native Bun typecheck passed on 91 files, lint and format passed. No tests ran.

## Material source and checkout alignment — 2026-10-13

- Advanced Bun OS's Material export pin from `1e65a503` to the current owner
  revision `e858361d`. The canonical M3 package is `393d3970`; both its nested
  and top-level theme references resolve to the same `aphrody-m3-os-themes`
  commit `27b36bd3`. The source lock now records 84 mounts, 77 unique
  repository/revision pairs and 75 gitlinks.
- `runtimeCheckout()` now prefers the workspace path when a stale configured
  alias resolves to that same physical checkout; a distinct explicit checkout
  still wins. The full Windows plan resolves `C:\src\bun` and Material at
  `e858361d`.
- The distribution plan validated all 84 source entries. Native Bun typecheck
  passed on 91 files, lint and format passed. No tests or builds were run.

## Shared quality owner, 2026-10-13

- Bun Libraries commit 89731c4 aligns its check/lint/format runner with the
  shared bounded process owner and removes the separate `doctor` phase from the
  quality aggregate. Its native check passed: 60-file typecheck, lint and format.
  The gate exposed formatter drift in `packages/workspace/src/assets.ts`; native
  `bun fmt` corrected it in the same focused batch.
- Bun OS consumes Bun Libraries as a local workspace dependency. Its native
  check passed after the library update: 35-file typecheck, lint and format.
  Bun Libraries main is pushed at 89731c4; no tests or builds were run.

## Shared check command names, 2026-10-13

Bun OS `scripts/quality.ts` invokes `typecheck`, `lint` and `format:check`,
matching Bun Libraries. Its package manifest exposes `lint`, `format` and
`format:check` over OS-owned paths. Native `bun run check` passed: typecheck on
91 files, lint and format. Root Cargo metadata resolved `craft-fonts` and
`craft-fonts-tests`; `cargo check --locked` passed on Windows. Tests were not
run. The batch joins the active Bun OS merge and awaits its integration commit.
## Workspace fusion, 2026-10-13

- The selected Aphrody checkout is C:/src/aphrody. On 2026-10-13 it contains
  concurrent modified and untracked work and is one commit ahead of origin; do
  not reset or relocate it. A distinct C:/aphrody directory containing `var`
  remains and its ACL owner is BUILTIN Administrators. The selected checkout's
  .git owner is also BUILTIN Administrators; SetOwner by aphro was denied.
- A fresh 2026-10-13 process inventory found no Aphrody-named processes. The
  Aphrody MCP HTTP and hub-tunnel scheduled tasks are disabled. Other Omar and
  protected audit tasks remain enabled. Do not claim the stale former directory
  was emptied or its ACL corrected. Provider stores and authentication remain
  protected.
- C:/src/bun is temporarily a junction to C:/bun during the concurrent exclusive
  Bun Git batch. This preserves sibling Cargo dependencies; it is not a physical
  Bun relocation or completed workspace consolidation.
- C:/bun remains the physical Bun worktree; C:/src/bun resolves through a
  junction. The 2026-10-13 audit found active Bun video and episode-studio
  processes, attached worktrees, an ahead commit and untracked video work. Bun
  path dependencies under Aphrody still resolve through the junction, so removal
  or physical relocation requires a separate consumer/path migration after those
  active jobs release the checkout.
- Bun Libraries main 8ece107 owns bounded process lifetime, raw output callbacks,
  PID callbacks, shared output limits and streamed SHA-256 with exact file length.
  Distribution and both Ubuntu/native-target factories now import those owners
  instead of implementing their own subprocess lifecycle and streaming hashes.
- Bun OS app planning now reads the pinned Bun Libraries capability configuration
  for 14 native application hostnames. The shared owner emits `app-<capability>`
  as canonical host and retains each library name as a DNS alias; no Cloudflare
  records were changed. The standalone compiler's child process, deadline, output
  cap, PID receipt and logs also route through the shared Bun Libraries process API.
- Native library builds now delegate to Bun Libraries' `scripts/build-apps.ts`
  and `@aphrody/bun-artifacts`; APT and the desktop server keep their separate
  distribution entrypoint builds. Filmcraft built for Windows x64 from capability
  `video`: PE x64, 212555776 bytes, SHA-256
  `3882d6b68c65cb54861e786d2dbd2e1976ffb81d52ebc8232c2b1c32e5990691`;
  extraction doctor qualified. Native execution, app behavior, public asset
  delivery and deployment remain unqualified. The adapter verifies SDK owner,
  manifest identity, source revision, runtime pin, host, target and artifact hash.
- The delegated app inventory exposed ArtCraft pinned to a stale revision and
  an obsolete `artcraft_client` without a binary. It now matches Bun Libraries'
  pinned `artcraft_router` and `artcraft-cli` at revision 9c4ed82a.
- Bun Libraries hostname owner is published at 980caaf; Bun OS consumer mapping is
  published at 8b2a148. A native filmcraft plan resolved both video hostnames and
  correctly stayed blocked because no native backend artifact receipt was qualified.
- Native bun check passed for 59 library and 30 distribution files. Scoped native
  lint/format and git diff whitespace gates passed. No tests, remote factory
  execution, desktop launch or deployed app qualification were performed here.
- Bun OS commit ce0fbb0ba3dc048ebb0add00f78206050b7ca36b delegates standalone
  compilation to Bun Libraries' `@aphrody/bun-artifacts/compiler`. Plans record
  the Bun Libraries checkout/revision and unchanged compiler source SHA-256;
  the compile receipt and release staging carry the pin. Distribution input
  policy, native contracts, source proofs, ABI checks, locks and receipts remain
  in Bun OS. Bun OS native check (36 files), lint and format passed; commit was
  pushed and verified on origin/os. An APT Windows plan reported compiler
  revision 090786e140523ce4faf66038785dca45a209207b and source hash
  5162f75486c6ee7097a1a229561b2f04fd319826b92dcae3aa7fc1feb8a3b3ad, but stayed
  blocked by the configured runtime snapshot checksum mismatch. No app binary
  was built or executed.
- Bun OS commit f98c0bb3f4894f5cdf76f064a7ad1b5b1f2c486c routes Ubuntu source APT/GPG commands and the exclusive
  `flock` build re-entry through Bun Libraries' `@aphrody/bun-workspace/process`.
  Streamed logs, captured output for parsing, PID receipts, finite deadlines,
  output limits, and owned process-tree cleanup are retained. The long-running
  Docker engine remains with its dedicated service-lifetime receipt. Native
  Bun OS check (35 files), lint, format, and `plan apt` passed; the plan remains
  blocked by the runtime checksum mismatch. No factory build or tests ran.
- Bun OS commit ce9bb1448313078d15b96efde6c109572e8d061e routes bounded
  source-export Git metadata commands through the same Bun Libraries process
  owner. The one MiB combined output ceiling, two-minute deadline, cancellation,
  strict stdout decoding and silent stderr behavior remain; streaming Git tree
  and archive commands remain with Bun OS. Full native check, lint and format
  passed. No export, build or tests ran.
- A live Cloudflare MCP readback on 2026-10-13 found 49 `aphrody.app` DNS
  records, 14 canonical app Worker routes, and 18 enabled Worker custom domains:
  the 14 library aliases, APT, desktop, apex and `www`. The `video` hostname
  remains R2. HTTPS HEAD returned 200 for the apex, all canonical app hosts,
  aliases, APT and desktop; `www` returned 301. `docs/APP-DOMAINS.md` now
  supersedes its earlier 12/14 response snapshot. HTTP status is routing evidence
  only; application readiness remains unqualified. No Cloudflare state changed.

## Owners and execution

- The selected distribution checkout was isolated from the canonical Bun runtime.
  The owner moved our distribution and APT checkouts into the selected C:/src
  layout after all agents paused local writes. Material is a separate owner.
  Runtime discovery still resolves the actual installed executable and checkout.
- Project documentation is English; the owner requested French user replies.
  Follow Linux, Debian, COSMIC and Bun conventions and native Bun orchestration.
  No workstation WSL was started.
- Provider authentication, raw sessions, cookies, datasets, databases, model
  weights and protected .local stores remain isolated. No provider synchronization
  or workstation episode deletion was performed by our factory/app/domain tasks.
- The latest request authorizes accurate reporting and owned consolidation
  commits/pushes. It does not resume unrelated earlier convergence work.
  New heavy jobs/local cleanup are subject to the current coordination hold.

## Source topology and runtime

- The consolidation evidence snapshot has nine source roots, 83 mounts,
  77 repository/revision pairs and 74 gitlinks. Repeated repositories with
  different revisions retain separate source topology.
- The original four-root snapshot was 78 mounts and 71 revision pairs.
  Later Linux/WSL/WSLg/kernel/APT roots and the libcosmic OS pin expanded it.
- The locked Bun source is c209b95eb0dcc964745f4684f127abb83cbe2697.
  Selected Windows Bun.version is 1.4.4; Bun.revision is
  2ae8fc65fba1d05c423a2433b1195835109942b6. Its native banner identifies the
  development canary. The reported release URL does not authenticate an archive
  or prove a build from the locked source.
- Material/os final consolidation 1e65a503420e4a8962b8ceaa18819eedbc280454
  was normally pushed and independently checked by remote ref. The source lock
  now pins that OS revision. Earlier ce47e50324ce4053c4fcd08be59db55254e231f7
  remains the source of the qualified public scalar WASM artifact.
- libcosmic/os is pinned at 7f715bc5d2d383a070fd8c760aa52c5627df96b6.
  COSMIC epoch retains its independently pinned children.
- The official APT GitHub mirror was archived. Our APT fork main was
  fast-forwarded from live Salsa to 745fc126218c7cb3df48b22bbc7c7098fa2f7966;
  the normal push and remote ref were verified. Ubuntu apt 3.2.0 source
  provenance remains separate.
- Source export is consolidated under exportPinnedSources. Code gates cover
  topology, committed files, LFS, protected roots, bounds and capacity checks.
  No complete all-source export or LFS materialization receipt exists.
- An automatic review rejected recursive removal of the transient icons
  metadata with “blocked by policy”. No bypass occurred; that read-only input
  remains in ignored out/source-metadata/.

## Material correction stages

- Initial OS-local libm3/scalar ABI 1 was a duplicated baseline contract. Its
  2061-byte artifact does not qualify the corrected owner and is superseded.
- libm3, libm3-wasm and the typed Bun loader moved into Material.
  The existing native token engine owns HCT/CAM16, nine variants, 49 roles,
  typography, shapes, motion, state and five adaptive breakpoints.
  Native role order is unified through the no_std role owner.
- Corrected no_std/std and Windows COSMIC adapters compiled. Native dynamic
  WASM ABI 2 built from ce47e503 to 113528 bytes, SHA256
  c1abee38ea03c33b8150c14ef987906759182a6fd693c636b960922962c69ed8.
  It executed with no host imports; green Primary changed ff65558f to ff1f6a4e.
  Widths 599/840/1200 returned bar/collapsed/expanded rail.
- The richer existing M3 controls were transferred from clean Aphrody source
  96e732f1c17591389e5bb6d2dc51cb9596edff72 into Material/crates/m3.
  The transfer receipt preserves original and current file hashes; 19 of 23
  Rust inputs were normalized to upstream default rustfmt. Initial compile
  gates preceded formatting; root later rechecked the normalized integration.
  No behavior tests or displayed GUI were run.
- libm3 now re-exports existing components, accessibility, forms, focus,
  keyboard and composition under std. Root's later cached std/no_std checks
  passed in 3.02/0.47 seconds; the COSMIC/MSVC facade check passed in 68 seconds.
  The final normalized native CPU/no-native/COSMIC/WASM gates passed in
  4.68/1.74/0.88/4.62 seconds. Complete metadata has 217 packages; the earlier
  target-filtered graph had 197. Both resolve one local token 1.4.4 owner.
  Material/docs/native-consolidation-2026-10-13.json records 79 source hashes.
- The original token consumer transition/publication is incomplete. A local
  token package exists, but registry publisher authentication and package
  gates were not established. Original clean inputs remain preserved until
  the source/consumer transition qualifies.
- Web dynamic-color/MCU classic/HCT binding migration, complete component
  coverage, displayed GUI, complete desktop and final facade WASM qualification
  remain open.

## Ubuntu factory and cleanup

- Direct VPS APT retrieval authenticated signed Ubuntu InRelease, Sources and
  every DSC/tar SHA256 using isolated lists/cache/tmp on the build filesystem.
  Sources extracted: apt 3.2.0, dpkg 1.23.7ubuntu1, livecd-rootfs 26.04.35.
  Missing detached developer keys for dpkg/livecd-rootfs were recorded; archive
  authentication remained verified.
- Guarded remote cleanup observed 50,080,063,488 bytes reclaimed across 12
  disposable classes, then stopped. No services/processes, Docker images,
  containers or volumes were deleted by that batch. Active restore and factory
  sources were excluded. Measurements credit per-action positive df changes,
  not concurrent restore writes or a promised permanent free-space value.
- A dedicated build-disk Docker engine built a real Ubuntu 26.04.1 toolchain
  image with glibc 2.43, sbuild/mmdebstrap/uidmap and image recipe tools.
  The global Docker daemon and host package state were preserved.
- A clean sbuild unshare chroot produced livecd-rootfs 26.04.35 amd64:
  148762 bytes, SHA256
  7e12304e4bdcbd33526e28d7b6c1efa6e06b334a474bb58b3be476c60a89a836.
  Build options were parallel=2 nocheck. /dev/console and /proc namespace
  limitations were recorded; this is a DEB build, not a distribution rootfs
  or complete OS image.

## Applications, packages and cloud

- One app compiler owns Bun.build/runtime snapshots/embedded files and reuses
  the existing R2/authentication, digest and ABI owners. The APT builder is
  a thin adapter with an actual native version qualifier.
- Final Windows apt.exe from the consolidated source lock/catalog is PE64 x64,
  171469824 bytes, SHA256
  43cacda8663021aa0640297978ef600b0d43bf8fe715d04a0f5464ee96bb2fbd.
  It supersedes the earlier 994dd5f2 artifact.
  It executed its version contract, inspected 926 authenticated APT source
  archive entries and converted the source DSC plus a real MSYS2 zlib package.
  Native libapt installation/package transactions remain absent.
- The consolidated apt.exe object was conditionally published under its SHA256
  on dist.aphrody.app. Public HTTPS returned 200, exact bytes and SHA256, with
  immutable one-year caching. Its matching WinGet installer URL is now available.
- The original zlib1.dll bytes are preserved: 127291 bytes, PE64 x64 library,
  SHA256 11cd91171765cd65f1c3362e3df67e5f5a618a6b88c8cdec899b802eaf1c7b0d.
  Publisher archive SHA matched; detached signature and DLL runtime execution
  were not qualified. Native WinGet validated the portable APT manifest.
- XZ/bzip2 source members require an explicitly selected native 7-Zip decoder.
  Gzip and bounded Zstandard use runtime APIs. Decoder dependency closure is
  distinct from standalone Bun executable qualification.
- Cloudflare MCP created all 16 app domains on the existing aphrody-app Worker.
  Every domain/DNS record was read back; public DNS resolved and HTTPS returned
  200 for each. Homepage/www and assets/dist ownership remained unchanged.
  No Worker code was uploaded and native apps remain undeployed.
- The public Material ABI 2 WASM object was uploaded once to
  assets.aphrody.app/objects/sha256/<digest>, verified by SHA256, served HTTP 200,
  and re-uploaded conditionally with created=false. Generic app asset pipelines
  do not prove that all app asset catalogs are uploaded.
- Komodo/FerretDB/PostgreSQL DocumentDB/Forgejo/Runner are a prepared profile with
  six immutable image pins and static Compose validation. No deployment contexts,
  authenticated services, forge registration or runner jobs were qualified.

The [session report](docs/SESSION-REPORT-2026-10-13.md) holds exact artifact
and receipt references. Consolidation commit identities belong to Git log.
The full OS objective, performance measurements and 9937-389B remain incomplete.

The OS source consolidation was committed/pushed normally at
2e413aa6d9c9f5cd6eeb6773c7b903c3929b3edb; the remote os ref was independently
read back. The final report update records that delivery and the public APT
artifact. Material/os 1e65a503 is independently published. Author identity is
aphrody-dev <contact@aphrody.com>. Concurrent submodule work remained unstaged.
## Shared asset publication owner, 2026-10-13

- Bun Libraries `@aphrody/bun-workspace/assets` now exposes `publishContentObject`: a 256 MiB bounded content hash, content-addressed key validation, conditional `If-None-Match` PUT, immutable cache headers, and streamed remote checksum verification. The font planner retains its 128 MiB limit.
- Bun OS `infra/assets.ts` delegates upload and verification while preserving its scoped app inventory, plan receipt, `objects/sha256/` key and configured public asset origin. Native check, lint and format passed in Bun OS and Bun Libraries root. No tests or live R2 operations were run.
- Bun Libraries commits `b21ee14`, `bf91d0b`, `5f43bb9`, `774e4c9` are on `main`; consumer commit `87d101c` is on Bun OS `os`.

## Deployment ownership, 2026-10-13

- Bun OS `infra/apps.json` is the distribution build/asset inventory. Bun Libraries owns the 14 library capability IDs and hostname mapping; Aphrody Infra owns host services, `git`/`deploy` routes, Compose and native app activation.
- Removed Bun OS's prepared-not-deployed Forgejo/FerretDB profile and Compose duplicate after confirming they had no code consumers. The dated session report retains the profile summary; exact pins remain in the pre-removal Git revision. No host, service or DNS state changed.

---

# Project decisions

## App hostname ownership

- `packages/workspace/src/capabilities.ts` is the canonical mapping from each
  library capability to `app-<capability>.aphrody.app`, with the library name
  retained as an alias. Bun OS consumes this mapping when planning all 14
  library application builds; those duplicate hostname values were removed
  from its `infra/apps.json`. APT and the Bun Libraries desktop keep their own
  product-specific hosts. Existing Cloudflare records and routes were not changed.

## Cloudflare inventory reconciliation

- Read-only Cloudflare API inventory confirmed 14 proxied `app-*` A records,
  plus proxied AAAA records for `apt.aphrody.app` and `desktop.aphrody.app`.
  The former `infra/cloudflare.json` snapshot recorded both product hosts and
  labeled `51.77.147.152` as the IPv4 origin. No DNS records or Worker routes
  changed.
- 2026-10-13 reconciliation: a fresh Cloudflare MCP inventory returned 49
  `aphrody.app` records. The Libraries JSON was an unused 18-record partial
  snapshot, omitted existing library aliases, and named Aphrody Infra as owner.
  It was removed; Cloudflare remains live DNS state, Aphrody Infra owns routes
  and deployment policy, and `capabilities.ts` owns library app host derivation.
  No live records or routes were changed.

- Created in the selected C:\src workspace on 2026-10-13.
- Authored text is concise English. Identity belongs to Aphrody and Bun.
- Imported sources are libraries. The shell exposes capabilities and headless
  CLI inspection, without launching upstream branded GUIs.
- Runtime: Bun 1.4.4 at 2ae8fc65fba1d05c423a2433b1195835109942b6.
- SDK: published Bun commit 939c835adf6479bc1014da3843cda4ae29851dbd.
- Preserve independent Cargo workspaces and dependency revisions.
- Provider authentication and raw sessions remain in isolated stores.
- Video is the current priority. Reuse the native source CLI and Bun.Video;
  no codec implementation or FFmpeg subprocess belongs in this adapter.
- FilmCraft schema 15 uses signed i64 ticks and unsigned u64 IDs. Preserve
  integer precision across JSON rather than routing them through unsafe Numbers.
- The installed Bun revision currently lacks Bun.Video. The parallel native
  owner is replacing the optional media provider; this batch leaves it untouched.
- Quality gates use native bun check, bun lint and bun fmt. The formatter config
  is bun-format.json; external checker/linter/formatter packages are removed.
- Aggressive n2b changes require review: embedded host scripts retain their own
  runtime, and Buffer or callback rewrites must preserve their actual contract.
- Media export uses a fresh destination directory because native formats derive
  sibling and sequence filenames. Failed operations retain structured results.
- Paths remain checkout-relative under the selected C:\src workspace. Native
  owners are resolved from live tools and configuration after workspace changes.

## Unified workspace integration, 2026-10-13

- Bun OS and Bun Libraries were merged into the `os` branch at C:/src/bun-os.
  The 16 library repositories and Bun runtime remain revision-pinned Git
  submodules, preserving their history and license notices.
- The root Bun workspace includes the OS package converter, shared workspace,
  video and artifacts packages, and desktop app. One root `bun.lock` was
  regenerated with Bun 1.4.4. `bun run check` passed: typecheck covered 89
  files, then native lint and format checks completed successfully.
- `bun run setup` initializes root submodules and uses a frozen root Bun install.
  Recursive M3 asset checkout exhausted the workstation's free disk; the setup
  was changed to leave nested pinned submodules lazy. The failed Material icon
  checkout remains deinitialized; its locked gitlink was not changed.
- `.cargo/config.toml` routes Cargo outputs/install root to the shared root
  directories, but the imported repositories still declare independent Cargo
  workspaces. A single Cargo workspace is not yet delivered.
- The root license applies to first-party files. Imported projects retain their
  own license and notice files. Do not remove source submodules until consumers,
  histories, and license files have been migrated and verified.
