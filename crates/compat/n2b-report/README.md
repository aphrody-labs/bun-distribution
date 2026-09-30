<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-report

Report renderers of [n2b](https://crates.io/crates/aphrody-n2b), the Node.js to Bun migration
analyzer. Every renderer takes the per-file results (`&[FileFix]`) and the run options:

| Function | Output |
| --- | --- |
| `render_text` | coloured terminal report |
| `render_json`, `render_json_with_card` | JSON report (schema v2), optionally with the report card |
| `render_jsonl` | one `meta` line, then one `finding` line per finding |
| `render_sarif` | SARIF for code-scanning tools |
| `render_markdown` | Markdown report |
| `render_prompt` | a Markdown migration prompt for an LLM, capped at `max_findings` |
| `render_report_card_text` | the report card as text |

JSON findings carry the agent metadata of
[`aphrody-n2b-ai`](https://crates.io/crates/aphrody-n2b-ai) (category, confidence, docs link and
source context).

## Install

```toml
[dependencies]
aphrody-n2b-report = "0.6.2"
```

## License

Apache-2.0.
