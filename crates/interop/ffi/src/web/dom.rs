// SPDX-License-Identifier: Apache-2.0
//! DOM tree handles: parse once, query many times.
//!
//! A tree is owned by the caller through the opaque pointer returned by
//! [`web_internal_parse_html`]. Nodes are addressed by their `u32` id inside that tree,
//! so nested queries (`element.querySelectorAll`) run against the existing
//! tree instead of re-parsing the element's outer HTML.

use std::os::raw::c_char;

use obscura_dom::{DomTree, NodeId};

use super::ffi_util::{borrow_str, error_json, guard, into_c_string};

/// Scope value meaning "the whole document".
pub const DOCUMENT_SCOPE: u32 = u32::MAX;

/// Sentinel returned by [`web_internal_query_selector_node`] when nothing matches.
pub const NODE_NONE: i32 = -1;
/// Sentinel returned by [`web_internal_query_selector_node`] on invalid input.
pub const NODE_ERROR: i32 = -2;

fn scope_node(tree: &DomTree, scope: u32) -> Option<NodeId> {
    if scope == DOCUMENT_SCOPE {
        return Some(tree.document());
    }
    let id = NodeId::new(scope);
    tree.with_node(id, |_| ()).map(|_| id)
}

/// Element descendants of `scope` (document order) matching `selector`.
///
/// Matching follows `Element.querySelectorAll` (the selector is evaluated
/// against the whole tree, only descendants of the scope are returned) and is
/// delegated to Obscura's own scoped query, so the selector engine version is
/// always the one the DOM was built for.
fn matching_descendants(
    tree: &DomTree,
    scope: NodeId,
    selector: &str,
    first_only: bool,
) -> Result<Vec<NodeId>, String> {
    if first_only {
        return tree.query_selector_from(scope, selector).map(|found| found.into_iter().collect());
    }
    tree.query_selector_all_from(scope, selector)
}

/// Parse a UTF-8 HTML document into an owned DOM tree.
///
/// # Safety
///
/// `html_ptr` must be null or point to a readable, NUL-terminated C string for
/// the duration of this call. A non-null result must eventually be passed
/// exactly once to [`web_internal_tree_destroy`].
pub unsafe extern "C" fn web_internal_parse_html(html_ptr: *const c_char) -> *mut DomTree {
    guard(std::ptr::null_mut(), || match unsafe { borrow_str(html_ptr) } {
        Some(html) => Box::into_raw(Box::new(obscura_dom::parse_html(html))),
        None => std::ptr::null_mut(),
    })
}

/// Release a DOM tree returned by [`web_internal_parse_html`].
///
/// # Safety
///
/// `tree_ptr` must be null or the exact live pointer returned by
/// [`web_internal_parse_html`]. It must not be used or destroyed again after this call,
/// and no concurrent access to the tree may be in progress.
pub unsafe extern "C" fn web_internal_tree_destroy(tree_ptr: *mut DomTree) {
    guard((), || {
        if !tree_ptr.is_null() {
            drop(unsafe { Box::from_raw(tree_ptr) });
        }
    })
}

/// Return the outer HTML of the first node matching a CSS selector.
///
/// # Safety
///
/// `tree_ptr` must point to a live tree returned by [`web_internal_parse_html`] and must
/// not be mutated or destroyed during this call. `selector_ptr` must point to a
/// readable, NUL-terminated C string. The returned string must be released
/// exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_query_selector(
    tree_ptr: *mut DomTree,
    selector_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if tree_ptr.is_null() {
            return std::ptr::null_mut();
        }
        let tree = unsafe { &*tree_ptr };
        let Some(selector) = (unsafe { borrow_str(selector_ptr) }) else {
            return std::ptr::null_mut();
        };
        match tree.query_selector(selector) {
            Ok(Some(id)) => into_c_string(tree.outer_html(id)),
            _ => std::ptr::null_mut(),
        }
    })
}

/// Return JSON containing the outer HTML of every matching node.
///
/// # Safety
///
/// Same contract as [`web_internal_query_selector`].
pub unsafe extern "C" fn web_internal_query_selector_all(
    tree_ptr: *mut DomTree,
    selector_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if tree_ptr.is_null() {
            return std::ptr::null_mut();
        }
        let tree = unsafe { &*tree_ptr };
        let Some(selector) = (unsafe { borrow_str(selector_ptr) }) else {
            return std::ptr::null_mut();
        };
        match tree.query_selector_all(selector) {
            Ok(ids) => {
                let results: Vec<String> = ids.into_iter().map(|id| tree.outer_html(id)).collect();
                into_c_string(serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()))
            },
            Err(_) => error_json("invalid selector"),
        }
    })
}

