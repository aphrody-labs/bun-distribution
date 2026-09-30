<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-util

Text utilities shared by the scanners and rules of
[n2b](https://crates.io/crates/aphrody-n2b), the Node.js to Bun migration analyzer:

- `line_offsets(source)`: byte offsets of every `\n`;
- `pos_from_index(offsets, index)`: 1-based `(line, column)` of a byte index;
- `make_finding(...)`: builds a `Finding` at a byte index;
- `Edit` and `apply_edits(source, edits)`: apply byte-range replacements, dropping overlapping
  edits (the longest edit wins at equal start) and applying them back to front so offsets stay
  valid.

## Install

```toml
[dependencies]
aphrody-n2b-util = "0.6.2"
```

## Example

```rust
use aphrody_n2b_util::{Edit, apply_edits, line_offsets, pos_from_index};

let source = "const fs = require('fs');\nfs.readFileSync(p);";
let offsets = line_offsets(source);
assert_eq!(pos_from_index(&offsets, source.find("fs.read").unwrap()), (2, 1));

let index = source.find("'fs'").unwrap();
let edited = apply_edits(source, vec![Edit { index, len: 4, replacement: "'node:fs'".into() }]);
assert!(edited.starts_with("const fs = require('node:fs');"));
```

## License

Apache-2.0.
