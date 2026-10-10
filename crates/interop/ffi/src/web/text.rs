// SPDX-License-Identifier: Apache-2.0
//! Text-level helpers that operate on raw HTML strings without building a
//! DOM tree: title, tag stripping, Markdown, links, plain text and URL
//! normalisation.

use std::{ffi::CStr, os::raw::c_char};

use super::ffi_util::{guard, into_c_string};

/// Extract the title from a UTF-8 HTML document.
///
/// # Safety
///
/// `html_ptr` must be null or point to a readable, NUL-terminated C string for
/// the duration of this call. The returned string must be released exactly once
/// with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_extract_title(html_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if html_ptr.is_null() {
            return std::ptr::null_mut();
        }

        let c_str = unsafe { CStr::from_ptr(html_ptr) };
        let html = match c_str.to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        };

        // Fast native title extraction using lol_html or simple string finding
        // For extreme speed, simple finding
        let start_tag = "<title>";
        let end_tag = "</title>";

        if let Some(start_idx) =
            html.find(start_tag).or_else(|| html.find("<TITLE>")).or_else(|| html.find("<title "))
        {
            let after_start = &html[start_idx..];
            let content_start = after_start.find('>').map(|i| i + 1).unwrap_or(0);
            let content = &after_start[content_start..];

            if let Some(end_idx) = content.find(end_tag).or_else(|| content.find("</TITLE>")) {
                let title = content[..end_idx].trim().to_string();
                return into_c_string(title);
            }
        }

        into_c_string(String::new())
    })
}

/// Strip tags from a UTF-8 HTML document.
///
/// # Safety
///
/// `html_ptr` must be null or point to a readable, NUL-terminated C string for
/// the duration of this call. The returned string must be released exactly once
/// with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_strip_tags(html_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if html_ptr.is_null() {
            return std::ptr::null_mut();
        }

        let c_str = unsafe { CStr::from_ptr(html_ptr) };
        let html = match c_str.to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        };

        // Very fast single-pass tag stripping
        let mut result = String::with_capacity(html.len() / 2);
        let mut in_tag = false;

        for c in html.chars() {
            if c == '<' {
                in_tag = true;
            } else if c == '>' {
                in_tag = false;
            } else if !in_tag {
                result.push(c);
            }
        }

        into_c_string(result)
    })
}

/// Convert a UTF-8 HTML document to Markdown.
///
/// # Safety
///
/// `html_ptr` must be null or point to a readable, NUL-terminated C string for
/// the duration of this call. The returned string must be released exactly once
/// with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_html_to_markdown(html_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if html_ptr.is_null() {
            return std::ptr::null_mut();
        }

        let c_str = unsafe { CStr::from_ptr(html_ptr) };
        let html_payload = match c_str.to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        };

        // One canonical converter for the whole code base (aphrody-web-extract).
        let markdown = aphrody_web_extract::html_to_markdown(html_payload, None);
        into_c_string(markdown)
    })
}

