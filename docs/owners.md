# Owners

One implementation owns each concept. Surfaces bind that implementation and
retain its errors, limits and qualification.

| Concept | Owner | Consumers |
| --- | --- | --- |
| Source pins and library roles | `aphrody.config.json` | Workspace, desktop, app packaging |
| App IDs and presentation | Workspace `capabilities.ts` | Desktop, artifacts, deployment |
| Checkout discovery and native artifact discovery | Workspace | Checkout tools and source adapters |
| Bun provenance | Workspace `runtime.ts` | Tools and compiled app manifests |
| Content digests | Workspace `hash.ts` | App payloads and shared R2 assets |
| Child lifetime, cancellation, interactive signals and captured output | Workspace `process.ts` | Cargo tools, native video transport and standalone app launchers |
| Video project, timeline and commands | FilmCraft Rust library | Typed Bun video adapter |
| Media decoding and encoding | Native Bun.Video owner | Bun media consumers |
| Shared Rust primitives | Craft library owners | Native library engines |
| Licensed font sources | Craft font owner | Shared asset manifest and native engines |
| App payload extraction and manifest verification | Artifact package | Standalone Bun apps |
| Hosts, services, boot and deployment authority | Native Aphrody Infra | App deployment adapter and controller |
| Git forge and workflow execution | Deployed forge and runner | First party Bun shell workflows |
| DNS and R2 desired state | Aphrody Infra | Cloudflare API and app release configuration |
| Live DNS records, proxy and object storage | Cloudflare | Aphrody Infra control and Bun OS asset contracts |
| Distribution profiles, OS images and package conversion | Bun OS | Qualified Bun runtime, APT sources and in-repo artifact packages |
| Debian APT source and package-manager implementation | Official APT fork | Bun OS distro build and conversion adapter |
| M3 tokens, shared components and `libm3` | Material | Aphrody and Bun app UI consumers |
| Product routes, sites and app activation policy | Aphrody Infra | Bun OS app capability manifest |

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
