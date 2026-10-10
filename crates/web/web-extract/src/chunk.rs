//! Structure-aware chunking of extracted blocks for retrieval (RAG).

use crate::types::{Block, BlockKind, Chunk};

/// Splits `text` into pieces of at most `max_chars` characters, preferring
/// sentence boundaries, then whitespace, then hard character boundaries.
fn split_long(text: &str, max_chars: usize) -> Vec<String> {
    let mut sentences: Vec<&str> = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    for (i, c) in text.char_indices() {
        let boundary = match c {
            '.' | '!' | '?' | ';' => bytes.get(i + 1).is_some_and(|b| b.is_ascii_whitespace()),
            '。' | '！' | '？' | '\n' => true,
            _ => false,
        };
        if boundary {
            let end = i + c.len_utf8();
            sentences.push(&text[start..end]);
            start = end;
        }
    }
    if start < text.len() {
        sentences.push(&text[start..]);
    }

    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0usize;
    for s in sentences {
        let s_trim = s.trim();
        if s_trim.is_empty() {
            continue;
        }
        let s_len = s_trim.chars().count();
        if s_len > max_chars {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
                cur_len = 0;
            }
            out.extend(hard_split(s_trim, max_chars));
            continue;
        }
        let extra = if cur.is_empty() { s_len } else { s_len + 1 };
        if cur_len + extra > max_chars && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
            cur_len = 0;
        }
        if !cur.is_empty() {
            cur.push(' ');
            cur_len += 1;
        }
        cur.push_str(s_trim);
        cur_len += s_len;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn hard_split(s: &str, max_chars: usize) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < chars.len() {
        let mut end = (pos + max_chars).min(chars.len());
        if end < chars.len() {
            // Prefer the last whitespace in the second half of the window.
            if let Some(ws) = (pos + max_chars / 2..end).rev().find(|&k| chars[k].is_whitespace()) {
                end = ws + 1;
            }
        }
        let piece: String = chars[pos..end].iter().collect();
        let piece = piece.trim().to_string();
        if !piece.is_empty() {
            out.push(piece);
        }
        pos = end;
    }
    out
}

/// Last `overlap` characters of `text`, starting at a word boundary.
fn tail(text: &str, overlap: usize) -> String {
    if overlap == 0 {
        return String::new();
    }
    let total = text.chars().count();
    if total <= overlap {
        return text.to_string();
    }
    let skip = total - overlap;
    let candidate: String = text.chars().skip(skip).collect();
    match candidate.find(char::is_whitespace) {
        Some(ws) if ws + 1 < candidate.len() => candidate[ws..].trim_start().to_string(),
        _ => candidate,
    }
}

fn block_path(b: &Block) -> Vec<String> {
    let mut path = b.heading_path.clone();
    if b.kind == BlockKind::Heading {
        path.push(b.text.clone());
    }
    path
}

struct Builder {
    chunks: Vec<Chunk>,
    text: String,
    len: usize,
    start: usize,
    end: usize,
    path: Vec<String>,
    has_content: bool,
    only_headings: bool,
}

impl Builder {
    fn flush(&mut self) {
        if self.has_content && !self.text.trim().is_empty() {
            self.chunks.push(Chunk {
                heading_path: std::mem::take(&mut self.path),
                text: std::mem::take(&mut self.text),
                start_block: self.start,
                end_block: self.end,
            });
        }
        self.text.clear();
        self.path.clear();
        self.len = 0;
        self.has_content = false;
        self.only_headings = true;
    }
}

