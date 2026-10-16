---
description: Look up current docs for a library, framework, SDK or cloud service and answer with version-accurate code.
argument-hint: <library> [query]
---

# /docs — documentation lookup

Apply the `docs` skill to `$ARGUMENTS`:

1. Resolve `<library>` (Context7 `resolve-library-id`) unless an `/org/project`
   ID is given; pin the version used by the repository's lockfile.
2. Query the documentation for `[query]` (one concept per call, max 3).
3. Microsoft technologies: Microsoft Learn tools when present, otherwise WebFetch
   on `learn.microsoft.com`.
4. Answer with the explanation, a minimal example in the repository's toolchain
   and the source ID/URL. For large lookups delegate to the `docs-researcher` agent.
