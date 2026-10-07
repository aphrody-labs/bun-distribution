<!-- SPDX-License-Identifier: Apache-2.0 -->
# First-party plugin marketplace

> Path reconciliation (2026-10-07): `plugins/aphrody/.claude-plugin/marketplace.json` (not in repo) → `plugins/.claude-plugin/marketplace.json`. Original dated observations below retain their historical scope.

The canonical catalog is `.agents/plugins/marketplace.json` (not in repo). It currently
contains the `aphrody` and `yolo` plugins. Generated adapters are written to
`plugins/.claude-plugin/marketplace.json` and the user's agy skills registry.

Run `bun run plugins:sync` after editing a plugin. Use `bun run plugins:watch`
during development to synchronize manifest and skill edits automatically.
The operation preserves existing agy settings and only updates the two
first-party skill entries.

The Codex personal marketplace can consume the canonical file directly; no
credentials are read or changed by the synchronizer.

For GitHub-wide ranking and duplicate detection, run
`bun run github:intelligence`. It uses the authenticated `gh` CLI, writes
`.agents/plugins/github-repository-intelligence.json` (not in repo), and never archives or
deletes repositories.

Run `bun run github:audit` for a redacted account-wide audit of repository
visibility, `aphrody-dev` admin access, packages and gists. Credentials and
secret values are never written to the report.