/// Return a JSON array of node ids (document order) matching `selector` inside
/// `scope` (`DOCUMENT_SCOPE` = `u32::MAX` for the whole document).
///
/// Returns `{"error": ...}` for an invalid selector or unknown scope node.
///
/// # Safety
///
/// `tree_ptr` must point to a live tree returned by [`web_internal_parse_html`];
/// `selector_ptr` must point to a readable, NUL-terminated C string. The
/// returned string must be released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_query_selector_all_nodes(
    tree_ptr: *mut DomTree,
    scope: u32,
    selector_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if tree_ptr.is_null() {
            return error_json("null tree");
        }
        let tree = unsafe { &*tree_ptr };
        let Some(selector) = (unsafe { borrow_str(selector_ptr) }) else {
            return error_json("invalid selector string");
        };
        let Some(scope_id) = scope_node(tree, scope) else {
            return error_json("unknown scope node");
        };
        match matching_descendants(tree, scope_id, selector, false) {
            Ok(ids) => {
                let raw: Vec<u32> = ids.into_iter().map(NodeId::raw).collect();
                into_c_string(serde_json::to_string(&raw).unwrap_or_else(|_| "[]".to_string()))
            },
            Err(e) => error_json(e),
        }
    })
}

/// Return the id of the first element matching `selector` inside `scope`,
/// [`NODE_NONE`] when nothing matches, or [`NODE_ERROR`] on invalid input.
///
/// # Safety
///
/// Same contract as [`web_internal_query_selector_all_nodes`].
pub unsafe extern "C" fn web_internal_query_selector_node(
    tree_ptr: *mut DomTree,
    scope: u32,
    selector_ptr: *const c_char,
) -> i32 {
    guard(NODE_ERROR, || {
        if tree_ptr.is_null() {
            return NODE_ERROR;
        }
        let tree = unsafe { &*tree_ptr };
        let Some(selector) = (unsafe { borrow_str(selector_ptr) }) else {
            return NODE_ERROR;
        };
        let Some(scope_id) = scope_node(tree, scope) else {
            return NODE_ERROR;
        };
        match matching_descendants(tree, scope_id, selector, true) {
            Ok(ids) => ids
                .first()
                .map(|id| i32::try_from(id.raw()).unwrap_or(NODE_ERROR))
                .unwrap_or(NODE_NONE),
            Err(_) => NODE_ERROR,
        }
    })
}

/// Run `f` against a live node, returning `NULL` for unknown ids.
unsafe fn with_live_node(
    tree_ptr: *mut DomTree,
    node: u32,
    f: impl FnOnce(&DomTree, NodeId) -> Option<String>,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if tree_ptr.is_null() {
            return std::ptr::null_mut();
        }
        let tree = unsafe { &*tree_ptr };
        let id = NodeId::new(node);
        if tree.with_node(id, |_| ()).is_none() {
            return std::ptr::null_mut();
        }
        f(tree, id).map(into_c_string).unwrap_or(std::ptr::null_mut())
    })
}

/// Outer HTML of a node, or `NULL` for an unknown id.
///
/// # Safety
///
/// `tree_ptr` must point to a live tree returned by [`web_internal_parse_html`]. The
/// returned string must be released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_node_outer_html(
    tree_ptr: *mut DomTree,
    node: u32,
) -> *mut c_char {
    unsafe { with_live_node(tree_ptr, node, |tree, id| Some(tree.outer_html(id))) }
}

/// Inner HTML of a node, or `NULL` for an unknown id.
///
/// # Safety
///
/// Same contract as [`web_internal_node_outer_html`].
pub unsafe extern "C" fn web_internal_node_inner_html(
    tree_ptr: *mut DomTree,
    node: u32,
) -> *mut c_char {
    unsafe { with_live_node(tree_ptr, node, |tree, id| Some(tree.inner_html(id))) }
}

/// `textContent` of a node, or `NULL` for an unknown id.
///
/// # Safety
///
/// Same contract as [`web_internal_node_outer_html`].
pub unsafe extern "C" fn web_internal_node_text_content(
    tree_ptr: *mut DomTree,
    node: u32,
) -> *mut c_char {
    unsafe { with_live_node(tree_ptr, node, |tree, id| Some(tree.text_content(id))) }
}

/// Lowercase local tag name of an element, or `NULL` for non-elements.
///
/// # Safety
///
/// Same contract as [`web_internal_node_outer_html`].
pub unsafe extern "C" fn web_internal_node_tag_name(
    tree_ptr: *mut DomTree,
    node: u32,
) -> *mut c_char {
    unsafe {
        with_live_node(tree_ptr, node, |tree, id| {
            tree.with_node(id, |n| n.as_element().map(|q| str::to_ascii_lowercase(&q.local)))
                .flatten()
        })
    }
}

