// SPDX-License-Identifier: Apache-2.0
//! Taffy-backed flexbox layout for M3 component hosts: rows, columns, wrapping, gaps, padding,
//! alignment and flex growth, solved by the workspace Taffy engine (`aphrody-taffy`).

use taffy::prelude::{
    AlignItems, Dimension, FlexDirection, FlexWrap, JustifyContent, LengthPercentage, NodeId,
    Rect as Edges, Size, Style, TaffyTree,
};

/// A solved box in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutBox {
    /// Left edge (relative to the parent from [`LayoutTree::compute`], absolute from
    /// [`LayoutTree::absolute`]).
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Solved width.
    pub width: f32,
    /// Solved height.
    pub height: f32,
}

/// Layout computation errors from Taffy.
pub type LayoutError = taffy::TaffyError;

/// Main-axis direction of a flex container.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Axis {
    /// Children flow left to right.
    Row,
    /// Children flow top to bottom.
    #[default]
    Column,
}

/// Main-axis distribution of a flex container.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Justify {
    /// Pack at the start.
    #[default]
    Start,
    /// Pack in the centre.
    Center,
    /// Pack at the end.
    End,
    /// Spread with the free space between children.
    SpaceBetween,
}

/// Cross-axis alignment of a flex container's children.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Align {
    /// Stretch children across the cross axis.
    #[default]
    Stretch,
    /// Align at the cross start.
    Start,
    /// Centre on the cross axis.
    Center,
    /// Align at the cross end.
    End,
}

/// Padding in logical pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Padding {
    /// Left inset.
    pub left: f32,
    /// Right inset.
    pub right: f32,
    /// Top inset.
    pub top: f32,
    /// Bottom inset.
    pub bottom: f32,
}

impl Padding {
    /// The same inset on every side.
    #[must_use]
    pub const fn all(value: f32) -> Self {
        Self {
            left: value,
            right: value,
            top: value,
            bottom: value,
        }
    }

    /// Horizontal and vertical insets.
    #[must_use]
    pub const fn symmetric(horizontal: f32, vertical: f32) -> Self {
        Self {
            left: horizontal,
            right: horizontal,
            top: vertical,
            bottom: vertical,
        }
    }
}

/// A flex container description.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Flex {
    /// Main axis.
    pub axis: Axis,
    /// Whether children wrap onto new lines.
    pub wrap: bool,
    /// Gap between children (and between wrapped lines).
    pub gap: f32,
    /// Inner padding.
    pub padding: Padding,
    /// Main-axis distribution.
    pub justify: Justify,
    /// Cross-axis alignment.
    pub align: Align,
    /// Fixed width, when definite.
    pub width: Option<f32>,
    /// Fixed height, when definite.
    pub height: Option<f32>,
    /// Flex grow factor inside its own parent.
    pub grow: f32,
}

impl Flex {
    /// A row container.
    #[must_use]
    pub fn row() -> Self {
        Self {
            axis: Axis::Row,
            ..Self::default()
        }
    }

    /// A column container.
    #[must_use]
    pub fn column() -> Self {
        Self {
            axis: Axis::Column,
            ..Self::default()
        }
    }

    /// Set the gap.
    #[must_use]
    pub const fn gap(mut self, gap: f32) -> Self {
        self.gap = gap;
        self
    }

    /// Enable wrapping.
    #[must_use]
    pub const fn wrap(mut self) -> Self {
        self.wrap = true;
        self
    }

    /// Set the padding.
    #[must_use]
    pub const fn padding(mut self, padding: Padding) -> Self {
        self.padding = padding;
        self
    }

    /// Set the main-axis distribution.
    #[must_use]
    pub const fn justify(mut self, justify: Justify) -> Self {
        self.justify = justify;
        self
    }

    /// Set the cross-axis alignment.
    #[must_use]
    pub const fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }

    /// Fix the width.
    #[must_use]
    pub const fn width(mut self, width: f32) -> Self {
        self.width = Some(width);
        self
    }

    /// Fix the height.
    #[must_use]
    pub const fn height(mut self, height: f32) -> Self {
        self.height = Some(height);
        self
    }

    /// Grow along the parent's main axis.
    #[must_use]
    pub const fn grow(mut self, grow: f32) -> Self {
        self.grow = grow;
        self
    }

    fn style(self) -> Style {
        let length = |value: Option<f32>| value.map_or(Dimension::auto(), Dimension::length);
        Style {
            flex_direction: match self.axis {
                Axis::Row => FlexDirection::Row,
                Axis::Column => FlexDirection::Column,
            },
            flex_wrap: if self.wrap {
                FlexWrap::Wrap
            } else {
                FlexWrap::NoWrap
            },
            gap: Size {
                width: LengthPercentage::length(self.gap),
                height: LengthPercentage::length(self.gap),
            },
            padding: Edges {
                left: LengthPercentage::length(self.padding.left),
                right: LengthPercentage::length(self.padding.right),
                top: LengthPercentage::length(self.padding.top),
                bottom: LengthPercentage::length(self.padding.bottom),
            },
            justify_content: Some(match self.justify {
                Justify::Start => JustifyContent::FLEX_START,
                Justify::Center => JustifyContent::CENTER,
                Justify::End => JustifyContent::FLEX_END,
                Justify::SpaceBetween => JustifyContent::SPACE_BETWEEN,
            }),
            align_items: Some(match self.align {
                Align::Stretch => AlignItems::STRETCH,
                Align::Start => AlignItems::FLEX_START,
                Align::Center => AlignItems::CENTER,
                Align::End => AlignItems::FLEX_END,
            }),
            size: Size {
                width: length(self.width),
                height: length(self.height),
            },
            flex_grow: self.grow,
            ..Style::default()
        }
    }
}

