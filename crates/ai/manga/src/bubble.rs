// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Manga speech bubble analysis, polygon contours, and Japanese reading-order sorting.
//!
//! Inspired by the best-in-class layout techniques in Koharu (speech bubble YOLO detection,
//! contour flow-cells decomposition, reflex-vertex diagonal recovery for twin bubbles,
//! and strict Right-to-Left, Top-to-Bottom manga reading order).

use serde::{Deserialize, Serialize};

/// 2D floating-point point.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    /// X coordinate.
    pub x: f32,
    /// Y coordinate.
    pub y: f32,
}

impl Point {
    /// Create a new 2D point.
    #[must_use]
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

/// Axis-aligned bounding box.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoundingBox {
    /// Leftmost X coordinate.
    pub x: f32,
    /// Topmost Y coordinate.
    pub y: f32,
    /// Width of the box.
    pub width: f32,
    /// Height of the box.
    pub height: f32,
}

impl BoundingBox {
    /// Create a new bounding box.
    #[must_use]
    pub const fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self { x, y, width, height }
    }

    /// Rightmost edge.
    #[must_use]
    pub fn right(&self) -> f32 {
        self.x + self.width
    }

    /// Bottommost edge.
    #[must_use]
    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }

    /// Center of the box.
    #[must_use]
    pub fn center(&self) -> Point {
        Point::new(self.x + self.width * 0.5, self.y + self.height * 0.5)
    }

    /// Area in square pixels.
    #[must_use]
    pub fn area(&self) -> f32 {
        self.width * self.height
    }

    /// Checks if a point is inside the bounding box.
    #[must_use]
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }
}

/// Classification of a manga speech bubble.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum BubbleKind {
    /// Bubble detected without a dialogue/thought/narration subtype.
    Unclassified,
    /// Standard dialogue bubble (oval, smooth edges).
    #[default]
    Dialogue,
    /// Thought bubble (cloud-like, scalloped or detached small bubbles).
    Thought,
    /// Scream, shout, or action bubble (spiky, starburst contour).
    Scream,
    /// Whisper or quiet utterance (dashed or light contour).
    Whisper,
    /// Rectangular caption or narration box (often at panel corners).
    Narration,
    /// Free-floating text directly on the artwork without a defined bubble outline.
    FloatingText,
}

/// A detected manga speech bubble with its geometric contour and text payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeechBubble {
    /// Unique identifier for this bubble.
    pub id: usize,
    /// Axis-aligned bounding box.
    pub bounds: BoundingBox,
    /// Exact polygonal contour vertices (if detected by segmentation).
    pub contour: Vec<Point>,
    /// Classification (dialogue, thought, scream, narration).
    pub kind: BubbleKind,
    /// Detection confidence score in [0.0, 1.0].
    pub confidence: f32,
    /// Reading order index (1-based, right-to-left, top-to-bottom).
    pub reading_order: usize,
    /// Original extracted text (e.g. Japanese OCR).
    pub source_text: Option<String>,
    /// Translated text (e.g. French, English).
    pub translated_text: Option<String>,
}

impl SpeechBubble {
    /// Create a new speech bubble from bounding box and classification.
    #[must_use]
    pub fn new(id: usize, bounds: BoundingBox, kind: BubbleKind, confidence: f32) -> Self {
        // Default contour is the 4 box corners if no segmentation contour is given.
        let contour = vec![
            Point::new(bounds.x, bounds.y),
            Point::new(bounds.right(), bounds.y),
            Point::new(bounds.right(), bounds.bottom()),
            Point::new(bounds.x, bounds.bottom()),
        ];
        Self {
            id,
            bounds,
            contour,
            kind,
            confidence,
            reading_order: 0,
            source_text: None,
            translated_text: None,
        }
    }

    /// Returns true if the aspect ratio indicates vertical Japanese text is likely
    /// (height > 1.15 * width).
    #[must_use]
    pub fn is_vertical_dominant(&self) -> bool {
        self.bounds.height > self.bounds.width * 1.15
    }

