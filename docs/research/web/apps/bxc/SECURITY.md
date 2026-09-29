# Security Policy

## Supported versions

Only the latest published `@aphrody/bxc` release line receives security
fixes. Pin to a tagged release for production use.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub Security Advisories:
<https://github.com/aphrody-code/aphrody-os/security/advisories/new>

Include a description, affected version/commit, reproduction steps, and impact.
We aim to acknowledge within 72 hours.

## Secrets & credentials

- Secret scanning: CI runs `gitleaks` over the full git history with
  `.gitleaks.toml` (upstream rules plus connection-string passwords). Run it
  locally with `gitleaks git -c .gitleaks.toml .` before pushing.
- Credential rotation: releases before 0.9.14 shipped a PostgreSQL password as a
  fallback in `src/db/AphrodyPg.ts` and `src/storage/Dataset.ts`. It is no longer
  in the tree (`APHRODY_PG_URL` / `DATABASE_URL` are now required), but it
  remains in git history (acknowledged in `.gitleaksignore`). Treat it as
  compromised: rotate the `aphrody` role password on every server that used it.
- No credentials are committed to this repository. CI generates its registry
  `.npmrc` at runtime from `${NODE_AUTH_TOKEN}` (GitHub Actions secret); the
  tracked-out `.npmrc` is git-ignored.
- The X / Twitter client (`@aphrody/x`, `rust-bridge/crates/x-client`)
  authenticates with a user-supplied `auth_token` + `ct0` cookie pair resolved
  from a local session file or `X_AUTH_TOKEN` / `X_CT0` environment variables.
  Never commit these values.
- The `WEB_BEARER` constant in the X client is X's public web bundle bearer
  (identical for every browser session) — it is not a personal credential.