/// Value of attribute `name` on an element, or `NULL` when absent.
///
/// # Safety
///
/// `name_ptr` must point to a readable, NUL-terminated C string; otherwise the
/// contract of [`web_internal_node_outer_html`] applies.
pub unsafe extern "C" fn web_internal_node_attribute(
    tree_ptr: *mut DomTree,
    node: u32,
    name_ptr: *const c_char,
) -> *mut c_char {
    let Some(name) = (unsafe { borrow_str(name_ptr) }) else {
        return std::ptr::null_mut();
    };
    unsafe {
        with_live_node(tree_ptr, node, |tree, id| {
            tree.with_node(id, |n| n.get_attribute(name).map(str::to_string)).flatten()
        })
    }
}

/// JSON object of every attribute on an element (`{}` for non-elements).
///
/// # Safety
///
/// Same contract as [`web_internal_node_outer_html`].
pub unsafe extern "C" fn web_internal_node_attributes_json(
    tree_ptr: *mut DomTree,
    node: u32,
) -> *mut c_char {
    unsafe {
        with_live_node(tree_ptr, node, |tree, id| {
            let map: serde_json::Map<String, serde_json::Value> = tree
                .with_node(id, |n| {
                    n.attrs()
                        .map(|attrs| {
                            attrs
                                .iter()
                                .map(|a| {
                                    (
                                        a.name.local.to_string(),
                                        serde_json::Value::String(a.value.clone()),
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            Some(serde_json::Value::Object(map).to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::{CStr, CString};

    use super::*;

    unsafe fn take(ptr: *mut c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        unsafe { crate::web_internal_free_string(ptr) };
        Some(value)
    }

    #[test]
    fn scoped_queries_use_node_handles() {
        let html = CString::new(
            "<ul id='a'><li class='x' data-k='1'>One &amp; two</li><li>Two</li></ul><ul \
             id='b'><li class='x'>Three</li></ul>",
        )
        .unwrap();
        unsafe {
            let tree = web_internal_parse_html(html.as_ptr());
            assert!(!tree.is_null());
            let ul_sel = CString::new("#b").unwrap();
            let ul = web_internal_query_selector_node(tree, DOCUMENT_SCOPE, ul_sel.as_ptr());
            assert!(ul >= 0);

            let li_sel = CString::new("li.x").unwrap();
            let all: Vec<u32> = serde_json::from_str(
                &take(web_internal_query_selector_all_nodes(tree, DOCUMENT_SCOPE, li_sel.as_ptr()))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(all.len(), 2);
            let scoped: Vec<u32> = serde_json::from_str(
                &take(web_internal_query_selector_all_nodes(tree, ul as u32, li_sel.as_ptr()))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(scoped.len(), 1);
            assert_eq!(
                take(web_internal_node_text_content(tree, scoped[0])).as_deref(),
                Some("Three")
            );

            // Combinators may match ancestors outside the scope (DOM semantics).
            let desc_sel = CString::new("ul li").unwrap();
            let desc: Vec<u32> = serde_json::from_str(
                &take(web_internal_query_selector_all_nodes(tree, ul as u32, desc_sel.as_ptr()))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(desc.len(), 1);

            assert_eq!(
                take(web_internal_node_text_content(tree, all[0])).as_deref(),
                Some("One & two")
            );
            assert_eq!(take(web_internal_node_tag_name(tree, all[0])).as_deref(), Some("li"));
            let key = CString::new("data-k").unwrap();
            assert_eq!(
                take(web_internal_node_attribute(tree, all[0], key.as_ptr())).as_deref(),
                Some("1")
            );
            let missing = CString::new("nope").unwrap();
            assert!(web_internal_node_attribute(tree, all[0], missing.as_ptr()).is_null());
            let attrs: serde_json::Value = serde_json::from_str(
                &take(web_internal_node_attributes_json(tree, all[0])).unwrap(),
            )
            .unwrap();
            assert_eq!(attrs["class"], "x");

            assert!(web_internal_node_outer_html(tree, 9_999_999).is_null());
            let bad = CString::new("li[").unwrap();
            assert_eq!(
                web_internal_query_selector_node(tree, DOCUMENT_SCOPE, bad.as_ptr()),
                NODE_ERROR
            );
            let none = CString::new("table").unwrap();
            assert_eq!(
                web_internal_query_selector_node(tree, DOCUMENT_SCOPE, none.as_ptr()),
                NODE_NONE
            );
            web_internal_tree_destroy(tree);
        }
    }
}

/// One hyperlink discovered in a document.
#[derive(serde::Serialize)]
struct Anchor {
    url: String,
    text: String,
    nofollow: bool,
}

fn collapse_whitespace(value: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(value.len().min(max_chars));
    let mut pending_space = false;
    for ch in value.chars() {
        if ch.is_whitespace() {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(ch);
        if out.chars().count() >= max_chars {
            break;
        }
    }
    out
}

/// Parse `html` and return `[{url, text, nofollow}]` for every `a[href]` and
/// `area[href]`: URLs resolved against `base`, fragments stripped, non-web
/// schemes dropped, duplicates merged (first anchor text wins, `nofollow` only
/// when every occurrence is nofollow). Anchor text feeds frontier relevance.
pub(crate) fn extract_anchors(html: &str, base: Option<&url::Url>) -> Vec<serde_json::Value> {
    let tree = obscura_dom::parse_html(html);
    // `<base href>` overrides the document URL for resolution.
    let base_override = tree
        .query_selector("base[href]")
        .ok()
        .flatten()
        .and_then(|id| {
            tree.with_node(id, |n| n.get_attribute("href").map(str::to_string)).flatten()
        })
        .and_then(|href| match base {
            Some(b) => b.join(&href).ok(),
            None => url::Url::parse(&href).ok(),
        });
    let base = base_override.as_ref().or(base);

    let mut order: Vec<String> = Vec::new();
    let mut anchors: std::collections::HashMap<String, Anchor> = std::collections::HashMap::new();
    for id in tree.query_selector_all("a[href], area[href]").unwrap_or_default() {
        let Some((href, rel)) = tree
            .with_node(id, |n| {
                n.get_attribute("href").map(|h| {
                    (
                        h.trim().to_string(),
                        n.get_attribute("rel").unwrap_or("").to_ascii_lowercase(),
                    )
                })
            })
            .flatten()
        else {
            continue;
        };
        if href.is_empty() || href.starts_with('#') {
            continue;
        }
        let resolved = match base {
            Some(b) => b.join(&href).ok(),
            None => url::Url::parse(&href).ok(),
        };
        let Some(mut resolved) = resolved else { continue };
        if !matches!(resolved.scheme(), "http" | "https") {
            continue;
        }
        resolved.set_fragment(None);
        let key = resolved.to_string();
        let nofollow = rel
            .split_whitespace()
            .any(|token| token == "nofollow" || token == "ugc" || token == "sponsored");
        let text = collapse_whitespace(&tree.text_content(id), 200);
        match anchors.get_mut(&key) {
            Some(existing) => {
                existing.nofollow &= nofollow;
                if existing.text.is_empty() {
                    existing.text = text;
                }
            },
            None => {
                order.push(key.clone());
                anchors.insert(key.clone(), Anchor { url: key, text, nofollow });
            },
        }
    }
    order
        .into_iter()
        .filter_map(|key| anchors.remove(&key))
        .filter_map(|anchor| serde_json::to_value(anchor).ok())
        .collect()
}

/// Return a JSON array of `{url, text, nofollow}` for every link in `html`.
///
/// # Safety
///
/// `html_ptr` must point to a readable, NUL-terminated C string; `base_url_ptr`
/// may be null or satisfy the same requirement. The returned string must be
/// released with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_extract_anchors(
    html_ptr: *const c_char,
    base_url_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let Some(html) = (unsafe { borrow_str(html_ptr) }) else {
            return into_c_string("[]".to_string());
        };
        let base = unsafe { borrow_str(base_url_ptr) }.and_then(|b| url::Url::parse(b).ok());
        let anchors = extract_anchors(html, base.as_ref());
        into_c_string(serde_json::Value::Array(anchors).to_string())
    })
}

#[cfg(test)]
mod anchor_tests {
    use super::*;

    #[test]
    fn anchors_resolve_merge_and_keep_text() {
        let html = r#"<base href="/docs/"><a href="Guide?x=1#top"> The   guide </a>
            <a href="guide?x=1" rel="nofollow">again</a><a href="mailto:a@b.c">m</a>
            <a href="https://Other.test/P" rel="ugc">ugc</a><map><area href="/img" alt="i"></map>"#;
        let base = url::Url::parse("https://example.com/start").unwrap();
        let anchors = extract_anchors(html, Some(&base));
        let urls: Vec<&str> = anchors.iter().map(|a| a["url"].as_str().unwrap()).collect();
        assert_eq!(
            urls,
            vec![
                "https://example.com/docs/Guide?x=1",
                "https://example.com/docs/guide?x=1",
                "https://other.test/P",
                "https://example.com/img"
            ]
        );
        assert_eq!(anchors[0]["text"], "The guide");
        assert_eq!(anchors[0]["nofollow"], false);
        assert_eq!(anchors[1]["nofollow"], true);
        assert_eq!(anchors[2]["nofollow"], true);
    }
}
