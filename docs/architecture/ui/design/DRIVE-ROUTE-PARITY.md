<!-- SPDX-License-Identifier: Apache-2.0 -->
# Drive route parity: file kinds, jobs, redundancy

The active webview is `packages/app-ui` (not in repo) (`src/router.tsx`). The
FSL source in `drive/packages/interface` (`src/router.tsx`)
is retained for provenance and feature comparison.

| Route | Current state | Backend and remaining qualification |
| --- | --- | --- |
| `/file-kinds` and `/file-kinds/:kind` | Active M3 view with library counts and filtered Explorer links for every content kind. | `files.content_kind_stats` counts unique content identities; `search.files` filters entries by the indexed identity's exact kind ID. Counts and result totals may differ because entries and identities are different units. Explorer caps results at 1,000 entries; pagination and installed-host behavior remain open. |
| `/jobs` | Active `JobsScreen`, using the shared `JobsProvider` and showing core plus Aphrody AI jobs. The screen now handles loading, errors, queued and cancelled jobs. | Drive `jobs.list`, `jobs.pause`, `jobs.resume` and `jobs.cancel` are registered in core. Validate control actions and event updates in the installed host. |
| `/redundancy`, `/redundancy/at-risk`, `/redundancy/compare` | Active M3 views show library and per-volume summary, at-risk or replicated content, and unique A, shared, and unique B comparisons. | `redundancy.summary` and `search.files` redundancy filters are registered in Drive core. Additive `on_all_volumes` selects content on both chosen volumes while `on_volumes` retains its any-volume behavior. Filters match content identities, so result rows can represent copies on other volumes. Explorer caps each filtered result at 1,000 files. Exact per-volume copy projection, pagination and installed-host behavior remain open. |

The restored file-kinds view derives from the archived FSL source. Its source path
and provenance are recorded in the implementation; no licensing conclusion follows
from the source comparison. The `/jobs` screen already existed in `app-ui` and
was connected to live hooks before its route was restored.
The redundancy views derive from the archived FSL routes in
`drive/packages/interface/src/routes/redundancy`,
with source paths and notices recorded in the implementation.
