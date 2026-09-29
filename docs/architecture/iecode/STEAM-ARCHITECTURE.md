# Steam architecture

Steam integration is split by product ownership: IECODE retains the managed
interop compatibility surface, while the IEVR/Victory Road runtime belongs to
the sibling `nie` repository. `nie` is the authoritative implementation for
Steam acquisition and emulation for that game.

## Selected implementation

- **IEVR depot and CDN access:** select `nie`'s Rust `nie-steam` crate. It
  ports IECODE's `Steam3Session`, depot resolver, token store, downloader, and
  CLI from `SteamKit2` to `steamroom`/`steamroom-client`; it is the most
  faithful community implementation because it preserves the original behavior
  rather than exposing only a general Steamworks wrapper. Its current history
  records the full port in commit `b1e02ccc` and the later emulator convergence
  in `903481c7`.
- **IEVR runtime emulation:** select `nie-steam`'s in-process Steam API
  emulator, connected to `nie-net` for friends, lobbies, and multiplayer. It
  is purpose-built for the game and covers the reverse-engineered Steam entry
  points, unlike generic TypeScript, Rust, or Python bindings.
- **IECODE compatibility:** retain its `SteamKit2` depot layer and its
  hand-written `LibraryImport` boundary until an IECODE consumer is migrated
  and measured. Do not add a parallel Steamworks.NET, `steamworks-ffi-node`,
  `steamworks`, or `steamworks-swig` dependency merely to duplicate
  `nie-steam`.

No binding, source file, or lockfile may include Valve SDK headers, tools, or
credentials. Runtime redistributables and an authorized Steamworks SDK remain
external developer inputs.
