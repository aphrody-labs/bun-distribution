<!-- SPDX-License-Identifier: MIT -->
# Integrated Aphrody Taffy patches

The package remains `taffy` 0.12.1, under its original MIT licence and feature ABI.
The private fork revision `4cd8b38fc06e1dcec43c13b6962e6e1e87064ec8` remains
historical provenance. The 2026-10-07 move from `crates/vendor/taffy` to
`crates/ui/taffy` initially preserved all 54 source files byte for byte.
`MIGRATION.json` retains the earlier import hashes and records subsequent local patches.

## Retained node removal, 2026-10-07

`src/tree/taffy_tree.rs`, `TaffyTree::remove` now removes the node's measurement
context and invalidates its former parent's ancestor caches. A repeated removal
returns `InvalidInputNode` instead of indexing a stale slot. The return type,
node identity, layout algorithms and existing feature switches are unchanged.

The regression fixture
`removing_measured_child_releases_context_and_invalidates_parent_layout`
computes an 80dp parent from an intrinsic text child, removes the child, checks
that the context destructor ran immediately, and recomputes the parent's width
to zero. It also exercises stale removal. The fixture is enabled for `std` and
`flexbox`; root's serialized factory owns execution and qualification.

Aphrody's bounded component adapter lives in `aphrody-render::layout::components`.
It shares this engine with Obscura, retains nodes per native surface, and validates
opaque context handles, graph IDs, styles and geometry before committing a changed
candidate tree. CSS text parsing/cascade remains with the existing Obscura owner.
