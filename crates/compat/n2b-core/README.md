<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-core

The engine of [n2b](https://crates.io/crates/aphrody-n2b), the Node.js to Bun migration analyzer:

- `run::run(&RunOptions)`: walks a project (honouring `.gitignore` and the ignore globs), routes
  every file to its scanner and returns the per-file results (`Vec<FileFix>`); in `Fix` and
  `Aggressive` modes it writes the rewrites unless `dry_run` is set;
- `manifest`: the optional `n2b.json` project manifest (ignores, rule overrides, local registry
  entries), resolved parent-first;
- `report_card`: the migration report card;
- `audit`: GitHub issues and pull requests mentioning Bun or Node.js (`n2b audit`);
- `llmstxt`: `llms.txt` and `llms-full.txt` generation from a crawled site (`n2b llmstxt`, needs
  `siteone-crawler`; the optional page summaries call the Anthropic API with
  `ANTHROPIC_API_KEY`).

It also owns the modules `ai`, `github`, `report`, `rules` (Oxc-based import graph and the
Node-to-Bun rule application), `scanners` and `util`, which were the separate crates
`aphrody-n2b-{ai,github,report,rules,scanners,util}` until 2026-10-02, and re-exports
`aphrody-n2b-types` as `schema` and `types`. The rule tables themselves live in
`aphrody-n2b-registry`.

## Install

```toml
[dependencies]
aphrody-n2b-core = "0.6.2"
```

## Example

```rust,no_run
use aphrody_n2b_core::report::render_json;
use aphrody_n2b_core::run::run;
use aphrody_n2b_core::types::{Mode, Report, RunOptions};

let opts = RunOptions {
    root: ".".into(),
    mode: Mode::Check,
    report: Report::Json,
    quiet: true,
    ignore: Vec::new(),
    agent: true,
    dry_run: true,
};
let fixes = run(&opts)?;
println!("{}", render_json(&fixes, &opts));
# Ok::<(), anyhow::Error>(())
```

## License

Apache-2.0.
