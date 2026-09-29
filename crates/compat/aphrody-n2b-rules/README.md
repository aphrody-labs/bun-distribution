<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-rules

Source rules of [n2b](https://crates.io/crates/aphrody-n2b), the Node.js to Bun migration
analyzer. Each rule set takes a file path and its source and returns the findings plus the
rewritten source:

- `node_imports`: Node.js built-in imports (`node:` prefix, modules Bun lacks or only partly
  implements), driven by the module table of
  [`aphrody-n2b-registry`](https://crates.io/crates/aphrody-n2b-registry);
- `bun_apis`: Node.js API calls with a Bun-native equivalent (`Bun.file`, `Bun.spawn`,
  `Bun.password`, ...), matched against the file's import graph;
- `cli_commands`: `node`, `npm`, `npx`, `yarn` and `pnpm` invocations in scripts and docs;
- `imports_ast`: import specifiers and the import graph extracted with the
  [oxc](https://crates.io/crates/oxc_parser) parser, and the analysis of the scripts of a rendered
  page artifact.

## Install

```toml
[dependencies]
aphrody-n2b-rules = "0.6.2"
```

## Example

```rust
use aphrody_n2b_rules::imports_ast::extract_specifiers;

let specifiers = extract_specifiers("main.ts", "import fs from 'fs';\nimport { x } from './x';");
assert_eq!(specifiers.len(), 2);
```

## License

Apache-2.0.
