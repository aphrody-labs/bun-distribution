# Session report

2026-10-13. Selected checkout: `bun-libraries` in the reorganized native Windows
workspace. Authored identity and text are Aphrody / Bun and concise English.

## Delivered source

The monorepo contains 16 independent open source library forks and one pinned
Bun SDK submodule. Library histories, Cargo workspaces, upstream identifiers,
licenses and notices are preserved. The Aphrody shell exposes 14 application
capabilities using Bun Tauri v3 / CEF source. The imported historical shell
remains a Tauri v2 source reference.

The source doctor now inventories actual tracked implementations, workspace
members and explicit Rust targets. It finds **423 Cargo packages, 11,528 Rust
files and 1,659 TypeScript files**. All declared members and explicit targets
exist. This replaces the earlier catalog-only view; it does not establish that
every engine, GUI or provider works.

| Application       | Library owner            | Qualification                                      |
| ----------------- | ------------------------ | -------------------------------------------------- |
| Video             | FilmCraft                | Windows native CLI; Linux standalone executable    |
| Generation        | Existing Artcraft router | Linux standalone executable and offline operations |
| Images            | Photocraft               | Source present; native app not built               |
| Vectors           | Vectorcraft              | Source present; native app not built               |
| Compositing       | Effectcraft              | Source present; native app not built               |
| Photo processing  | Lightcraft               | Source present; native app not built               |
| PDF               | PDFcraft                 | Source present; native app not built               |
| Documents         | Wordcraft                | Source present; native app not built               |
| Audio             | Soundcraft               | Source present; native app not built               |
| Layout            | Designcraft              | Source present; native app not built               |
| CAD               | CADcraft                 | Source present; native app not built               |
| Slides            | Deckcraft                | Source present; native app not built               |
| Tables            | Gridcraft                | Source present; native app not built               |
| Interface layouts | Figcraft                 | Source present; native app not built               |

Craft libraries and fonts remain shared library owners rather than separate apps.
The root creates no replacement Rust crate for their existing implementations.

## Consolidation and tooling

The workspace owns app IDs, source pins, checkout/binary discovery, runtime
provenance, streamed SHA-256, child lifetimes, native admission, shared assets and
the app transport. Video translates its domain errors through that process
owner. The Windows wrapper now owns only its admission mutex; its Bun worker
uses the same execution core. Independent Bun source builds retain their own
checkout lock and are coordinated through the active host slot.

The artifact package owns manifests, embedded payloads, extraction and receipt
verification. Native engines are extracted into a digest-addressed real cache
before execution; virtual Bun files are not passed to native process spawning.
Size, hash, path, cancellation and concurrency bounds are enforced. Infra
rechecks staged executable and sidecar files using the same verifier.

Native `bun check`, `bun lint` and `bun fmt` replace external quality commands.
Final Windows source gates pass on **59 authored files**, with 17/17 source pins
clean. The imported frontend passes native check on **1,479 files**, strict lint,
format, frozen install and a Bun build producing **33 artifacts**. The Aphrody
frontend/backend build exposes 16 library capabilities.

Aggressive n2b scanned all 16 library inputs and the SDK. Rewrites were reviewed
and invalid Buffer, callback, mock and browser-host conversions corrected.
The internal Rust scanner now bounds file/report retention, supports explicit
submodule traversal, counts clean files correctly, resolves nested packages and
guards behavior-changing AST rewrites. Its core, CLI and addon Cargo check
passed on Windows. The installed addon remains 0.7.0: the new scanner is
source-qualified, without a freshly built/installed addon.

## Native applications

### Video

The typed adapter reuses the existing project, timeline and export owners. It
preserves signed/unsigned 64-bit JSON integers and timeline ticks, confines
exports to fresh directories, retains failed native results and bounds input,
output, deadlines, cancellation and child cleanup. It adds no copied codec or
FFmpeg subprocess.

The Windows native FilmCraft CLI 0.7.2 passed its locked, serialized MSVC release
build and command inspection. The Linux release build completed in 13m53s.

The Linux x64 **Aphrody Video standalone** is **196,211,384 bytes**. It embeds its
native engine and required notices/resources. From a source-free working
directory, its doctor, native version and **701-command** discovery pass. SHA-256:

`63f4df1f2322937630571de8c8469d03a86d56dc1cd267c0ed802d32c5cb2146`

The canonical artifact verifier also passes. Its pins and digests are in
[`infra/releases/video-linux-x64.json`](../infra/releases/video-linux-x64.json).
The Windows standalone compile was cancelled before an executable existed
when the host reached its disk floor.

### Generation

