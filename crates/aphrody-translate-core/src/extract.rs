// SPDX-License-Identifier: Apache-2.0
//! Extraction déterministe des commentaires par tokenizer regex linéaire (Lexer).
//!
//! Analyse le flux de caractères séquentiellement en éliminant les chaînes de
//! caractères ("...", '...', `...`) avant d'extraire les commentaires.
//! Évite strictement les faux positifs (URL, glob "*/api/*", regex /.../).

use std::sync::OnceLock;

use regex::Regex;

use crate::{Comment, CommentStyle, Lang};

static RE_LEX_RUST: OnceLock<Regex> = OnceLock::new();
static RE_LEX_JS: OnceLock<Regex> = OnceLock::new();
static RE_LEX_PY: OnceLock<Regex> = OnceLock::new();
static RE_LEX_HASH: OnceLock<Regex> = OnceLock::new();
static RE_HTML_BLOCK: OnceLock<Regex> = OnceLock::new();

fn re_lex_rust() -> &'static Regex {
    RE_LEX_RUST.get_or_init(|| {
        Regex::new(concat!(
            // 1. Strings & raw strings (skip)
            r##"(?s)(?:r#+"(?:.*?)"#+|"(?:\\.|[^"\\])*")"##,
            r#"|"#,
            // 2. Doc slash bang: //! body (group 1, body in 2)
            r#"(?m)(//![ \t]?([^\n]*))"#,
            r#"|"#,
            // 3. Doc slash slash slash: /// body (group 3, body in 4)
            r#"(?m)(///[ \t]?([^\n]*))"#,
            r#"|"#,
            // 4. Doc block comment: /** body */ (group 5, body in 6)
            r#"(?s)(/\*\*(?:\s*(.*?)\s*)?\*/)"#,
            r#"|"#,
            // 5. Normal block comment: /* body */ (group 7, body in 8)
            r#"(?s)(/\*(?:\s*(.*?)\s*)?\*/)"#,
            r#"|"#,
            // 6. Normal line comment: // body (group 9, body in 10)
            r#"(?m)(//[ \t]?([^\n]*))"#
        ))
        .unwrap()
    })
}

fn re_lex_js() -> &'static Regex {
    RE_LEX_JS.get_or_init(|| {
        Regex::new(concat!(
            // 1. Strings (skip)
            r#"(?s)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)"#,
            r#"|"#,
            // 2. Doc block comment: /** body */ (group 1, body in 2)
            r#"(?s)(/\*\*(?:\s*(.*?)\s*)?\*/)"#,
            r#"|"#,
            // 3. Normal block comment: /* body */ (group 3, body in 4)
            r#"(?s)(/\*(?:\s*(.*?)\s*)?\*/)"#,
            r#"|"#,
            // 4. Line comment: // body (group 5, body in 6)
            r#"(?m)(//[ \t]?([^\n]*))"#
        ))
        .unwrap()
    })
}

fn re_lex_py() -> &'static Regex {
    RE_LEX_PY.get_or_init(|| {
        Regex::new(concat!(
            // 1. Triple-quoted strings (docstrings / multi-line) (group 1, body in 2)
            r##"(?s)("""\s*(.+?)\s*"""|'''\s*(.+?)\s*''')"##,
            r#"|"#,
            // 2. Standard strings (skip)
            r#"(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')"#,
            r#"|"#,
            // 3. Hash comment: # body (group 4, body in 5)
            r#"(?m)(#[ \t]?([^!\n][^\n]*)?)"#
        ))
        .unwrap()
    })
}

fn re_lex_hash() -> &'static Regex {
    RE_LEX_HASH.get_or_init(|| {
        Regex::new(concat!(
            // 1. Strings (skip)
            r#"(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')"#,
            r#"|"#,
            // 2. Hash comment: # body (group 1, body in 2)
            r#"(?m)(#[ \t]?([^!\n][^\n]*)?)"#
        ))
        .unwrap()
    })
}

fn re_html_block() -> &'static Regex {
    RE_HTML_BLOCK.get_or_init(|| Regex::new(r"(?s)<!--\s*(.+?)\s*-->").unwrap())
}

