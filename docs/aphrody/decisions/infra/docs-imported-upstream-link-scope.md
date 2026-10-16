# Decision: link and path checks skip declared imported upstream doc trees

Date: 2026-10-02. Owner: `@aphrody/workspace` (`docs-links`).

## Context

`bun run docs:check-links` reported about 2,000 broken local links. Almost
all were in third-party documentation copied into `docs/` from upstream
projects (`docs/*/upstream-*`, discord.js and discordx, Spacedrive,
material-web, Node/Bun pages used by n2b, the Google Antigravity Python SDK).
Their relative links target the upstream site or repository layout, of which
only the documentation was imported. Repairing them would mean either
inventing targets or rewriting upstream text, which `CLAUDE.md` forbids
("do not claim parity from a copy", preserve upstream attribution).

## Decision

- The imported trees are declared in
  [`tools/config/docs/imported-upstream-docs.json`](../../../../tools/aphrody/config/docs/imported-upstream-docs.json),
  one entry per upstream with its source, `include` globs and `except` globs.
  No per-file ad hoc exclusion is used.
- `docs-links` skips local-link and backtick-path checks for files matching
  a declared tree and prints the skipped document count per tree.
- First-party additions inside an imported tree stay checked through
  `except` (for example `discord/packages/aphrody-messaging` and
  `material-web/migration`).
- First-party documents are checked in full. `docs-links` also flags inline
  code spans naming a repository path (first segment exists at the root, no
  whitespace, globs or placeholders) that does not exist. (removed import receipt)
  and `docs/plans/**/archive/**` are historical evidence and are exempt from
  that path check only.

## Consequences

A new upstream documentation import must add an entry to the config instead of
suppressing findings. Removing an entry re-enables full checking for that tree.
