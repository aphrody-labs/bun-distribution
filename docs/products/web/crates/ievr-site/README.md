# IEVR HTTP adapter source transfer

The former `nie-site` library moved from NIE at revision
`5714a3344f9190b4af558c79cb44fe804c5c9a74`; its source hashes are in
`nie/docs/SOURCE-TRANSFER-MANIFEST.json`.

`aphrody-site` remains the only active public HTTP server. It exposes the
adapter behind the `ievr` Cargo feature, currently disabled by default. The
adapter still requires game data that was not tracked in NIE and must be
restored from the authorized game source. Route parity, auth and static assets
must be checked before enabling that feature in production. The old `main.rs`
is excluded from Cargo binaries; its startup behavior is migration reference.
Open work is in `nie/PLAN.md`.
