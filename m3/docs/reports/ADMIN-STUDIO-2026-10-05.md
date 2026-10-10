<!-- SPDX-License-Identifier: Apache-2.0 -->
# Administration and Studio consolidation

The canonical administration source now lives in `packages/admin-ui`, with
authenticated Next adapters in the parent Aphrody site. The legacy bot dashboard
redirects to this owner. Audit, logs, signed-in account and ticket access controls
are preserved alongside the site's existing administration pages.

The Aphrody Studio retains its seven sections and the embedded Koharu editor.
Sections have shareable URLs, browser history, keyboard tab navigation and
mounted page state. Legacy `/admin`, `/shenron`, `/manga` and `/koharu` entrypoints
resolve to these sections. Application tabs use one route-title resolver. M3
headers use theme tokens, including the light theme; the site's Dragon Ball
headers remain unchanged.

Evidence on 2026-10-05:

- TypeScript and scoped app-ui lint pass; two route-title tests pass.
- Production app-ui build passes: 641 output files.
- Native Aphrody Web snapshot renders the administration entrypoint.
- Chromium inspection of the actual built bundle passes at 1280×832/light and
  800×560/dark: no horizontal overflow or JavaScript errors, one keyboard tab
  stop, correct titles, working aliases/history, retained input state and URL
  validation. Screenshots were visually inspected.
- The shared admin package passes host TypeScript and Next compile mode; account
  and existing administration contract tests pass. Inherited admin lint warnings
  remain recorded in the parent qualification receipt.

Browser qualification used an isolated loopback server without authentication or
a product backend. It does not establish installed Tauri behavior, live admin
authorization, model availability or production activation. Parent ignored
evidence directory: `.coord/runs/media-unification/`.
