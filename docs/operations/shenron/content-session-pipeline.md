# Persistent content-session pipeline

`shenron-content-session.timer` runs a resumable enrichment session after boot
and then every six hours. Its state is stored atomically in
`data/session-pipeline/latest.json`; it contains no credentials or source body.

Each session imports completed BXC crawl databases into
`public.external_source_records`, optionally refreshes available media readers,
and records coverage for episodes, films, manga and databooks. Existing data is
never cleared when a source is unavailable: the next session retries it.

Run once manually:

```bash
set -a && . ./.env && set +a
bun scripts/ops/run-content-session-pipeline.ts --apply --refresh-players
```

Install on the VPS:

```bash
sudo install -m 0644 deploy/systemd/shenron-content-session.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shenron-content-session.timer
```

The report distinguishes successful, skipped and failed steps. A crawl or
reader source that is unavailable is reported as such; it is not represented as
content that was acquired.
