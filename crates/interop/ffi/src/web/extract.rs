// SPDX-License-Identifier: Apache-2.0
//! Main-content extraction, canonical Markdown, chunking and SimHash
//! (`aphrody-web-extract`) exposed over the C ABI.

use std::os::raw::c_char;

use serde::{Deserialize, Serialize};

use super::ffi_util::{borrow_str, error_json, guard, into_c_string, to_json_string};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ExtractRequestOptions {
    max_chunk_chars: usize,
    chunk_overlap: usize,
    include_comments: bool,
    include_images: bool,
    include_links: bool,
}

impl Default for ExtractRequestOptions {
    fn default() -> Self {
        Self {
            max_chunk_chars: 1200,
            chunk_overlap: 150,
            include_comments: false,
            include_images: false,
            include_links: true,
        }
    }
}

/// Chunk with offsets (UTF-16 code units, i.e. JavaScript string indices)
/// into `Extracted::text`, covering the blocks the chunk was built from.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OffsetChunk {
    heading_path: Vec<String>,
    text: String,
    start_block: usize,
    end_block: usize,
    char_start: usize,
    char_end: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractResponse {
    title: String,
    byline: Option<String>,
    published: Option<String>,
    lang: Option<String>,
    canonical: Option<String>,
    site_name: Option<String>,
    description: Option<String>,
    text: String,
    markdown: String,
    simhash: String,
    word_count: usize,
    blocks: Vec<aphrody_web_extract::Block>,
    chunks: Vec<OffsetChunk>,
}

fn utf16_len(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// Offsets of each block inside `text`, assuming blocks are joined by a blank
/// line (the extractor's documented layout). Falls back to searching when the
/// layout differs.
fn block_spans(text: &str, blocks: &[aphrody_web_extract::Block]) -> Vec<(usize, usize)> {
    let mut spans = Vec::with_capacity(blocks.len());
    let mut byte_cursor = 0usize;
    for block in blocks {
        let needle = block.text.as_str();
        let found = if needle.is_empty() {
            None
        } else {
            text[byte_cursor..].find(needle).map(|i| i + byte_cursor)
        };
        match found {
            Some(byte_start) => {
                let start = utf16_len(&text[..byte_start]);
                spans.push((start, start + utf16_len(needle)));
                byte_cursor = byte_start + needle.len();
            },
            None => {
                let at = utf16_len(&text[..byte_cursor]);
                spans.push((at, at));
            },
        }
    }
    spans
}

fn extract_response(
    html: &str,
    url: Option<&str>,
    options: &ExtractRequestOptions,
) -> ExtractResponse {
    let extract_options = aphrody_web_extract::ExtractOptions {
        include_comments: options.include_comments,
        include_images: options.include_images,
        include_links: options.include_links,
    };
    let extracted = aphrody_web_extract::extract_main_with_options(html, url, &extract_options);
    let spans = block_spans(&extracted.text, &extracted.blocks);
    let chunks = aphrody_web_extract::chunk_blocks(
        &extracted.blocks,
        options.max_chunk_chars.max(64),
        options.chunk_overlap,
    )
    .into_iter()
    .map(|chunk| {
        let char_start = spans.get(chunk.start_block).map(|s| s.0).unwrap_or(0);
        let char_end =
            spans.get(chunk.end_block).map(|s| s.1).unwrap_or(char_start).max(char_start);
        OffsetChunk {
            heading_path: chunk.heading_path,
            text: chunk.text,
            start_block: chunk.start_block,
            end_block: chunk.end_block,
            char_start,
            char_end,
        }
    })
    .collect();
    ExtractResponse {
        title: extracted.title,
        byline: extracted.byline,
        published: extracted.published,
        lang: extracted.lang,
        canonical: extracted.canonical,
        site_name: extracted.site_name,
        description: extracted.description,
        text: extracted.text,
        markdown: extracted.markdown,
        simhash: extracted.simhash,
        word_count: extracted.word_count,
        blocks: extracted.blocks,
        chunks,
    }
}

/// Extract the main content of `html` (optionally resolved against `url`) and
/// return JSON: title, byline, published, lang, canonical, siteName,
/// description, text, markdown, simhash, wordCount, blocks and chunks with
/// heading paths and offsets. `options_json` may be null or
/// `{"maxChunkChars", "chunkOverlap", "includeComments", "includeImages", "includeLinks"}`.
///
/// # Safety
///
/// `html_ptr` must point to a readable NUL-terminated C string; `url_ptr` and
/// `options_json_ptr` may be null or satisfy the same requirement. The returned
/// string must be released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_extract_main(
    html_ptr: *const c_char,
    url_ptr: *const c_char,
    options_json_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let Some(html) = (unsafe { borrow_str(html_ptr) }) else {
            return error_json("invalid html string");
        };
        let url = unsafe { borrow_str(url_ptr) };
        let options = unsafe { borrow_str(options_json_ptr) }
            .and_then(|raw| serde_json::from_str::<ExtractRequestOptions>(raw).ok())
            .unwrap_or_default();
        into_c_string(to_json_string(&extract_response(html, url, &options)))
    })
}

