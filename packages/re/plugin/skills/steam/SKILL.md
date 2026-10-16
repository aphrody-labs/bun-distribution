---
name: steam
description: Index, query and reverse the local Steam install (SQLite), Steam Web API catalogue, userdata/Steam Cloud, and relay game downloads through an SSH host.
---

Use the native Bun CLI `bun packages/re/src/steam/cli.ts <command>` (or MCP tools `steam_*`):

- `scan` indexes install, libraries, appinfo/packageinfo, manifests, PE files, userdata, cloud, logs, registry (whitelist) into `~/.aphrody/db/steam.sqlite`.
- `stats`, `sql "<SELECT>"` query it (read-only).
- `api-sync [--applist]` indexes Web API interfaces/methods/params/endpoints (`STEAM_WEB_API_KEY` for the full list).
- `rea <appid>` runs the RE pipeline on the installed executable; `classify <file>` detects file types.
- `remote-download <appid> --host vps --dest <dir>` installs with steamcmd on the host, pulls with parallel rclone streams.

Never read or quote `config.vdf`, `loginusers.vdf`, `local.vdf`, `ssfn*`, cookies or friend/chat data: only existence, size and date are recorded in `secret_artifact`.