The existing `artcraft_router` package now exposes `artcraft-cli`; no new crate,
provider engine or model registry was created. Fourteen bounded JSONL methods
cover doctor, discovery, offline drafts, explicit generation and job listing.
Credentials remain caller-supplied through the isolated environment.

Linux locked release check passed in 10m18s and build in 6m26s. The native engine
is **19,181,336 bytes**, SHA-256:

`06e8a4efda4fcfadee002eb1f3357ebcfbba7682adf0d04051039d3940968d03`

Version, doctor, model discovery and offline image draft passed from a source-free
working directory without credentials. Paid provider calls were not made.
Existing upstream Rust deprecation/dead-code warnings remain.

The **Aphrody Generation standalone** is **173,388,472 bytes**, SHA-256:

`2dd04040d666d2a8172b9e66a80477ceaecb33b1cf879473ea29a99a48ba88df`

Its compiled doctor, canonical artifact verifier, native version, 14-method
discovery and offline draft passed from a source-free working directory, with
credentials absent. No Cargo rebuild or paid provider request was needed for
packaging. Pins and digests are in
[`infra/releases/generation-linux-x64.json`](../infra/releases/generation-linux-x64.json).

### Runtime boundary

Earlier Windows standalone artifacts use Bun 1.4.4 revision
`2ae8fc65fba1d05c423a2433b1195835109942b6`. Linux x64 uses separately
qualified Bun 1.4.4 revision `dfde053a3045d6076ad315b6f63160c4ced71513`.
New Windows builds use the selected Aphrody Bun 1.4.4 revision
`c62d01d81506a8b78b1d39b44d17edc81b4a6355`; the local executable reports SHA-256
`f85c2517fc4eca8a4e82c15f3897ae39376ab8b9f338eee1bae5f383cc27a52a`. The
selected runtime exposes `Bun.Video` with `available: true`, decoder `filmcraft`
and backend `system`. API presence and source gates do not qualify media decoding,
codec profiles, output accuracy or old standalone artifacts. The Linux x64
runtime reports no native video provider. The pinned Tauri SDK source is
`939c835adf6479bc1014da3843cda4ae29851dbd`.

## Infrastructure and assets

Cloudflare MCP created **16 proxied DNS records**: the 14 `app-*.aphrody.app`
capability domains, `git.aphrody.app` and `deploy.aphrody.app`. Active R2 domains
were retained. A 16-domain TLS certificate is valid until **2027-01-11**, with
scheduled renewal.

The canonical Aphrody Infra catalogs own **59 services and 36 routes**; source,
Compose and nginx validation passed. The existing VPS app layout hosts:

| Service            | Live qualification                                                            |
| ------------------ | ----------------------------------------------------------------------------- |
| Gitea 28.1.0       | Private admin authenticated; install locked; signup disabled; HTTPS login 200 |
| Komodo 2.3.3       | Rust deployment controller; private admin authenticated; HTTPS 200            |
| Periphery 2.3.3    | Persisted, pinned SPKI keys; connected state `Ok`                             |
| Gitea Runner 5.0.0 | Registered and online; one trusted job; bounded CPU/memory/time               |
| MongoDB 8.0.32     | Private persistent database; official Linux rseq configuration applied        |

Credentials and registration remain in protected host stores. Existing workloads
and DBFR were preserved. Komodo actuates the existing Infra desired state; the
root contains no duplicate host registry or copied Compose stack.

Canonical native app activation is published in the existing Rust Infra owner:
catalog-bound `deploy --stack app`, artifact verification and staging, one shared
systemd template and typed ingress activation. Rust formatting and scoped diff
checks passed. Its VPS Cargo check exited 101 **before compilation** because the
concurrent sibling Bun checkout at `dfde053a…` lacks the required
`packages/web/rust/Cargo.toml`. That checkout was preserved. The installed Infra
CLI is unchanged; no activation was applied, and its single readiness probe
remains unqualified. Fresh HTTPS still observes Video health 503.

