# Upstream: `aphrody-ai` messaging / Discord

> Historical source references (2026-10-07): links to removed modules use verified Git revisions. These records do not establish a current CLI route or installed capability.

Scope reviewed: `aphrody-ai` at its local `main` checkout (clean apart from an existing modified `thirdparty/codex` submodule marker). This report describes source contracts; it does not claim current deployment state. No credential values were read.

## Architecture and entry points

- **Crate:** `crates/ai/messaging/Cargo.toml` (not in repo) (retired source path; retained as historical evidence), package `aphrody-messaging` version `1.0.0-canary`, unpublished workspace crate. `src/lib.rs` houses outbound-only `Connector`s and bidirectional channels in `channels` (Discord is the latter).
- **Shared contract:** [`src/channels/mod.rs`](https://github.com/aphrody-labs/aphrody/blob/4d258700316af92c6f358902c60df130d8f60edf/crates/ai/messaging/src/channels/mod.rs) defines `MessagingChannel` and common `MessageRef`, `InboundMessage`, `Attachment`, `RoomInfo`, `RoomKind`, and `ChannelError` types. The trait covers text send, file send, inbox stream, and room enumeration; it is async, `Send + Sync`, and not object-safe because of its opaque stream return type.
- **Discord implementation:** [`src/channels/discord.rs`](https://github.com/aphrody-labs/aphrody/blob/4d258700316af92c6f358902c60df130d8f60edf/crates/ai/messaging/src/channels/discord.rs), `DiscordChannel`; REST API v10 only. Constructor: `new(token)` or `from_env()`. `channels/mod.rs` exports `discord`.
- **CLI notify:** `crates/infra/aphrody-command/src/lib.rs` declares the `notify` channel selector and command surface; `crates/infra/aphrody-command/src/commands.rs` dispatches to `DiscordChannel`. A room argument takes precedence over the environment fallback. A room written `@<user-id>` invokes `open_dm` before sending. Text is sent first; each requested attachment is then sent as a separate message. Success output is `channel_id message_id room`.
- **Live agent:** [`crates/infra/aphrody-command/src/agent_cmd.rs` (not in repo) (retired source path; retained as historical evidence)](https://github.com/aphrody-labs/aphrody/blob/4d258700316af92c6f358902c60df130d8f60edf/crates/infra/aphrody-command/src/agent_cmd.rs) runs `aphrody hermes --channel discord` against `MessagingChannel`: inbox events go through chat/optional voice processing and replies use the channel sink. `--trigger` can filter inbound text; without a trigger it processes all eligible input. `--simulate` avoids live channel construction. The CLI uses the same `DISCORD_BOT_TOKEN` key.
- **Internal dependency path:** `crates/infra/aphrody/Cargo.toml` depends on workspace `aphrody-messaging`; root `Cargo.toml` maps it to `crates/ai/messaging` (not in repo) (retired source path; retained as historical evidence) at `1.0.0-canary`. `aphrody-agent-home` provides agent-home/templates, not this REST adapter.

## Discord behavior and contracts

- API root is `https://discord.com/api/v10/`; requests carry `Authorization: Bot <token>` and a DiscordBot user agent.
- `send_text(room, text)` posts `{content}` to `POST /channels/{room}/messages`; returns native message ID, returned channel ID as room, and channel ID `discord`.
- `send_file(room, path, mime)` reads the local file and posts multipart `payload_json` plus `files[0]`; attachment uploads are separate from text sends.
- `open_dm(user_id)` posts `recipient_id` to `POST /users/@me/channels` and returns the DM channel ID. Caller needs a shared guild and the recipient must allow DMs.
- `rooms()` gets `/users/@me/guilds`, then `/guilds/{guild_id}/channels`; failures listing an individual guild's channels are logged and skipped. Bot DM listing is intentionally omitted. Discord channel types map DM/group DM/threads/guild channels to the common `RoomKind`; unsupported types map to `Other`.
- `stream_inbox()` first enumerates rooms, then polls only `Channel` and `Thread` rooms once per second using `GET /channels/{id}/messages?after=<snowflake>&limit=100`. It reverses Discord's newest-first response and advances a per-room cursor. HTTP/API and decode errors during polling are logged and skipped; transport errors can surface through the stream. It does not use the Discord Gateway WebSocket, and the implementation comments identify that as future work. This polling design also means DMs are not included by the room-based inbox stream.
- Required Discord-side access documented in the adapter: `MESSAGE_CONTENT` privileged intent, and `SEND_MESSAGES`, `ATTACH_FILES`, `READ_MESSAGE_HISTORY`, `VIEW_CHANNEL` permissions. Rate-limit bucket adaptation is absent; HTTP failures are represented via shared channel errors (structured platform errors where parseable), and polling logs/skips non-success status.
- Upstream lineage documented in source: port of selected `openclaw/extensions/discord` send, monitor, and lookup runtime APIs. Source comments explicitly describe polling as a fallback.

## Configuration keys (names only)

| Key | Use |
|---|---|
| `DISCORD_BOT_TOKEN` | Required by `DiscordChannel::from_env`; classic bot token, read at construction. |
| `DISCORD_DM_CHANNEL_ID` | `aphrody notify --channel discord` default destination when `--room` is absent/empty. May instead supply `--room @<user-id>` to open a DM. |

Other runtime keys used by Hermes (LLM/STT/TTS) are outside the Discord adapter contract and are not enumerated here.

## Dependency provenance

Declared directly by `aphrody-messaging` (versions inherit the `aphrody-ai/Cargo.toml` workspace catalog unless noted):

| Dependency | Declared version/source | Discord use |
|---|---|---|
| `reqwest` | workspace `0.13`, multipart feature enabled at crate | REST JSON and multipart upload; shared client factory in `aphrody-messaging/src/lib.rs`. |
| `tokio` | workspace `1.52` | async runtime, file read, one-second polling sleep. |
| `serde`, `serde_json` | workspace `1` | Discord wire structs and JSON. |
| `async-trait` | workspace `0.1` | `MessagingChannel` implementation. |
| `futures` | workspace `0.3` | stream contract. |
| `async-stream` | workspace (see root manifest) | polling stream generator. |
| `bytes` | workspace `1` | multipart file bytes. |
| `chrono` | workspace `0.4` with serde | inbound UTC timestamps. |
| `tracing` | workspace `0.1` | polling/room lookup warnings. |
| `url` | workspace `2` | versioned endpoint/query construction. |
| `thiserror` | workspace `2` | shared channel errors. |

No Discord SDK or WebSocket/Gateway client is a dependency of this module. Cargo workspace resolution and `Cargo.lock` determine exact patched versions; the package manifest uses catalog/workspace declarations rather than independently pinning each dependency.

## Useful source references

- Shared contract and types: `crates/ai/messaging/src/channels/mod.rs` (not in repo) (retired source path; retained as historical evidence)
- Discord adapter: `crates/ai/messaging/src/channels/discord.rs` (not in repo) (retired source path; retained as historical evidence)
- CLI command declarations/dispatch: `aphrody-ai/crates/aphrody/src/lib.rs`
- Notify implementation: `aphrody-ai/crates/aphrody/src/commands.rs`
- Hermes channel runtime: `aphrody-ai/crates/aphrody/src/agent_cmd.rs`

## Migration to Aphrody Discord

The Bun-first port lives in [`packages/discord/aphrody-messaging` (not in repo)](../../../../products/discord/packages/aphrody-messaging/README.md): `src/index.ts` maps the Rust channel types and `DiscordChannel` behavior; `package.json` and `tsconfig.json` define the package. `sendText`, `sendFile`, `openDm`, `rooms`, and `streamInbox` preserve the REST v10 routes and shared data concepts. File upload uses Bun's `Bun.file` plus Fetch `FormData`; HTTP uses injectable Fetch. Inbox polling can be cancelled with an `AbortSignal`.

The Rust-only dependency graph is intentionally dropped: there is no Cargo crate, Tokio, `reqwest`, Serde, `async-trait`, `futures`, `bytes`, `chrono`, `tracing`, `url`, or `thiserror` runtime dependency in this package. Native Fetch, URL, FormData, Date, AbortSignal, and Bun file APIs cover those roles. The TypeScript package declares no direct runtime dependencies. It currently ports the Discord channel adapter and common TypeScript channel types; it does not migrate the separate Rust outbound connector stack or CLI commands.
