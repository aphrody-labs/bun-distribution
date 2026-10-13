# Owners

One implementation owns each concept. Surfaces bind that implementation and
retain its errors, limits and qualification.

| Concept                                                   | Owner                                                                                 | Consumers                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Source pins and library roles                             | Bun OS `aphrody.config.json` / `sources.lock.json`                                    | Workspace, desktop, app packaging                                                     |
| App IDs, capability labels and presentation               | Bun OS `packages/workspace/src/capabilities.ts`                                       | Desktop, artifacts, deployment                                                        |
| Checkout discovery and native artifact discovery          | Bun OS `packages/workspace/src/runtime.ts`                                            | Checkout tools and source adapters                                                    |
| Bun provenance and selected compiler                      | Bun OS `packages/workspace/src/runtime.ts`; runtime source is Bun                     | Tools and compiled app manifests                                                      |
| Content digests and shared asset identity                 | Bun OS `packages/workspace/src/hash.ts` / `assets.ts`                                 | App payloads and shared R2 assets                                                     |
| Child lifetime, cancellation, signals and captured output | Bun OS `packages/workspace/src/process.ts`                                            | Cargo tools, native video transport, factories and standalone launchers               |
| Video project, timeline and commands                      | Bun OS pinned FilmCraft Rust source                                                   | Typed Bun Video adapter; media codecs remain Bun runtime capabilities                 |
| JavaScript runtime, native APIs and Bun.Video             | Bun fork `aphrody-labs/bun`                                                           | Bun OS factories and Aphrody product consumers                                        |
| Shared Rust primitives and native libraries               | Their pinned Craft source owners                                                      | Bun OS library engines                                                                |
| Licensed font sources                                     | Pinned Craft font owner                                                               | Bun OS shared asset manifest and native engines                                       |
| App payload extraction and manifest verification          | Bun OS `packages/bun-artifacts`                                                       | Standalone Bun apps                                                                   |
| Distribution profiles, image assembly and Ubuntu factory  | Bun OS `distribution.json`, `src/distribution.ts`, `factory/`                         | Qualified Bun runtime, APT source and product artifacts                               |
| Package and source conversion                             | Bun OS `packages/package-converter` / `src/apt.ts`                                    | Winget and Bun package outputs; source package identity and license metadata          |
| Debian APT implementation                                 | Official APT fork, pinned by Bun OS                                                   | Bun OS distro build and conversion adapter; no second APT implementation in consumers |
| Hosts, services, boot and deployment authority            | Aphrody Infra in `aphrody`                                                            | Bun OS deployment adapter and controller                                              |
| Git forge and workflow execution                          | Aphrody `tools/config/host/apps/vps/gitea-runner/` and deployed forge/runner          | Bun OS and Bun source workflows                                                       |
| DNS and app hostnames desired state                       | Aphrody `tools/config/cloudflare/` and Cloudflare MCP                                 | Bun OS app-domain/build contracts                                                     |
| Live DNS records, proxy and object storage                | Cloudflare                                                                            | Aphrody Infra control; Bun OS asset contracts                                         |
| Public app IDs, domain aliases and artifact routing       | Aphrody Infra product configuration; Bun OS `docs/APP-DOMAINS.md` is the consumer map | Existing Worker routes and standalone app owners                                      |
| M3 tokens, shared components and `libm3`                  | Material workspace and its pinned crates                                              | Aphrody product surfaces and Bun OS desktop/app-ui consumers                          |
| Native quality commands and formatter policy              | Bun OS `package.json` / `bun-format.json`; runtime quality stays in Bun               | Bun OS owned source only; no duplicate formatter/config in Aphrody                    |
| Product routes, sites and app activation policy           | Aphrody product integration + Aphrody Infra                                           | Bun OS app capability manifest                                                        |

The video process module translates workspace errors into its public video
errors. It has no child management implementation. Captured and discarded
streams share an output cap; interactive children may inherit streams and
forward terminal signals through the shared process owner. The Ubuntu factory's
detached Docker engine is a separate finite service whose launcher receipt owns
its PID, log, socket and data root.
Source adapters use one native binary discovery API and retain their own protocol
and version checks. Compiled apps use verified manifests without Cargo or Git.

The source doctor checks tracked implementation, Cargo workspace members and
native target paths. On 2026-10-13 the 16 library checkouts contain 423 Cargo
packages, 11,528 Rust files and 1,659 TypeScript files. No declared workspace
member or declared library/binary target is missing. Source coverage does not
prove operational support.

Generation still contains unsupported provider branches. Vendor GUI and parsing
code also contains panic placeholders. These source facts are not full app
qualification. Provider state stays in its protected owner stores.

Independent Cargo workspaces retain their histories and package identities.
Do not merge unrelated formats into one engine or copy codec implementations.
The Windows wrapper owns only its native admission mutex. Its worker delegates
argv, streams, deadlines and child teardown to the same workspace process core.
The Bun Cargo source owner retains its own checkout lock; the active host build
slot remains serialized by owner coordination.
Bun OS assembles distribution inputs, images and package conversions; it does
not own a second APT implementation. Package/source conversion and generated
installers must preserve the upstream package identity and license metadata.
Material owns the transferred M3 Rust components and tokens. The nested Bun
M3 source submodule is a remaining consolidation item: audit consumers and source
history before removing it.

Aphrody Infra declares and actuates desired DNS, host, route and app lifecycle
state. Cloudflare's live records/R2 and application health require direct
qualification; a checked-in hostname or successful source build is not live
activation evidence. Bun OS owns app identity, host naming, shared asset
manifests and artifact verification consumed by the Infra adapter.

Repository boundaries are capability boundaries: Bun owns runtime and native
SDK source, Material owns shared UI/framework source, APT owns Debian's package
manager implementation, Bun OS owns distribution assembly and package adapters,
and Aphrody owns product integration plus host control. Consumers pin or import
the owner's interface; they do not copy its implementation. Keep each quality
gate scoped to its owner and record source, build, artifact and deployment
qualification independently.
