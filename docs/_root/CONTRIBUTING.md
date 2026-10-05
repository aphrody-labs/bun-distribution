# Contributing

Read [AGENTS.md](AGENTS.md) (rules), [ARCHITECTURE.md](ARCHITECTURE.md) (layout) and [PLAN.md](PLAN.md).

- Integration work goes on `dev`; `vendor` is generated history, fork `main` branches mirror upstream.
- `just check` (types, lint, format, clippy), `just test-all`; heavy builds go through `yolo ship`.
- Author and committer: `aphrody-dev <contact@aphrody.com>`; no assistant attribution or coauthor trailers.
- Format with explicit paths only (`just fmt`), never an unscoped formatter run.
