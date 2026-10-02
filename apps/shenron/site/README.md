# Dragon Ball FR site

Next.js site in the Shenron Bun monorepo.

## Development

From the monorepo root:

```sh
bun install --frozen-lockfile
bun --filter @shenron/site dev
```

Next's dev server prints the local URL. This command does not generate `.env.local`.
The previously documented `bun scripts/dev/local-env.ts env` path and `site:dev`
root script are not present in the current manifests. See
[`docs/DEV-LOCAL.md`](../../docs/DEV-LOCAL.md) for the status of the old procedure;
the variable inventory remains in [`docs/ENV.md`](../../docs/ENV.md). Database and
site-specific commands are defined in this package's `package.json`.

## Build and release

`bun run site:artifact` builds and packages the site outside production. The
`site-artifact` workflow can produce the same attested artifact. Release
promotion, service units, Nginx routes, health probes, and rollback are owned
by `aphrody-infra`; this repository does not deploy directly.