The CI workflow uses `builtin:checkout` and explicit Bun commands rather than
JavaScript actions. Initial runs exposed an inaccessible nested SDK repository
and an older image runtime. Checkout now uses configured first-level submodules;
the runtime gate selects the mounted qualified executable explicitly. Native
build workflow admission remains explicit and disabled during active builds.
Gitea [run 5](https://git.aphrody.app/aphrody-labs/bun-libraries/actions/runs/5)
at `c742e3a50f6880897f2aa55135b2986188f230f0` passed all seven source steps:
checkout, exact Linux runtime assertion, frozen install, native check on 57 files,
lint, fmt and the 14-app plan. No Cargo or tests ran in that job. The final local
59-file source gate covers the later verifier/admission additions separately.
All **18/18 private Git mirrors** are complete: root, 16 libraries and SDK.

R2 holds one immutable licensed asset manifest shared by every app:
**17 entries, 16 unique content objects, 41,682,420 bytes**. An alias shares one
SHA-256 object. Public custom-domain HTTPS and exact manifest SHA-256 were verified;
CORS accepts the 14 app origins while retaining existing origins. Manifest:

[Shared assets](https://assets.aphrody.app/manifests/sha256/36a1b825dfeb20e209f022d65f928db8510cd1035cfaf746cbf29e480625a4bc.json).

Some native Rust engines still embed fonts. R2 object deduplication is qualified;
removing every embedded font copy is not complete. Each independent executable
necessarily includes its own runtime and native code.

## Cross-repository owner consolidation — 2026-10-13

The standalone HTTP transport now lives in `@aphrody/bun-app-host`. Its source
imports artifact types, video operations, and process/hash primitives through
package identities rather than relative paths across sibling packages. The
artifact builder consumes this owner. Bun OS consumes the canonical Bun
Libraries workspace APIs through local sibling package dependencies; six
shared implementation modules now forward to that owner.

The Bun OS video adapter matched the Bun Libraries source byte-for-byte. Bun OS
now runs its desktop and video commands through the Bun Libraries package and
retains only typed import forwarders in its former video package directory.
The host denied recursive removal of that verified duplicate directory; the
implementation was replaced with forwarding modules and the canonical README
link was retained. No alternate source implementation remains in those files.

Both native Bun quality aggregates pass: Bun Libraries checks 60 files; Bun OS
checks 108 files. Bun installs in both checkouts pass offline with a frozen
lockfile. No tests, native builds, DNS changes, app activation, or deployment
were run in this consolidation batch. Bun OS now requires and verifies a clean,
explicit Bun Libraries revision pin; each owner commit must advance that pin.

## Runtime owner alignment — 2026-10-13

Bun Libraries and Bun OS now select the same Windows runtime revision,
`c62d01d81506a8b78b1d39b44d17edc81b4a6355`. The local runtime reports
`Bun.Video.available === true`, decoder `filmcraft` and backend `system`. The
canonical video adapter exposes Bun-owned metadata, transformed frame/RGBA,
bounded batch, audio, GIF and MP4 remux operations while FilmCraft retains its
project and timeline contract. Bun OS records the observed executable digest
and verifies the shared Bun Libraries source revision before planning. Media
fixture behavior and the downloaded runtime archive checksum remain unqualified.
Linux selects its separately qualified runtime pin and reports no `Bun.Video`
provider; runtime identity and native feature availability are target-specific.

## Published batches

All owned commits use `aphrody-dev <contact@aphrody.com>`, precise staged paths,
fresh remote ancestry checks and normal pushes.

| Repository       | Published batch                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun libraries    | `7cadab6`: pinned monorepo; `4500d36`: video/native migration; `31d5ef5`: owners and standalone factory; `b5534d6`: verifier, generation pin and admission worker |
| Artcraft         | `f8dae6c`: Bun frontend migration; `9c4ed82`: existing router's native CLI                                                                                        |
| FilmCraft        | `87b8451`: reviewed Bun-native tooling; Rust engine retained upstream source                                                                                      |
| EffectCraft      | `e5beea9`: Bun-native helper tooling                                                                                                                              |
| Bun SDK          | `939c835`: compatible explicit type imports/exports                                                                                                               |
| Bun internal n2b | `f56596e`: bounded scanner/AST guards; `176fa03`: English report labels                                                                                           |
| Aphrody Infra    | `ca161f5`: live control plane; `432af04` and `f9bcd3b`: runner runtime/admission; `9d11aa1`: canonical app activation source                                      |

Detailed migrations, ownership and qualification are recorded in
[migration](migration.md), [owners](owners.md), [artifacts](artifacts.md) and
[control plane](control-plane.md). The reporting commit is recorded in Git history.

## Remaining qualification

- Twelve other native app executables and additional target/architecture builds.
- Public application activation; staged app ingress currently returns 503.
- Installed native Infra app activation binary and its live lifecycle gates.
- Native Bun.Video on these installed runtimes; real media decode/render/export accuracy.
- Windows standalone apps, CEF windows, installers, signing and provider access.
- Fresh internal n2b executable/addon installation and operational scan qualification.
- Removal of embedded native font copies where their owners support external resources.

No tests were added or run by this session. No paid provider calls, WSL startup,
protected-data publication, provider-memory synchronization or force push occurred.
Concurrent native Bun work was preserved. Source publication, built artifacts,
deployed control services and publicly active applications are distinct results.
