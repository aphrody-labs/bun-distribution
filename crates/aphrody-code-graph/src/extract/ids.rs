// SPDX-License-Identifier: Apache-2.0
//! Node id normalisation (the Graphify recipe: lower-case, runs of non-word characters become
//! one underscore, edges trimmed).

/// Normalise one id string.
#[must_use]
pub fn normalize_id(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_sep = false;
    for ch in s.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            if pending_sep && !out.is_empty() {
                out.push('_');
            }
            pending_sep = false;
            out.push(ch);
        } else {
            // `_` and every other non-word character is a separator; runs collapse.
            pending_sep = true;
        }
    }
    out
}

/// Build an id from parts (each trimmed of `_` and `.` edges, joined with `_`).
#[must_use]
pub fn make_id(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .map(|p| p.trim_matches(|c| c == '_' || c == '.'))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    normalize_id(&joined)
}

/// File stem used as the symbol id prefix: the path without its extension.
#[must_use]
pub fn file_stem(rel_path: &str) -> &str {
    match rel_path.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') => stem,
        _ => rel_path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_match_the_graphify_recipe() {
        assert_eq!(make_id(&["crates/ai/rag/src/store.rs"]), "crates_ai_rag_src_store_rs");
        assert_eq!(
            make_id(&[file_stem("crates/ai/rag/src/store.rs"), "RagStore"]),
            "crates_ai_rag_src_store_ragstore"
        );
        assert_eq!(make_id(&["a_b", ".open"]), "a_b_open");
        assert_eq!(normalize_id("__Hello,  World__"), "hello_world");
        assert_eq!(normalize_id(&normalize_id("İslem Yap")), normalize_id("İslem Yap"));
    }

    #[test]
    fn stems_drop_only_the_extension() {
        assert_eq!(file_stem("a/b.c/d.rs"), "a/b.c/d");
        assert_eq!(file_stem("Makefile"), "Makefile");
    }
}
