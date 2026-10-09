// SPDX-License-Identifier: Apache-2.0
//! Small Taffy-backed layout builder used by M3 host adapters.

use taffy::prelude::{Dimension, FlexDirection, NodeId, Size, Style, TaffyTree};

/// A solved box in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutBox {
    /// Left edge relative to the parent.
    pub x: f32,
    /// Top edge relative to the parent.
    pub y: f32,
    /// Solved width.
    pub width: f32,
    /// Solved height.
    pub height: f32,
}

/// Layout computation errors from Taffy.
pub type LayoutError = taffy::TaffyError;

/// Owned layout tree with helpers for common M3 column and fixed-size leaf nodes.
pub struct LayoutTree {
    tree: TaffyTree<()>,
}

impl Default for LayoutTree {
    fn default() -> Self {
        Self::new()
    }
}

impl LayoutTree {
    /// Create an empty layout tree.
    #[must_use]
    pub fn new() -> Self {
        Self { tree: TaffyTree::new() }
    }

    /// Add a fixed-size leaf.
    pub fn leaf(&mut self, width: f32, height: f32) -> NodeId {
        self.tree
            .new_leaf(Style {
                size: Size { width: Dimension::length(width), height: Dimension::length(height) },
                ..Style::default()
            })
            .expect("new Taffy leaf should be valid")
    }

    /// Add a column container that stretches children along its cross axis.
    pub fn column(&mut self, children: Vec<NodeId>) -> NodeId {
        self.tree
            .new_with_children(
                Style { flex_direction: FlexDirection::Column, ..Style::default() },
                &children,
            )
            .expect("new Taffy column should be valid")
    }

    /// Compute a root at a definite viewport and return its solved box.
    pub fn compute(&mut self, root: NodeId, width: f32, height: f32) -> Result<LayoutBox, LayoutError> {
        self.tree.compute_layout(root, Size { width: taffy::AvailableSpace::Definite(width), height: taffy::AvailableSpace::Definite(height) })?;
        let layout = self.tree.layout(root)?;
        Ok(LayoutBox { x: layout.location.x, y: layout.location.y, width: layout.size.width, height: layout.size.height })
    }
}

#[cfg(test)]
mod tests {
    use super::LayoutTree;

    #[test]
    fn column_children_participate_in_intrinsic_layout() {
        let mut tree = LayoutTree::new();
        let first = tree.leaf(80.0, 24.0);
        let second = tree.leaf(120.0, 32.0);
        let root = tree.column(vec![first, second]);
        let layout = tree.compute(root, 320.0, 240.0).unwrap();
        assert_eq!((layout.width, layout.height), (120.0, 56.0));
    }
}