/// Canonical Aphrody Web ABI name for structured main-content extraction.
/// The result is allocated by this cdylib and must be released by it.
///
/// # Safety
///
/// Pointer requirements are identical to [`web_internal_extract_main`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_extract_main(
    html_ptr: *const c_char,
    url_ptr: *const c_char,
    options_json_ptr: *const c_char,
) -> *mut c_char {
    // SAFETY: the canonical alias preserves the exact legacy pointer contract.
    unsafe { web_internal_extract_main(html_ptr, url_ptr, options_json_ptr) }
}

/// Convert a whole HTML document to GitHub-flavoured Markdown, resolving links
/// against `base_url_ptr` (may be null). The single canonical converter.
///
/// # Safety
///
/// `html_ptr` must point to a readable NUL-terminated C string; `base_url_ptr`
/// may be null. The returned string must be released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_html_to_markdown_with_base(
    html_ptr: *const c_char,
    base_url_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let Some(html) = (unsafe { borrow_str(html_ptr) }) else {
            return std::ptr::null_mut();
        };
        into_c_string(aphrody_web_extract::html_to_markdown(html, unsafe {
            borrow_str(base_url_ptr)
        }))
    })
}

/// Canonical Aphrody Web ABI name for HTML-to-Markdown conversion.
///
/// The returned string is allocated by this cdylib and must be released with
/// `web_internal_free_string` (or its canonical alias). The legacy `web_internal_*` exports stay
/// available for existing Bun and Rust clients.
///
/// # Safety
///
/// `html_ptr` must point to a readable NUL-terminated C string; `base_url_ptr`
/// may be null. The returned string must be released by this same library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_html_to_markdown(
    html_ptr: *const c_char,
    base_url_ptr: *const c_char,
) -> *mut c_char {
    // SAFETY: this is the same pointer contract as the retained legacy export.
    unsafe { web_internal_html_to_markdown_with_base(html_ptr, base_url_ptr) }
}

/// 64-bit SimHash of `text` as 16 lowercase hex digits.
///
/// # Safety
///
/// `text_ptr` must point to a readable NUL-terminated C string. The returned
/// string must be released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_simhash64(text_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let text = unsafe { borrow_str(text_ptr) }.unwrap_or_default();
        into_c_string(format!("{:016x}", aphrody_web_extract::simhash64(text)))
    })
}