/// Owned layout tree with helpers for M3 rows, columns and fixed-size leaves.
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
        Self {
            tree: TaffyTree::new(),
        }
    }

    /// Add a fixed-size leaf.
    pub fn leaf(&mut self, width: f32, height: f32) -> NodeId {
        self.sized_leaf(width, height, 0.0)
    }

    /// Add a leaf with a fixed cross size and a basis that grows by `grow` along the main axis.
    pub fn sized_leaf(&mut self, width: f32, height: f32, grow: f32) -> NodeId {
        self.tree
            .new_leaf(Style {
                size: Size {
                    width: Dimension::length(width),
                    height: Dimension::length(height),
                },
                flex_grow: grow,
                flex_shrink: if grow > 0.0 { 1.0 } else { 0.0 },
                ..Style::default()
            })
            .expect("new Taffy leaf should be valid")
    }

    /// Add a flex container.
    pub fn flex(&mut self, flex: Flex, children: &[NodeId]) -> NodeId {
        self.tree
            .new_with_children(flex.style(), children)
            .expect("new Taffy container should be valid")
    }

    /// Add a column container that stretches children along its cross axis.
    pub fn column(&mut self, children: Vec<NodeId>) -> NodeId {
        self.flex(Flex::column(), &children)
    }

    /// Add a row container.
    pub fn row(&mut self, children: Vec<NodeId>) -> NodeId {
        self.flex(Flex::row(), &children)
    }

    /// Compute a root at a definite viewport and return its solved box.
    pub fn compute(
        &mut self,
        root: NodeId,
        width: f32,
        height: f32,
    ) -> Result<LayoutBox, LayoutError> {
        self.tree.compute_layout(
            root,
            Size {
                width: taffy::AvailableSpace::Definite(width),
                height: taffy::AvailableSpace::Definite(height),
            },
        )?;
        self.relative(root)
    }

    /// Solved box of `node` relative to its parent.
    pub fn relative(&self, node: NodeId) -> Result<LayoutBox, LayoutError> {
        let layout = self.tree.layout(node)?;
        Ok(LayoutBox {
            x: layout.location.x,
            y: layout.location.y,
            width: layout.size.width,
            height: layout.size.height,
        })
    }

    /// Solved box of `node` relative to the root it was computed under.
    pub fn absolute(&self, node: NodeId) -> Result<LayoutBox, LayoutError> {
        let mut solved = self.relative(node)?;
        let mut current = node;
        while let Some(parent) = self.tree.parent(current) {
            let offset = self.tree.layout(parent)?.location;
            solved.x += offset.x;
            solved.y += offset.y;
            current = parent;
        }
        Ok(solved)
    }
}

#[cfg(test)]
mod tests {
    use super::{Align, Flex, Justify, LayoutTree, Padding};

    #[test]
    fn column_children_participate_in_intrinsic_layout() {
        let mut tree = LayoutTree::new();
        let first = tree.leaf(80.0, 24.0);
        let second = tree.leaf(120.0, 32.0);
        let root = tree.column(vec![first, second]);
        let layout = tree.compute(root, 320.0, 240.0).unwrap();
        assert_eq!((layout.width, layout.height), (120.0, 56.0));
    }

    #[test]
    fn row_gap_padding_and_end_justification() {
        let mut tree = LayoutTree::new();
        let a = tree.leaf(40.0, 40.0);
        let b = tree.leaf(60.0, 40.0);
        let root = tree.flex(
            Flex::row()
                .gap(8.0)
                .padding(Padding::all(24.0))
                .justify(Justify::End)
                .width(300.0),
            &[a, b],
        );
        tree.compute(root, 300.0, 200.0).unwrap();
        let a_box = tree.absolute(a).unwrap();
        let b_box = tree.absolute(b).unwrap();
        assert_eq!((b_box.x + b_box.width, b_box.y), (276.0, 24.0));
        assert_eq!(a_box.x, b_box.x - 8.0 - 40.0);
    }

    #[test]
    fn wrap_moves_overflowing_children_to_a_new_line() {
        let mut tree = LayoutTree::new();
        let chips: Vec<_> = (0..3).map(|_| tree.leaf(90.0, 32.0)).collect();
        let root = tree.flex(
            Flex::row().wrap().gap(8.0).width(200.0).align(Align::Start),
            &chips,
        );
        tree.compute(root, 200.0, 400.0).unwrap();
        let third = tree.absolute(chips[2]).unwrap();
        assert_eq!((third.x, third.y), (0.0, 40.0));
    }

    #[test]
    fn grow_shares_the_free_space() {
        let mut tree = LayoutTree::new();
        let a = tree.sized_leaf(0.0, 64.0, 1.0);
        let b = tree.sized_leaf(0.0, 64.0, 1.0);
        let root = tree.flex(Flex::row().width(200.0).align(Align::Center), &[a, b]);
        tree.compute(root, 200.0, 64.0).unwrap();
        assert_eq!(tree.absolute(b).unwrap().x, 100.0);
    }
}
