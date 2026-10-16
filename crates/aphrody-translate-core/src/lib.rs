// SPDX-License-Identifier: Apache-2.0
//! Aphrody Translate Core: the pure stages of the comment rewriter, with no network, runtime or
//! file system access, so they compile for `wasm32-unknown-unknown` and run in the browser.
//!
//!   1. extraction  : finds comments by language (pure Rust regexes)
//!   2. ai_patterns : detects and cleans AI markers and emoji
//!   3. aphrodify   : applies the Aphrody style (sober, impersonal, code focused)
//!
//! `aphrody-translate` re-exports every item and adds the translation backend and the CLI.

pub mod ai_patterns;
pub mod aphrodify;
pub mod extract;

use std::path::Path;

/// True when the text contains Japanese characters (Kanji, Hiragana, Katakana).
#[must_use]
pub fn is_japanese(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(c,
            '\u{3040}'..='\u{309F}' | // Hiragana
            '\u{30A0}'..='\u{30FF}' | // Katakana
            '\u{4E00}'..='\u{9FAF}'   // CJK Unified Ideographs
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    Go,
    C,
    Cpp,
    Shell,
    Toml,
    Markdown,
    Other,
}

impl Lang {
    pub fn from_path(p: &Path) -> Self {
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        match ext {
            "rs" => Lang::Rust,
            "ts" | "tsx" => Lang::TypeScript,
            "js" | "jsx" | "mjs" | "cjs" => Lang::JavaScript,
            "py" | "pyi" => Lang::Python,
            "go" => Lang::Go,
            "c" | "h" => Lang::C,
            "cc" | "cpp" | "cxx" | "hpp" | "hxx" => Lang::Cpp,
            "sh" | "bash" | "zsh" => Lang::Shell,
            "toml" => Lang::Toml,
            "md" | "markdown" => Lang::Markdown,
            _ => Lang::Other,
        }
    }

    pub fn supports_comments(&self) -> bool {
        !matches!(self, Lang::Other)
    }
}

#[derive(Debug, Clone)]
pub struct Comment {
    pub raw: String,
    pub body: String,
    pub start: usize,
    pub end: usize,
    pub style: CommentStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommentStyle {
    LineSlashSlash,
    LineHash,
    BlockSlashStar,
    DocSlashSlashSlash,
    DocSlashSlashBang,
    DocSlashStarStar,
    PythonTripleQuote,
    HtmlBlock,
}

impl CommentStyle {
    pub fn rewrap(&self, body: &str) -> String {
        match self {
            CommentStyle::LineSlashSlash => format!("// {body}"),
            CommentStyle::LineHash => format!("# {body}"),
            CommentStyle::DocSlashSlashSlash => format!("/// {body}"),
            CommentStyle::DocSlashSlashBang => format!("//! {body}"),
            CommentStyle::BlockSlashStar => {
                if body.contains('\n') {
                    format!("/*\n{body}\n */")
                } else {
                    format!("/* {body} */")
                }
            }
            CommentStyle::DocSlashStarStar => {
                if body.contains('\n') {
                    format!("/**\n{body}\n */")
                } else {
                    format!("/** {body} */")
                }
            }
            CommentStyle::PythonTripleQuote => format!("\"\"\"{body}\"\"\""),
            CommentStyle::HtmlBlock => format!("<!-- {body} -->"),
        }
    }
}
