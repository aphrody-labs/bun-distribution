// SPDX-License-Identifier: Apache-2.0
//! Syntax extraction: per-file raw nodes and edges, then corpus assembly (call resolution and
//! stub rewiring) into a [`Graph`](crate::Graph).
//!
//! Node ids follow the Graphify recipe so graphs stay comparable: a file node is the
//! normalised path including its extension, a symbol is the normalised file stem plus its name.
//! Labels: `name()` for a function, `.name()` for a method, the bare name for a type.

pub mod ids;
pub mod markdown;
pub mod resolve;
pub mod rust;
pub mod typescript;

use serde::{Deserialize, Serialize};

use crate::graph::Confidence;

/// Version of the per-file extraction format; cached rows of another version are re-extracted.
pub const EXTRACT_VERSION: u32 = 3;

/// Decode one textual source file without silently replacing or dropping malformed bytes.
pub(super) fn decode_text(source: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(source)
        .map_err(|error| format!("source is not valid UTF-8 at byte {}", error.valid_up_to()))
}

/// What a raw node is; corpus resolution folds stubs only onto types.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeClass {
    /// A file node.
    File,
    /// A struct, enum, trait or the type of an impl block.
    Type,
    /// A function or method.
    Function,
    /// A constant or static.
    Const,
    /// An enum variant.
    Variant,
    /// A macro.
    Macro,
    /// A Markdown heading.
    Section,
    /// A sourceless stub awaiting resolution.
    #[default]
    Stub,
}

/// A node as read from one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawNode {
    /// Node id.
    pub id: String,
    /// Display label.
    pub label: String,
    /// Source file (empty for a sourceless stub awaiting resolution).
    pub file: String,
    /// `Lnn` location.
    pub loc: String,
    /// Class of the node.
    #[serde(default)]
    pub class: NodeClass,
}

/// An edge as read from one file; `dst` may name a stub.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RawEdge {
    /// Source node id.
    pub src: String,
    /// Target node id.
    pub dst: String,
    /// Relation.
    pub relation: String,
    /// Confidence class.
    pub confidence: Confidence,
    /// Confidence score.
    pub score: f64,
    /// File.
    pub file: String,
    /// `Lnn`.
    pub loc: String,
    /// Context.
    pub context: Option<String>,
}

/// A call site whose target is resolved against the whole corpus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawCall {
    /// Calling function node id.
    pub from: String,
    /// Bare callee name.
    pub name: String,
    /// True for `x.name()` / `Type::name()` forms (methods and associated functions).
    pub method: bool,
    /// File of the call.
    pub file: String,
    /// `Lnn`.
    pub loc: String,
    /// Rust: qualifying path of the callee (`bun_sys`, `crate::store::Store`), already expanded
    /// through the file's `use` aliases; for a member call on a receiver of known type, the type
    /// path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// JS/TS: module specifier the callee was imported from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

/// What an import record points at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportKind {
    /// A JS/TS module specifier (`./math`, `node:path`, `internal/fs`).
    #[default]
    Module,
    /// A Markdown `[[wiki link]]`.
    Wiki,
    /// A Markdown `[text](relative/path.md)` link.
    Link,
}

/// An import or link resolved against the corpus at assembly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawImport {
    /// Specifier as written.
    pub specifier: String,
    /// Imported names (`default` for a default import); empty for a side-effect or namespace
    /// import.
    #[serde(default)]
    pub names: Vec<String>,
    /// `Lnn`.
    pub loc: String,
    /// Kind of the import.
    #[serde(default)]
    pub kind: ImportKind,
}

/// Everything extracted from one file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FileExtract {
    /// Nodes.
    pub nodes: Vec<RawNode>,
    /// Edges.
    pub edges: Vec<RawEdge>,
    /// Unresolved call sites.
    pub calls: Vec<RawCall>,
    /// JS/TS imports and Markdown links, resolved at assembly.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub imports: Vec<RawImport>,
    /// Rust glob imports (`use a::b::*` gives `a::b`), searched for plain calls.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub globs: Vec<String>,
    /// Parse problem, if any (the file contributes nothing then).
    pub error: Option<String>,
    /// [`EXTRACT_VERSION`] of the extractor that produced this record.
    #[serde(default)]
    pub version: u32,
}

/// Languages with a native extractor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    /// Rust.
    Rust,
    /// TypeScript / JavaScript.
    TypeScript,
    /// Markdown (headings and links).
    Markdown,
}

impl Language {
    /// Language of a path by extension.
    #[must_use]
    pub fn of_path(path: &str) -> Option<Self> {
        match path.rsplit_once('.')?.1 {
            "rs" => Some(Self::Rust),
            "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx" | "mts" | "cts" => Some(Self::TypeScript),
            "md" | "mdx" => Some(Self::Markdown),
            _ => None,
        }
    }
}

/// Extract one file.
#[must_use]
pub fn extract_file(rel_path: &str, source: &[u8]) -> FileExtract {
    let mut out = match Language::of_path(rel_path) {
        Some(Language::Rust) => rust::extract(rel_path, source),
        Some(Language::TypeScript) => typescript::extract(rel_path, source),
        Some(Language::Markdown) => markdown::extract(rel_path, source),
        None => FileExtract::default(),
    };
    out.version = EXTRACT_VERSION;
    out
}

#[cfg(test)]
mod tests {
    use super::{EXTRACT_VERSION, extract_file};

    #[test]
    fn malformed_utf8_is_reported_for_every_text_extractor() {
        for path in ["broken.rs", "broken.ts", "broken.md"] {
            let result = extract_file(path, b"# valid prefix\n\xff");
            assert_eq!(
                result.error.as_deref(),
                Some("source is not valid UTF-8 at byte 15"),
                "unexpected result for {path}",
            );
            assert!(result.nodes.is_empty(), "partial nodes for {path}");
            assert!(result.edges.is_empty(), "partial edges for {path}");
            assert!(result.imports.is_empty(), "partial imports for {path}");
            assert_eq!(result.version, EXTRACT_VERSION);
        }
    }
}
