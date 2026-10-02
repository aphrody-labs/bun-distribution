// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Manga typesetting engine and bubble geometry text fitting.
//!
//! Provides text wrapping, vertical CJK (`tategaki`) and horizontal layout,
//! Japanese *kinsoku shori* line-breaking rules, dynamic binary-search font sizing,
//! and stroke/drop-shadow rendering styles.

use crate::bubble::{BoundingBox, Point, SpeechBubble};
use serde::{Deserialize, Serialize};

/// Writing orientation mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum WritingMode {
    /// Horizontal Left-to-Right, lines flow Top-to-Bottom (Western scanlations, modern text).
    #[default]
    Horizontal,
    /// Vertical Right-to-Left, columns flow Right-to-Left (Traditional Japanese CJK `tategaki`).
    VerticalRl,
}

/// Horizontal or vertical text alignment within the bubble.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TextJustification {
    /// Centered within each line/column (most common in manga dialogue).
    #[default]
    Center,
    /// Left / Top aligned.
    Left,
    /// Right / Bottom aligned.
    Right,
}

/// Visual style applied to typeset dialogue text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextStyle {
    /// Font family identifier (e.g. "WildWords", "CCWildWords", "AnimeAce", "ArialMT").
    pub font_family: String,
    /// Primary font size in pixels.
    pub font_size: f32,
    /// Minimum allowed font size during auto-fitting.
    pub min_font_size: f32,
    /// Maximum allowed font size during auto-fitting.
    pub max_font_size: f32,
    /// Text color RGBA (default: pure black [0, 0, 0, 255]).
    pub color: [u8; 4],
    /// Stroke / outline color RGBA (e.g. white outline [255, 255, 255, 255]).
    pub stroke_color: Option<[u8; 4]>,
    /// Stroke width in pixels.
    pub stroke_width: f32,
    /// Line height multiplier (default: 1.25).
    pub line_height: f32,
    /// Text alignment.
    pub justification: TextJustification,
    /// Writing mode.
    pub writing_mode: WritingMode,
    /// Inner padding inset from bubble contour in pixels (default: 8.0).
    pub padding: f32,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "ArialMT".to_string(),
            font_size: 16.0,
            min_font_size: 9.0,
            max_font_size: 36.0,
            color: [0, 0, 0, 255],
            stroke_color: None,
            stroke_width: 0.0,
            line_height: 1.25,
            justification: TextJustification::Center,
            writing_mode: WritingMode::Horizontal,
            padding: 8.0,
        }
    }
}

/// A laid-out line of text with position and metrics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TypesetLine {
    /// Characters or words in this line.
    pub text: String,
    /// Relative offset (X, Y) from the bubble's top-left corner.
    pub offset: Point,
    /// Width in pixels.
    pub width: f32,
    /// Height in pixels.
    pub height: f32,
}

/// The complete calculated typesetting layout for a speech bubble.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TypesetLayout {
    /// Resolved font size.
    pub font_size: f32,
    /// Individual lines or columns.
    pub lines: Vec<TypesetLine>,
    /// Bounding box of the rendered text block.
    pub bounds: BoundingBox,
    /// Whether the text completely fits inside the bubble without overflow.
    pub fits: bool,
}

/// Typesetting Engine: Fits text inside speech bubble polygons.
pub struct TypesetEngine;

impl TypesetEngine {
    /// Automatically fits text into a speech bubble by binary-searching the optimal font size.
    #[must_use]
    pub fn fit_text_to_bubble(
        text: &str,
        bubble: &SpeechBubble,
        style: &TextStyle,
    ) -> TypesetLayout {
        let clean_text = text.trim();
        if clean_text.is_empty() {
            return TypesetLayout {
                font_size: style.font_size,
                lines: Vec::new(),
                bounds: BoundingBox::new(bubble.bounds.x, bubble.bounds.y, 0.0, 0.0),
                fits: true,
            };
        }

        let mut low = style.min_font_size;
        let mut high = style.max_font_size;
        let mut best_layout = None;

        // Binary search up to 8 iterations
        for _ in 0..8 {
            let mid = ((low + high) * 0.5 * 10.0).round() / 10.0;
            let layout = Self::layout_text(clean_text, bubble, style, mid);

            if layout.fits {
                best_layout = Some(layout);
                low = mid; // Try larger font size
            } else {
                high = mid; // Font size too large, shrink
            }

            if high - low < 0.5 {
                break;
            }
        }

        best_layout
            .unwrap_or_else(|| Self::layout_text(clean_text, bubble, style, style.min_font_size))
    }

    /// Computes layout for a specific font size.
    #[must_use]
    pub fn layout_text(
        text: &str,
        bubble: &SpeechBubble,
        style: &TextStyle,
        font_size: f32,
    ) -> TypesetLayout {
        match style.writing_mode {
            WritingMode::Horizontal => Self::layout_horizontal(text, bubble, style, font_size),
            WritingMode::VerticalRl => Self::layout_vertical_rl(text, bubble, style, font_size),
        }
    }