    /// Point-in-polygon containment test using ray-casting.
    #[must_use]
    pub fn contains_point(&self, p: Point) -> bool {
        if !self.bounds.contains(p) {
            return false;
        }
        if self.contour.len() < 3 {
            return true;
        }

        let mut inside = false;
        let mut j = self.contour.len() - 1;
        for i in 0..self.contour.len() {
            let pi = self.contour[i];
            let pj = self.contour[j];
            if ((pi.y > p.y) != (pj.y > p.y))
                && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-6) + pi.x)
            {
                inside = !inside;
            }
            j = i;
        }
        inside
    }
}

/// Manga Reading Order: Sorts bubbles in Japanese comic reading order.
///
/// Traditional manga is read:
/// 1. Top to bottom
/// 2. Right to left (reversed from Western comics)
///
/// This function groups bubbles into approximate horizontal panel rows/bands,
/// and within each band, sorts strictly from right to left (`-x`).
pub fn sort_manga_reading_order(bubbles: &mut [SpeechBubble]) {
    if bubbles.len() <= 1 {
        for (i, b) in bubbles.iter_mut().enumerate() {
            b.reading_order = i + 1;
        }
        return;
    }

    // Sort primarily by vertical center, breaking ties with horizontal center.
    bubbles.sort_by(|a, b| {
        let a_center = a.bounds.center();
        let b_center = b.bounds.center();

        // If bubbles overlap vertically significantly (within 40% of their average height),
        // they belong to the same panel band and must be read Right-to-Left (higher X first).
        let avg_h = (a.bounds.height + b.bounds.height) * 0.5;
        let y_diff = (a_center.y - b_center.y).abs();

        if y_diff < avg_h * 0.45 {
            // Same band: right-to-left (descending X)
            b_center.x.partial_cmp(&a_center.x).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            // Different band: top-to-bottom (ascending Y)
            a_center.y.partial_cmp(&b_center.y).unwrap_or(std::cmp::Ordering::Equal)
        }
    });

    for (i, b) in bubbles.iter_mut().enumerate() {
        b.reading_order = i + 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manga_reading_order_sorts_rtl() {
        let mut bubbles = vec![
            SpeechBubble::new(
                1,
                BoundingBox::new(50.0, 100.0, 80.0, 80.0),
                BubbleKind::Dialogue,
                0.95,
            ),
            SpeechBubble::new(
                2,
                BoundingBox::new(300.0, 90.0, 80.0, 80.0),
                BubbleKind::Dialogue,
                0.95,
            ),
            SpeechBubble::new(
                3,
                BoundingBox::new(180.0, 400.0, 90.0, 90.0),
                BubbleKind::Dialogue,
                0.90,
            ),
        ];

        sort_manga_reading_order(&mut bubbles);

        // Top band (y ~ 90-100): bubble at x=300 must be read BEFORE bubble at x=50.
        // Bottom band (y ~ 400): bubble 3 is read last.
        assert_eq!(bubbles[0].id, 2, "Rightmost bubble on top band should be #1");
        assert_eq!(bubbles[1].id, 1, "Left bubble on top band should be #2");
        assert_eq!(bubbles[2].id, 3, "Bottom bubble should be #3");
        assert_eq!(bubbles[0].reading_order, 1);
        assert_eq!(bubbles[1].reading_order, 2);
        assert_eq!(bubbles[2].reading_order, 3);
    }

    #[test]
    fn test_point_in_polygon() {
        let bubble = SpeechBubble::new(
            1,
            BoundingBox::new(10.0, 10.0, 100.0, 100.0),
            BubbleKind::Dialogue,
            0.9,
        );

        assert!(bubble.contains_point(Point::new(50.0, 50.0)));
        assert!(!bubble.contains_point(Point::new(5.0, 50.0)));
        assert!(!bubble.contains_point(Point::new(150.0, 50.0)));
    }
}