/// Extract all hyperlink URLs from a UTF-8 HTML document.
///
/// If `base_url_ptr` is provided, relative URLs are resolved against it.
/// Strips fragments (`#...`), `javascript:`, `mailto:`, and `data:` URLs.
/// Returns a JSON-encoded array of distinct URL strings.
///
/// # Safety
///
/// `html_ptr` must be null or point to a readable, NUL-terminated C string.
/// `base_url_ptr` may be null or point to a readable, NUL-terminated C string.
/// The returned string must be released exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_extract_links(
    html_ptr: *const c_char,
    base_url_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if html_ptr.is_null() {
            return into_c_string("[]".to_string());
        }

        let c_str = unsafe { CStr::from_ptr(html_ptr) };
        let html = match c_str.to_str() {
            Ok(s) => s,
            Err(_) => return into_c_string("[]".to_string()),
        };

        let base_url = if base_url_ptr.is_null() {
            None
        } else {
            unsafe { CStr::from_ptr(base_url_ptr) }
                .to_str()
                .ok()
                .and_then(|s| url::Url::parse(s).ok())
        };

        let mut links = Vec::new();
        let mut seen = std::collections::HashSet::new();

        // ASCII-only lowercasing keeps byte offsets identical, so positions found
        // in `lower` can slice the original `html`: URL paths and queries are
        // case-sensitive and must be returned verbatim.
        let lower = html.to_ascii_lowercase();
        let mut cursor = 0;

        while let Some(tag_offset) = lower[cursor..].find("<a") {
            let tag_start = cursor + tag_offset;
            cursor = tag_start + 2;

            let tag_end = match lower[cursor..].find('>') {
                Some(end_offset) => cursor + end_offset,
                None => break,
            };

            let tag_slice_lower = &lower[tag_start..=tag_end];
            let tag_slice = &html[tag_start..=tag_end];
            if let Some(href_idx) = tag_slice_lower.find("href") {
                let after_href = &tag_slice[href_idx + 4..];
                let trimmed = after_href.trim_start();
                if let Some(after_eq) = trimmed.strip_prefix('=') {
                    let after_eq = after_eq.trim_start();
                    let raw_val = if let Some(inner) = after_eq.strip_prefix('"') {
                        let q_end = inner.find('"').unwrap_or(inner.len());
                        &inner[..q_end]
                    } else if let Some(inner) = after_eq.strip_prefix('\'') {
                        let q_end = inner.find('\'').unwrap_or(inner.len());
                        &inner[..q_end]
                    } else {
                        let end = after_eq
                            .find(|c: char| c.is_whitespace() || c == '>')
                            .unwrap_or(after_eq.len());
                        &after_eq[..end]
                    };

                    let href = raw_val.trim();
                    let scheme = href.get(..11).unwrap_or(href).to_ascii_lowercase();
                    if !href.is_empty()
                        && !href.starts_with('#')
                        && !scheme.starts_with("javascript:")
                        && !scheme.starts_with("mailto:")
                        && !scheme.starts_with("tel:")
                        && !scheme.starts_with("data:")
                    {
                        let resolved = if let Some(ref base) = base_url {
                            match base.join(href) {
                                Ok(mut u) => {
                                    u.set_fragment(None);
                                    u.to_string()
                                },
                                Err(_) => href.split('#').next().unwrap_or(href).to_string(),
                            }
                        } else {
                            href.split('#').next().unwrap_or(href).to_string()
                        };

                        if seen.insert(resolved.clone()) {
                            links.push(resolved);
                        }
                    }
                }
            }

            cursor = tag_end + 1;
        }

        let json = serde_json::to_string(&links).unwrap_or_else(|_| "[]".to_string());
        into_c_string(json)
    })
}