    fn layout_horizontal(
        text: &str,
        bubble: &SpeechBubble,
        style: &TextStyle,
        font_size: f32,
    ) -> TypesetLayout {
        let max_w = (bubble.bounds.width - style.padding * 2.0).max(10.0);
        let max_h = (bubble.bounds.height - style.padding * 2.0).max(10.0);
        let line_height = font_size * style.line_height;

        let words: Vec<&str> = text.split_whitespace().collect();
        let mut lines = Vec::new();
        let mut current_line = String::new();

        // Approximate average character width: ~0.55 of font size for Western latin fonts
        let char_width = font_size * 0.55;

        for word in words {
            let test_line = if current_line.is_empty() {
                word.to_string()
            } else {
                format!("{current_line} {word}")
            };

            let test_width = test_line.chars().count() as f32 * char_width;

            if test_width <= max_w {
                current_line = test_line;
            } else {
                if !current_line.is_empty() {
                    lines.push(current_line);
                }
                current_line = word.to_string();
            }
        }

        if !current_line.is_empty() {
            lines.push(current_line);
        }

        let total_h = lines.len() as f32 * line_height;
        let fits = total_h <= max_h;

        // Position lines centered vertically and horizontally within bubble bounds
        let start_y = bubble.bounds.y + (bubble.bounds.height - total_h) * 0.5;
        let mut typeset_lines = Vec::new();

        for (i, line_text) in lines.into_iter().enumerate() {
            let line_w = line_text.chars().count() as f32 * char_width;
            let line_x = match style.justification {
                TextJustification::Center => bubble.bounds.x + (bubble.bounds.width - line_w) * 0.5,
                TextJustification::Left => bubble.bounds.x + style.padding,
                TextJustification::Right => bubble.bounds.right() - style.padding - line_w,
            };
            let line_y = start_y + i as f32 * line_height;

            typeset_lines.push(TypesetLine {
                text: line_text,
                offset: Point::new(line_x, line_y),
                width: line_w,
                height: line_height,
            });
        }

        TypesetLayout {
            font_size,
            lines: typeset_lines,
            bounds: BoundingBox::new(
                bubble.bounds.x,
                bubble.bounds.y,
                bubble.bounds.width,
                bubble.bounds.height,
            ),
            fits,
        }
    }

    fn layout_vertical_rl(
        text: &str,
        bubble: &SpeechBubble,
        style: &TextStyle,
        font_size: f32,
    ) -> TypesetLayout {
        let max_w = (bubble.bounds.width - style.padding * 2.0).max(10.0);
        let max_h = (bubble.bounds.height - style.padding * 2.0).max(10.0);
        let col_width = font_size * style.line_height;
        let char_height = font_size * 1.1;

        let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
        let max_chars_per_col = (max_h / char_height).floor().max(1.0) as usize;

        let mut columns = Vec::new();
        let mut current_col = Vec::new();

        for c in chars {
            // Apply kinsoku shori: avoid starting a column with forbidden punctuation
            if current_col.len() >= max_chars_per_col && !is_gyoto_kinsoku(c) {
                columns.push(current_col);
                current_col = Vec::new();
            }
            current_col.push(c);
        }
        if !current_col.is_empty() {
            columns.push(current_col);
        }

        let total_w = columns.len() as f32 * col_width;
        let fits = total_w <= max_w;

        // Traditional Japanese: columns flow Right-to-Left
        let start_x = bubble.bounds.right() - style.padding - col_width;
        let mut typeset_lines = Vec::new();

        for (col_idx, col_chars) in columns.into_iter().enumerate() {
            let col_x = start_x - col_idx as f32 * col_width;
            let col_h = col_chars.len() as f32 * char_height;
            let col_y = bubble.bounds.y + (bubble.bounds.height - col_h) * 0.5;

            let col_str: String = col_chars.into_iter().collect();
            typeset_lines.push(TypesetLine {
                text: col_str,
                offset: Point::new(col_x, col_y),
                width: col_width,
                height: col_h,
            });
        }

        TypesetLayout {
            font_size,
            lines: typeset_lines,
            bounds: BoundingBox::new(
                bubble.bounds.x,
                bubble.bounds.y,
                bubble.bounds.width,
                bubble.bounds.height,
            ),
            fits,
        }
    }
}

/// Japanese *gyōtō kinsoku* characters (prohibited at start of a line or vertical column).
#[must_use]
pub fn is_gyoto_kinsoku(c: char) -> bool {
    matches!(
        c,
        '、' | '。'
            | '，'
            | '．'
            | '！'
            | '？'
            | '!'
            | '?'
            | '）'
            | ')'
            | '］'
            | ']'
            | '｝'
            | '}'
            | '」'
            | '』'
            | 'ー'
            | '〜'
            | '…'
            | 'っ'
            | 'ゃ'
            | 'ゅ'
            | 'ょ'
            | 'ッ'
            | 'ャ'
            | 'ュ'
            | 'ョ'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_horizontal_fit_text_to_bubble() {
        let bubble = SpeechBubble::new(
            1,
            BoundingBox::new(100.0, 100.0, 200.0, 150.0),
            crate::bubble::BubbleKind::Dialogue,
            0.95,
        );

        let style = TextStyle::default();
        let layout = TypesetEngine::fit_text_to_bubble(
            "Bonjour Goku ! Nous devons rassembler les Dragon Balls immédiatement.",
            &bubble,
            &style,
        );

        assert!(layout.fits);
        assert!(!layout.lines.is_empty());
        assert!(layout.font_size >= style.min_font_size);
    }

    #[test]
    fn test_vertical_rl_kinsoku_shori() {
        assert!(is_gyoto_kinsoku('！'));
        assert!(is_gyoto_kinsoku('。'));
        assert!(!is_gyoto_kinsoku('カ'));
    }
}
