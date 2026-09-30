<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-ai

Agent-oriented metadata for the findings of [n2b](https://crates.io/crates/aphrody-n2b), the
Node.js to Bun migration analyzer. It makes the JSON report easy to consume by an LLM agent:

- `category(rule_id)`: the functional category of a rule (`api`, `imports`, `cli`, ...), so an
  agent can filter by concern;
- `confidence(rule_id, has_replacement)`: a confidence score in `[0, 1]` for the suggested fix;
- `docs_url(rule_id)`: a stable link to the relevant Bun documentation page;
- `context_lines(source, line)`: three lines before and after a finding (CRLF-safe);
- `byte_offset(line_offsets, line, col)`: the absolute byte offset of a 1-based position;
- `SCHEMA_VERSION`, `SCHEMA_URL`: the report schema version and its URL.

## Install

```toml
[dependencies]
aphrody-n2b-ai = "0.6.2"
```

## Example

```rust
use aphrody_n2b_ai::{category, context_lines, docs_url};

assert_eq!(category("imports/node-prefix"), "imports");
assert!(docs_url("imports/node-prefix").starts_with("https://"));
let ctx = context_lines("a\nb\nc\nd\ne", 3);
assert_eq!(ctx.line, "c");
assert_eq!(ctx.before, ["a", "b"]);
```

## License

Apache-2.0.
