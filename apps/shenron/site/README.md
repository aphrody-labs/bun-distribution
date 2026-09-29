# Dragon Ball FR site

Next.js site in the Shenron Bun monorepo.

## Development

From the monorepo root:

```sh
bun install --frozen-lockfile
bun run site:dev
```

Next's dev server prints the local URL. On Windows, run `next dev`/`next build`
inside WSL and generate `.env.local` with `bun scripts/dev/local-env.ts env`; see
[`docs/DEV-LOCAL.md`](../../docs/DEV-LOCAL.md). Environment variables are listed in
[`docs/ENV.md`](../../docs/ENV.md). Database and site-specific commands are defined
in this package's `package.json`.

## Build and release

`bun run site:artifact` builds and packages the site outside production. The
`site-artifact` workflow can produce the same attested artifact. Release
promotion, service units, Nginx routes, health probes, and rollback are owned
by `aphrody-infra`; this repository does not deploy directly.
