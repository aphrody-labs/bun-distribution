// SPDX-License-Identifier: Apache-2.0
//! Stage the local agent console assets for `include_str!`.
//!
//! The console is built by the UI package in this workspace
//! (`crates/ui/app/ui-dist/`).
//! Embedding that path directly makes this crate uncompilable on any checkout
//! where the UI has not been built (CI, a fresh clone, a Linux host without
//! Bun). This script copies the three assets into `OUT_DIR` when they exist,
//! and otherwise writes an explicit placeholder page that says how to build
//! the real console. `APHRODY_UI_EMBEDDED` tells the crate which one shipped.

use std::{env, fs, path::PathBuf};

const ASSETS: [&str; 3] = ["index.html", "app.js", "app.css"];

const PLACEHOLDER_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>aphrody app-server</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main>
<h1>aphrody app-server</h1>
<p>The JSON-RPC API is running, but this binary was built without the web console.</p>
<p>Build it in the system layer first:</p>
<pre>bun install &amp;&amp; bun run --filter aphrody-app build</pre>
<p>then rebuild <code>aphrody-app-server</code> so the assets are embedded.</p>
</main>
<script src="/app.js"></script>
</body>
</html>
"#;

const PLACEHOLDER_JS: &str =
    "// aphrody app-server: console assets were not available at build time.\n";

const PLACEHOLDER_CSS: &str = "body{font:16px/1.5 system-ui,sans-serif;margin:3rem \
                               auto;max-width:40rem;padding:0 \
                               1rem}pre{background:#f4f4f4;padding:.75rem;overflow:auto}\n";

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let ui_dist = manifest_dir.join("../../apps/aphrody-app/ui-dist");

    // Re-run when the built console changes or (dis)appears.
    println!("cargo:rerun-if-changed={}", ui_dist.display());
    for asset in ASSETS {
        println!("cargo:rerun-if-changed={}", ui_dist.join(asset).display());
    }

    let embedded = ASSETS.iter().all(|asset| ui_dist.join(asset).is_file());
    if embedded {
        for asset in ASSETS {
            fs::copy(ui_dist.join(asset), out_dir.join(asset))
                .unwrap_or_else(|error| panic!("copy console asset {asset}: {error}"));
        }
    } else {
        println!(
            "cargo:warning=aphrody-app-server: console assets not found under {}; embedding a \
             placeholder page (build the UI from crates/ui/app to ship the real console)",
            ui_dist.display()
        );
        fs::write(out_dir.join("index.html"), PLACEHOLDER_HTML).expect("write placeholder html");
        fs::write(out_dir.join("app.js"), PLACEHOLDER_JS).expect("write placeholder js");
        fs::write(out_dir.join("app.css"), PLACEHOLDER_CSS).expect("write placeholder css");
    }
    println!("cargo:rustc-env=APHRODY_UI_EMBEDDED={}", u8::from(embedded));
}
