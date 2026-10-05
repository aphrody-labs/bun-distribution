// SPDX-License-Identifier: Apache-2.0
//! Cross-platform volume tree builder via a directory walk.
//!
//! On Windows the fast path is [`crate::ntfs_win::scan_volume_tree`] (MFT/USN).
//! Everywhere else — and as a non-elevated Windows fallback — this walks the
//! directory with `walkdir` and produces the same [`MftTree`], using synthetic
//! ids (NOT NTFS file reference numbers). Metadata only: name and attributes.
//! `usn` and `timestamp` stay 0 and file size is unset (both are later batches),
//! so the only difference from the MFT tree is the id space.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::mft::{ATTR_DIRECTORY, ATTR_HIDDEN, MftTree, UsnEntry};

/// Build an [`MftTree`] by walking `root` recursively.
///
/// The tree's explicit root is the synthetic id of `root`, so
/// [`MftTree::resolve_path`] renders paths relative to it. Unreadable entries
/// are skipped. A directory gets `ATTR_DIRECTORY`; a leading-dot name gets
/// `ATTR_HIDDEN` (Unix hidden convention). Ids are a per-tree counter and must
/// not be compared across trees or with real FRNs.
#[must_use]
pub fn build_tree_walk(root: &Path) -> MftTree {
    let mut tree = MftTree::new();
    let mut ids: HashMap<PathBuf, u128> = HashMap::new();
    let mut next: u128 = 1;
    let mut root_set = false;

    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        let id = *ids.entry(path.to_path_buf()).or_insert_with(|| {
            // Never hand out an id that MftTree treats as the NTFS root (record number 5).
            while MftTree::is_root(next) {
                next += 1;
            }
            let v = next;
            next += 1;
            v
        });
        // walkdir yields a parent before its children, so the parent id exists.
        let parent_frn = if root_set {
            path.parent().and_then(|p| ids.get(p).copied()).unwrap_or(0)
        } else {
            root_set = true;
            tree.set_root(id);
            0
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let mut attributes = 0u32;
        if entry.file_type().is_dir() {
            attributes |= ATTR_DIRECTORY;
        }
        if name.starts_with('.') {
            attributes |= ATTR_HIDDEN;
        }
        tree.insert(UsnEntry { frn: id, parent_frn, name, attributes, usn: 0, timestamp: 0 });
    }
    tree
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn walks_a_temp_tree_into_a_resolvable_mfttree() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        fs::create_dir(root.join("sub")).expect("sub");
        fs::write(root.join("a.txt"), b"x").expect("a");
        fs::write(root.join("sub").join("b.txt"), b"y").expect("b");
        fs::write(root.join(".hidden"), b"z").expect("hidden");

        let tree = build_tree_walk(root);
        assert!(tree.len() >= 5, "root + sub + 3 files, got {}", tree.len());

        let b = tree.iter().find(|e| e.name == "b.txt").expect("b.txt present");
        let path = tree.resolve_path(b.frn, "ROOT").expect("resolvable");
        assert!(path.ends_with("sub\\b.txt"), "nested path was {path}");

        let hidden = tree.iter().find(|e| e.name == ".hidden").expect(".hidden present");
        assert!(hidden.is_hidden() && !hidden.is_dir());

        let sub = tree.iter().find(|e| e.name == "sub").expect("sub present");
        assert!(sub.is_dir());
        let kids: Vec<&str> = tree.children(sub.frn).map(|e| e.name.as_str()).collect();
        assert_eq!(kids, ["b.txt"]);
    }
}
