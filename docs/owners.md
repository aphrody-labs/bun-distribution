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
| Child lifetime, cancellation and captured output | Workspace `process.ts` | Cargo tools and native video transport |
| Standalone application HTTP transport | `@aphrody/bun-app-host` | Bun Libraries apps and Bun OS distribution |
| Video project, timeline and commands | FilmCraft Rust library | Typed Bun video adapter |
| Media probing, decoding and frame encoding | Bun runtime `Bun.Video` / `Bun.Image` | Bun media consumers |
| Shared Rust primitives | Craft library owners | Native library engines |
| Licensed font sources | Craft font owner | Shared asset manifest and native engines |
| App payload extraction and manifest verification | Artifact package | Standalone Bun apps |
| Hosts, services, boot and deployment authority | Native Aphrody Infra | App deployment adapter and controller |
| Git forge and workflow execution | Deployed forge and runner | First party Bun shell workflows |
| DNS and R2 resources | Cloudflare | Aphrody Infra and app release configuration |

The video process module translates workspace errors into its public video
errors. It has no child management implementation. Captured and discarded
streams share an output cap; interactive build output retains inherited streams.
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
