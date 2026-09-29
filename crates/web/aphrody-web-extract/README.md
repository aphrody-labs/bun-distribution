<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-web-extract

Canonical Rust owner for Aphrody Web's static URL and metadata extraction
primitives.

```rust
use aphrody_web_extract::{extract_metadata, normalize_page_url, UrlNormalizationOptions};
use url::Url;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let base = Url::parse("https://example.org/docs/start")?;
    let _canonical = normalize_page_url(
        "../api/?ref=docs#types",
        Some(&base),
        UrlNormalizationOptions { drop_query: false, trim_trailing_slash: true },
    )?;
    let _metadata = extract_metadata(
        "<title>API</title><link rel=canonical href='/api'>",
        Some(&base),
    );
    Ok(())
}
```

URL normalization uses `url::Url` parsing and resolution, removes fragments,
rejects non-HTTP(S) schemes and user information, and only removes query
strings or trailing slashes when requested. Metadata extraction reads the title,
description, and canonical link from static HTML.

This crate does not yet implement main-content scoring, structured-data
extraction, structural chunks, HTML-to-Markdown conversion, SimHash, or the
existing BXC compatibility APIs. Consumers must not claim full BXC parity from
these primitives. Those paths move here only with source-backed fixtures and
consumer cutover evidence.