/// Extract clean plain text from a UTF-8 HTML document.
///
/// Removes `<script>`, `<style>`, `<noscript>`, `<svg>` elements and all HTML tags.
/// Decodes common HTML entities and normalizes whitespace.
///
/// # Safety
///
/// `html_ptr` must be null or point to a readable, NUL-terminated C string.
/// The returned string must be released exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_extract_text(html_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if html_ptr.is_null() {
            return into_c_string(String::new());
        }

        let c_str = unsafe { CStr::from_ptr(html_ptr) };
        let html = match c_str.to_str() {
            Ok(s) => s,
            Err(_) => return into_c_string(String::new()),
        };

        let mut out = String::with_capacity(html.len() / 2);
        let skip_tags = ["script", "style", "noscript", "svg"];

        let chars: Vec<char> = html.chars().collect();
        let len = chars.len();
        let mut i = 0;
        let mut in_tag = false;
        let mut current_tag = String::new();
        let mut skipping_until: Option<String> = None;

        while i < len {
            if let Some(ref end_tag) = skipping_until {
                if chars[i] == '<' && i + 2 + end_tag.len() < len && chars[i + 1] == '/' {
                    let mut matched = true;
                    for (offset, tc) in end_tag.chars().enumerate() {
                        if chars[i + 2 + offset].to_ascii_lowercase() != tc {
                            matched = false;
                            break;
                        }
                    }
                    if matched {
                        let mut j = i + 2 + end_tag.len();
                        while j < len && chars[j] != '>' {
                            j += 1;
                        }
                        i = j + 1;
                        skipping_until = None;
                        continue;
                    }
                }
                i += 1;
                continue;
            }

            let c = chars[i];
            if c == '<' {
                in_tag = true;
                current_tag.clear();
                i += 1;
                continue;
            }

            if in_tag {
                if c == '>' {
                    in_tag = false;
                    let tag_name = current_tag
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim_start_matches('/')
                        .to_ascii_lowercase();

                    if skip_tags.contains(&tag_name.as_str()) && !current_tag.starts_with('/') {
                        skipping_until = Some(tag_name);
                    } else if matches!(
                        tag_name.as_str(),
                        "p" | "div"
                            | "h1"
                            | "h2"
                            | "h3"
                            | "h4"
                            | "h5"
                            | "h6"
                            | "li"
                            | "tr"
                            | "br"
                            | "hr"
                            | "article"
                            | "section"
                    ) {
                        out.push('\n');
                    }
                } else {
                    current_tag.push(c);
                }
                i += 1;
                continue;
            }

            out.push(c);
            i += 1;
        }

        let replaced = out
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&mdash;", "—")
            .replace("&ndash;", "–");

        let mut normalized = String::with_capacity(replaced.len());
        let mut prev_space = false;
        let mut newline_run = 0;

        for ch in replaced.chars() {
            if ch == '\n' || ch == '\r' {
                if newline_run < 2 {
                    normalized.push('\n');
                    newline_run += 1;
                }
                prev_space = false;
            } else if ch.is_whitespace() {
                if !prev_space && newline_run == 0 {
                    normalized.push(' ');
                    prev_space = true;
                }
            } else {
                normalized.push(ch);
                prev_space = false;
                newline_run = 0;
            }
        }

        let result = normalized.trim().to_string();
        into_c_string(result)
    })
}

/// Normalize a URL: lowercase scheme/host, drop default ports, remove tracking query params,
/// sort queries, and strip trailing slash/fragments.
///
/// # Safety
///
/// `url_ptr` must be null or point to a readable, NUL-terminated C string.
/// The returned string must be released exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_normalize_url(url_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if url_ptr.is_null() {
            return into_c_string(String::new());
        }

        let c_str = unsafe { CStr::from_ptr(url_ptr) };
        let raw_url = match c_str.to_str() {
            Ok(s) => s.trim(),
            Err(_) => return into_c_string(String::new()),
        };

        let mut parsed = match url::Url::parse(raw_url) {
            Ok(u) => u,
            Err(_) => return into_c_string(raw_url.to_string()),
        };

        parsed.set_fragment(None);

        let tracking_params = [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "fbclid",
            "gclid",
            "gbraid",
            "wbraid",
            "ref",
            "source",
            "mc_cid",
            "mc_eid",
            "msclkid",
        ];

        let mut query_pairs: Vec<(String, String)> = parsed
            .query_pairs()
            .filter(|(k, _)| !tracking_params.contains(&k.as_ref()))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();

        query_pairs.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        if query_pairs.is_empty() {
            parsed.set_query(None);
        } else {
            let mut serializer = url::form_urlencoded::Serializer::new(String::new());
            for (k, v) in query_pairs {
                serializer.append_pair(&k, &v);
            }
            parsed.set_query(Some(&serializer.finish()));
        }

        let mut normalized_str = parsed.to_string();
        if normalized_str.ends_with('/') && parsed.path() == "/" && parsed.query().is_none() {
            normalized_str.pop();
        }

        into_c_string(normalized_str)
    })
}
