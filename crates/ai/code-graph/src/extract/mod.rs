// SPDX-License-Identifier: Apache-2.0
//! Syntax extraction: per-file raw nodes and edges, then corpus assembly (call resolution and
//! stub rewiring) into a [`Graph`](crate::Graph).
//!
//! Node ids follow the Graphify recipe so graphs stay comparable: a file node is the
//! normalised path including its extension, a symbol is the normalised file stem plus its name.
//! Labels: `name()` for a function, `.name()` for a method, the bare name for a type.

pub mod ids;
pub mod resolve;
pub mod rust;

use serde::{Deserialize, Serialize};

use crate::graph::Confidence;

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
    /// Parse problem, if any (the file contributes nothing then).
    pub error: Option<String>,
}

/// Languages with a native extractor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    /// Rust.
    Rust,
}

impl Language {
    /// Language of a path by extension.
    #[must_use]
    pub fn of_path(path: &str) -> Option<Self> {
        match path.rsplit_once('.')?.1 {
            "rs" => Some(Self::Rust),
            _ => None,
        }
    }
}

/// Extract one file.
#[must_use]
pub fn extract_file(rel_path: &str, source: &[u8]) -> FileExtract {
    match Language::of_path(rel_path) {
        Some(Language::Rust) => rust::extract(rel_path, source),
        None => FileExtract::default(),
    }
}
