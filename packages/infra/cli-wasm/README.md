<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/cli-wasm

The pure sub-commands of the `aphrody` CLI as WebAssembly. They are the same code as
`aphrody pure ...` of the native binary (`crates/infra/aphrody-command-pure`, consumed by
`aphrody-command`): no network, no processes, no tokio, git or ssh.

````ts
import { loadCliWasm } from "@aphrody/cli-wasm";
const cli = await loadCliWasm();
cli.json(["rag", "chunk", "-", "--path", "guide.md"], { stdin: markdown });
cli.json(["toolcall", "repair", "-"], { stdin: "```json\n{'a': 1,}\n```" });
cli.text(["html", "markdown", "page.html"], { files: { "page.html": html } });
cli.run(["--help"]).stdout;
````

Groups: `rag` (the RAG call surface of `aphrody-rag-core`), `toolcall` (repair, validate, extract),
`html` (extract, markdown, simhash), `text` (comments, scrub, aphrodify, is-japanese).
For typed RAG calls and dense-vector kernels, use `@aphrody/rag-core` (same Rust source of truth).

Build (`wasm/`, git-ignored): `bun run build:wasm`. Plan: `docs/plans/ai/shenron-targets.md`.
