//! Public data types returned by the extractor and the chunker.

use serde::{Deserialize, Serialize};

/// Structural kind of an extracted block.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Heading,
    Paragraph,
    ListItem,
    Code,
    Quote,
    Table,
}

/// One block of main content, in document order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub kind: BlockKind,
    /// Heading level (1–6) for headings, `None` otherwise.
    pub level: Option<u8>,
    /// Texts of the enclosing headings, outermost first. For a heading block
    /// this is the path of its parents (the heading itself is not included).
    pub heading_path: Vec<String>,
    /// Plain text of the block (whitespace-collapsed, except code blocks).
    pub text: String,
}

/// Result of [`crate::extract_main`].
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Extracted {
    pub title: String,
    pub byline: Option<String>,
    /// ISO-8601 when parseable, raw value otherwise.
    pub published: Option<String>,
    pub lang: Option<String>,
    pub canonical: Option<String>,
    pub site_name: Option<String>,
    pub description: Option<String>,
    /// Main text with blank lines between blocks.
    pub text: String,
    /// GitHub-flavoured Markdown of the main content.
    pub markdown: String,
    pub blocks: Vec<Block>,
    /// SimHash of `text` as 16 lowercase hexadecimal digits.
    pub simhash: String,
    pub word_count: usize,
}

/// A retrieval chunk produced by [`crate::chunk_blocks`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chunk {
    /// Heading path of the first block of the chunk (a leading heading block
    /// contributes its own text as the last element).
    pub heading_path: Vec<String>,
    pub text: String,
    /// Index of the first block whose text starts in this chunk.
    pub start_block: usize,
    /// Index (inclusive) of the last block included in this chunk.
    pub end_block: usize,
}