/// Groups blocks into chunks of at most `max_chars` characters.
///
/// - Blocks are never split unless a single block exceeds `max_chars`; such a block is split on
///   sentence boundaries into its own chunks.
/// - A heading starts a new chunk once the current chunk is at least a quarter full, and a heading
///   never ends a chunk (it moves forward).
/// - When a section is split for size, the next chunk starts with up to `overlap_chars` characters
///   from the end of the previous chunk; the overlap is counted within `max_chars`. No heading text
///   is prefixed: `heading_path` carries it as metadata.
pub fn chunk_blocks(blocks: &[Block], max_chars: usize, overlap_chars: usize) -> Vec<Chunk> {
    let max_chars = max_chars.max(1);
    let overlap = overlap_chars.min(max_chars / 2);
    let mut b = Builder {
        chunks: Vec::new(),
        text: String::new(),
        len: 0,
        start: 0,
        end: 0,
        path: Vec::new(),
        has_content: false,
        only_headings: true,
    };

    for (idx, block) in blocks.iter().enumerate() {
        let body = block.text.trim();
        if body.is_empty() {
            continue;
        }
        let body_len = body.chars().count();
        let is_heading = block.kind == BlockKind::Heading;

        if body_len > max_chars {
            // Oversized block: emit what we have (carrying trailing headings
            // along as path metadata), then sentence-split the block.
            let carried = if b.has_content && b.only_headings {
                let p = (b.path.clone(), b.start);
                b.has_content = false;
                b.text.clear();
                b.len = 0;
                Some(p)
            } else {
                None
            };
            b.flush();
            let (path, first_start) = match carried {
                Some((p, s)) => (p, s),
                None => (block_path(block), idx),
            };
            let pieces = split_long(body, max_chars);
            let mut prev_tail = String::new();
            for (piece_no, piece) in pieces.into_iter().enumerate() {
                let mut text = String::new();
                if !prev_tail.is_empty()
                    && prev_tail.chars().count() + 1 + piece.chars().count() <= max_chars
                {
                    text.push_str(&prev_tail);
                    text.push(' ');
                }
                text.push_str(&piece);
                prev_tail = tail(&piece, overlap);
                b.chunks.push(Chunk {
                    heading_path: path.clone(),
                    text,
                    start_block: if piece_no == 0 { first_start } else { idx },
                    end_block: idx,
                });
            }
            continue;
        }

        let sep = if b.has_content { 2 } else { 0 };
        let heading_break =
            is_heading && b.has_content && !b.only_headings && b.len * 4 >= max_chars;
        let size_break = b.has_content && b.len + sep + body_len > max_chars;

        if heading_break || size_break {
            // Move trailing headings of the current chunk to the next one.
            let mut carry: Option<(String, usize, Vec<String>)> = None;
            if size_break && !heading_break {
                if let Some(prev) = blocks.get(b.end) {
                    if prev.kind == BlockKind::Heading && b.end > b.start {
                        let t = prev.text.trim();
                        if let Some(stripped) = b.text.strip_suffix(t) {
                            let stripped = stripped.trim_end().to_string();
                            carry = Some((t.to_string(), b.end, block_path(prev)));
                            b.text = stripped;
                            b.len = b.text.chars().count();
                            b.end -= 1;
                        }
                    }
                }
            }
            let prev_text = b.text.clone();
            b.flush();
            if let Some((t, i, path)) = carry {
                b.text.push_str(&t);
                b.len = t.chars().count();
                b.start = i;
                b.end = i;
                b.path = path;
                b.has_content = true;
                b.only_headings = true;
            } else if size_break && !is_heading && overlap > 0 {
                let ov = tail(&prev_text, overlap);
                let ov_len = ov.chars().count();
                if !ov.is_empty() && ov_len + 2 + body_len <= max_chars {
                    b.text.push_str(&ov);
                    b.len = ov_len;
                }
            }
        }

        if !b.has_content {
            b.start = idx;
            b.path = block_path(block);
        }
        if !b.text.is_empty() {
            b.text.push_str("\n\n");
            b.len += 2;
        }
        b.text.push_str(body);
        b.len += body_len;
        b.end = idx;
        b.has_content = true;
        if !is_heading {
            b.only_headings = false;
        }
    }
    b.flush();
    b.chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(kind: BlockKind, path: &[&str], text: &str) -> Block {
        Block {
            kind,
            level: if kind == BlockKind::Heading { Some(2) } else { None },
            heading_path: path.iter().map(|s| s.to_string()).collect(),
            text: text.to_string(),
        }
    }

    fn sample() -> Vec<Block> {
        vec![
            block(BlockKind::Heading, &[], "Intro"),
            block(BlockKind::Paragraph, &["Intro"], &"Alpha beta gamma. ".repeat(10)),
            block(BlockKind::Paragraph, &["Intro"], &"Delta epsilon zeta. ".repeat(10)),
            block(BlockKind::Heading, &[], "Details"),
            block(BlockKind::Paragraph, &["Details"], &"Eta theta iota. ".repeat(12)),
            block(BlockKind::ListItem, &["Details"], "Kappa item"),
        ]
    }

    #[test]
    fn respects_max_chars_and_block_boundaries() {
        let blocks = sample();
        let chunks = chunk_blocks(&blocks, 300, 0);
        assert!(chunks.len() >= 3);
        for c in &chunks {
            assert!(c.text.chars().count() <= 300, "{}", c.text.len());
            assert!(c.start_block <= c.end_block);
        }
        // Every non-empty block text appears unsplit in some chunk.
        for b in &blocks {
            assert!(chunks.iter().any(|c| c.text.contains(b.text.trim())), "missing {}", b.text);
        }
    }

    #[test]
    fn prefers_heading_starts_and_never_ends_on_heading() {
        let chunks = chunk_blocks(&sample(), 450, 0);
        for c in &chunks {
            let last_line = c.text.rsplit("\n\n").next().unwrap_or("");
            assert!(
                last_line != "Details" && last_line != "Intro",
                "chunk ends with heading: {:?}",
                c
            );
        }
        let details = chunks
            .iter()
            .find(|c| c.text.starts_with("Details"))
            .expect("chunk starting at heading");
        assert_eq!(details.heading_path, vec!["Details".to_string()]);
    }

    #[test]
    fn splits_oversized_block_on_sentences() {
        let long = "This is a sentence that is fairly long. ".repeat(40);
        let blocks = vec![block(BlockKind::Paragraph, &["H"], &long)];
        let chunks = chunk_blocks(&blocks, 200, 40);
        assert!(chunks.len() > 5);
        for c in &chunks {
            assert!(c.text.chars().count() <= 200);
            assert_eq!(c.start_block, 0);
            assert_eq!(c.heading_path, vec!["H".to_string()]);
        }
        assert!(chunks[1].text.starts_with("sentence") || chunks[1].text.contains("long."));
    }

    #[test]
    fn overlap_is_applied_on_size_splits() {
        let blocks: Vec<Block> = (0..6)
            .map(|i| {
                block(
                    BlockKind::Paragraph,
                    &[],
                    &format!("Paragraph number {i} talks about topic {i} in detail."),
                )
            })
            .collect();
        let chunks = chunk_blocks(&blocks, 120, 30);
        assert!(chunks.len() >= 2);
        assert!(chunks[1].text.contains("detail."));
        for c in &chunks {
            assert!(c.text.chars().count() <= 120);
        }
    }

    #[test]
    fn degenerate_inputs() {
        assert!(chunk_blocks(&[], 100, 10).is_empty());
        let blocks = vec![block(BlockKind::Paragraph, &[], "héllo wörld ünïcode")];
        let chunks = chunk_blocks(&blocks, 0, 1000);
        assert!(!chunks.is_empty());
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 1));
    }
}
