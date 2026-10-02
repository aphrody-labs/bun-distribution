// SPDX-License-Identifier: Apache-2.0
//! Print the registered utilities and their implementation provenance as Markdown.

fn main() {
    println!("| Utility | Source |\n| --- | --- |");
    for utility in aphrody_shell_wasm_utils::catalog() {
        let source = match utility.source {
            aphrody_shell_wasm_utils::Source::Own => "own",
        };
        println!("| `{}` | `{source}` |", utility.name);
    }
}