/// Canonical Aphrody Web ABI name for 64-bit text SimHash.
/// The result is allocated by this cdylib and must be released by it.
///
/// # Safety
///
/// Pointer requirements are identical to [`web_internal_simhash64`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_simhash64(text_ptr: *const c_char) -> *mut c_char {
    // SAFETY: the canonical alias preserves the exact legacy pointer contract.
    unsafe { web_internal_simhash64(text_ptr) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_markdown_abi_matches_legacy_export() {
        use std::ffi::{CStr, CString};

        let html = CString::new("<p><a href='/guide'>Guide</a></p>").unwrap();
        let base = CString::new("https://example.test/docs/").unwrap();
        // SAFETY: inputs are live NUL-terminated strings, and both outputs are
        // freed with this cdylib's matching function.
        unsafe {
            let canonical = aphrody_web_html_to_markdown(html.as_ptr(), base.as_ptr());
            let legacy = web_internal_html_to_markdown_with_base(html.as_ptr(), base.as_ptr());
            assert!(!canonical.is_null());
            assert!(!legacy.is_null());
            let canonical_text = CStr::from_ptr(canonical).to_string_lossy().into_owned();
            let legacy_text = CStr::from_ptr(legacy).to_string_lossy().into_owned();
            crate::web_internal_free_string(canonical);
            crate::web_internal_free_string(legacy);
            assert_eq!(canonical_text, legacy_text);
            assert!(canonical_text.contains("https://example.test/guide"));
        }
    }

    #[test]
    fn canonical_extraction_abi_matches_legacy_exports() {
        use std::ffi::{CStr, CString};

        let html = CString::new(
            "<article><h1>Guide</h1><p>A long enough paragraph with substantial content for extraction.</p></article>",
        )
        .unwrap();
        let url = CString::new("https://example.test/guide").unwrap();
        let options = CString::new("{}").unwrap();
        let text = CString::new("same content").unwrap();
        // SAFETY: inputs are live NUL-terminated strings, and outputs are
        // released through this library's allocator-matched free function.
        unsafe {
            let canonical = aphrody_web_extract_main(html.as_ptr(), url.as_ptr(), options.as_ptr());
            let legacy = web_internal_extract_main(html.as_ptr(), url.as_ptr(), options.as_ptr());
            let canonical_hash = aphrody_web_simhash64(text.as_ptr());
            let legacy_hash = web_internal_simhash64(text.as_ptr());
            assert!(!canonical.is_null());
            assert!(!legacy.is_null());
            assert!(!canonical_hash.is_null());
            assert!(!legacy_hash.is_null());
            let canonical_text = CStr::from_ptr(canonical).to_string_lossy().into_owned();
            let legacy_text = CStr::from_ptr(legacy).to_string_lossy().into_owned();
            let canonical_hash_text = CStr::from_ptr(canonical_hash).to_string_lossy().into_owned();
            let legacy_hash_text = CStr::from_ptr(legacy_hash).to_string_lossy().into_owned();
            crate::web_internal_free_string(canonical);
            crate::web_internal_free_string(legacy);
            crate::web_internal_free_string(canonical_hash);
            crate::web_internal_free_string(legacy_hash);
            assert_eq!(canonical_text, legacy_text);
            assert_eq!(canonical_hash_text, legacy_hash_text);
        }
    }

    #[test]
    fn chunk_offsets_point_into_the_extracted_text() {
        let html = "<html><head><title>T</title></head><body><nav>menu \
                    menu</nav><article><h1>Guide</h1><p>First paragraph with enough words to be \
                    kept as main content by the extractor.</p><h2>Élan</h2><p>Second paragraph \
                    about pricing and ünïcode, also long enough to be retained \
                    here.</p></article><footer>footer links</footer></body></html>";
        let response = extract_response(
            html,
            Some("https://e.test/a"),
            &ExtractRequestOptions { max_chunk_chars: 80, ..Default::default() },
        );
        assert!(!response.chunks.is_empty());
        let utf16: Vec<u16> = response.text.encode_utf16().collect();
        for chunk in &response.chunks {
            assert!(chunk.char_end <= utf16.len());
            let span = String::from_utf16_lossy(&utf16[chunk.char_start..chunk.char_end]);
            let first_block = &response.blocks[chunk.start_block].text;
            assert!(
                span.starts_with(first_block.as_str()),
                "span {span:?} should start with {first_block:?}"
            );
        }
        assert_eq!(response.simhash.len(), 16);
    }
}
