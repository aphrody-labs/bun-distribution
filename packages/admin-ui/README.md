<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody administration

This package owns the Shenron administration UI inside the canonical M3 tree.
`apps/shenron/site` in the parent Aphrody workspace is its authenticated Next
host: its route files re-export this package; authentication, database access,
server adapters and API endpoints remain under that host's authority. The
package's `@/lib/*` and public component imports resolve through the host's
TypeScript aliases. This is an integrated workspace package, not a standalone
Next application.

The host imports `@aphrody/admin-ui/styles.css` so its Tailwind scanner includes
these sources. Page configuration stays literal in host route adapters to
preserve Next's static route analysis. Server actions and client boundaries are
retained in the canonical modules.

The former bot SPA now redirects to the same authenticated administration. Its
unique audit, logs, account and ticket access controls are included here. Account
requests use the host's server-side Discord OAuth adapter; bearer tokens never
enter this UI. The Dragon Ball visual language remains the host's existing
theme, assets and shared `@shenron/ui` components.

Qualification on 2026-10-05: host TypeScript and Next production compile mode
passed; 22 existing administration contracts and three account authorization
tests passed. Scoped lint has no errors and retains inherited warnings. Full
prerendering, authenticated production interaction and deployment are separate
gates. Parent receipt: `docs/architecture/workspace/MEDIA-ADMIN-UNIFICATION.md`.
