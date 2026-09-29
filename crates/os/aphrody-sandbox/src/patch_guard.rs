// SPDX-License-Identifier: Apache-2.0
//! Path validation for patch application within sandbox bounds.

use std::path::Path;

use crate::{denial::SandboxDenial, policy::SandboxPolicy};

/// Verifies that all file paths targeted by an `apply_patch` operation
/// are authorized for writing according to `policy`.
///
/// Returns `Ok(())` if all paths are writable, or the first [`SandboxDenial`] encountered.
pub fn verify_patch_paths<'a, I>(paths: I, policy: &SandboxPolicy) -> Result<(), SandboxDenial>
where
    I: IntoIterator<Item = &'a Path>,
{
    for path in paths {
        // Check protected subpaths first for clearer diagnostic
        for subpath in &policy.read_only_subpaths {
            if path.components().any(|c| c.as_os_str() == subpath.as_os_str()) {
                return Err(SandboxDenial::protected_subpath(path));
            }
        }

        if !policy.is_path_writable(path) {
            return Err(SandboxDenial::write_outside_workspace(path));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn test_verify_patch_paths() {
        let root = if cfg!(windows) { PathBuf::from(r"C:\repo") } else { PathBuf::from("/repo") };
        let policy = SandboxPolicy::workspace_write(&root);

        let valid_paths = [root.join("src").join("lib.rs"), root.join("Cargo.toml")];
        let refs: Vec<&Path> = valid_paths.iter().map(|p| p.as_path()).collect();
        assert!(verify_patch_paths(refs, &policy).is_ok());

        // Target git
        let git_target = root.join(".git").join("hooks").join("pre-commit");
        assert!(verify_patch_paths(vec![git_target.as_path()], &policy).is_err());

        // Target outside
        let outside = if cfg!(windows) {
            PathBuf::from(r"C:\Windows\win.ini")
        } else {
            PathBuf::from("/etc/hosts")
        };
        assert!(verify_patch_paths(vec![outside.as_path()], &policy).is_err());
    }
}