pub fn extract(source: &str, lang: Lang) -> Vec<Comment> {
    let mut out: Vec<Comment> = Vec::new();

    match lang {
        Lang::Rust => {
            for c in re_lex_rust().captures_iter(source) {
                if let Some(m) = c.get(1) {
                    let body = c
                        .get(2)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::DocSlashSlashBang,
                        });
                    }
                } else if let Some(m) = c.get(3) {
                    let body = c
                        .get(4)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::DocSlashSlashSlash,
                        });
                    }
                } else if let Some(m) = c.get(5) {
                    let body = c
                        .get(6)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::DocSlashStarStar,
                        });
                    }
                } else if let Some(m) = c.get(7) {
                    let body = c
                        .get(8)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::BlockSlashStar,
                        });
                    }
                } else if let Some(m) = c.get(9) {
                    let body = c
                        .get(10)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::LineSlashSlash,
                        });
                    }
                }
            }
        }
        Lang::TypeScript | Lang::JavaScript | Lang::Go | Lang::C | Lang::Cpp => {
            for c in re_lex_js().captures_iter(source) {
                if let Some(m) = c.get(1) {
                    let body = c
                        .get(2)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::DocSlashStarStar,
                        });
                    }
                } else if let Some(m) = c.get(3) {
                    let body = c
                        .get(4)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::BlockSlashStar,
                        });
                    }
                } else if let Some(m) = c.get(5) {
                    let body = c
                        .get(6)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::LineSlashSlash,
                        });
                    }
                }
            }
        }
        Lang::Python => {
            for c in re_lex_py().captures_iter(source) {
                if let Some(m) = c.get(1) {
                    let body = c
                        .get(2)
                        .or_else(|| c.get(3))
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::PythonTripleQuote,
                        });
                    }
                } else if let Some(m) = c.get(4) {
                    let body = c
                        .get(5)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::LineHash,
                        });
                    }
                }
            }
        }
        Lang::Shell | Lang::Toml => {
            for c in re_lex_hash().captures_iter(source) {
                if let Some(m) = c.get(1) {
                    let body = c
                        .get(2)
                        .map(|b| b.as_str().trim().to_string())
                        .unwrap_or_default();
                    if !body.is_empty() {
                        out.push(Comment {
                            raw: m.as_str().to_string(),
                            body,
                            start: m.start(),
                            end: m.end(),
                            style: CommentStyle::LineHash,
                        });
                    }
                }
            }
        }
        Lang::Markdown => {
            for c in re_html_block().captures_iter(source) {
                let m = c.get(0).unwrap();
                let body = c
                    .get(1)
                    .map(|b| b.as_str().trim().to_string())
                    .unwrap_or_default();
                if !body.is_empty() {
                    out.push(Comment {
                        raw: m.as_str().to_string(),
                        body,
                        start: m.start(),
                        end: m.end(),
                        style: CommentStyle::HtmlBlock,
                    });
                }
            }
        }
        Lang::Other => {}
    }

    out.sort_by_key(|c| c.start);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_line_and_doc() {
        let src = "//! module level doc\n    /// indented doc line\nfn foo() {} // tail";
        let comments = extract(src, Lang::Rust);
        assert!(comments.iter().any(|c| c.body == "module level doc" && c.style == CommentStyle::DocSlashSlashBang));
        assert!(
            comments
                .iter()
                .any(|c| c.body == "indented doc line"
                    && c.style == CommentStyle::DocSlashSlashSlash)
        );
        assert!(
            comments
                .iter()
                .any(|c| c.body == "tail" && c.style == CommentStyle::LineSlashSlash)
        );
    }

    #[test]
    fn python_hash_and_triple() {
        let src = "# top\ndef f():\n    \"\"\"\n    doc body\n    \"\"\"\n    pass";
        let comments = extract(src, Lang::Python);
        assert!(comments.iter().any(|c| c.body == "top"));
        assert!(comments.iter().any(|c| c.body.contains("doc body")));
    }

    #[test]
    fn block_comment_ts() {
        let src = "/* hello */\nlet x = 1;";
        let comments = extract(src, Lang::TypeScript);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].body, "hello");
    }

    #[test]
    fn string_literal_with_comment_markers_ignored() {
        let src = r#"
        const mime = "*/*";
        const url = "https://example.com/api";
        // Enable interception only for /api/* paths
        await cdpCall(transport, "Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
        // real comment
        "#;
        let comments = extract(src, Lang::TypeScript);
        assert_eq!(comments.len(), 2);
        assert_eq!(
            comments[0].body,
            "Enable interception only for /api/* paths"
        );
        assert_eq!(comments[1].body, "real comment");
    }
}
