// SPDX-License-Identifier: Apache-2.0
//! Byte-path normalisation. Normal form: `/` or `/a/b` (absolute, no `.`,
//! `..`, empty components or trailing slash). `..` at the root stays at root.

use crate::{VfsError, VfsResult};

/// Maximum normalised path length in bytes.
pub const MAX_PATH_LEN: usize = 4096;
/// Maximum length of one component in bytes.
pub const MAX_NAME_LEN: usize = 255;

/// Normalise an absolute path.
///
/// # Errors
/// [`VfsError::InvalidPath`] when the path is empty, relative, contains NUL,
/// or exceeds [`MAX_PATH_LEN`] / [`MAX_NAME_LEN`].
pub fn normalize(path: &[u8]) -> VfsResult<Vec<u8>> {
    if path.first() != Some(&b'/') {
        return Err(VfsError::InvalidPath);
    }
    normalize_from(Vec::new(), path)
}

/// Resolve `path` against absolute `cwd`; absolute `path` ignores `cwd`.
///
/// # Errors
/// [`VfsError::InvalidPath`] as for [`normalize`] (`cwd` must be absolute).
pub fn resolve(cwd: &[u8], path: &[u8]) -> VfsResult<Vec<u8>> {
    if path.first() == Some(&b'/') {
        return normalize(path);
    }
    if cwd.first() != Some(&b'/') {
        return Err(VfsError::InvalidPath);
    }
    let base: Vec<Vec<u8>> = components(cwd).map(<[u8]>::to_vec).collect();
    normalize_from(base, path)
}

fn normalize_from(mut stack: Vec<Vec<u8>>, path: &[u8]) -> VfsResult<Vec<u8>> {
    if path.contains(&0) {
        return Err(VfsError::InvalidPath);
    }
    for comp in path.split(|b| *b == b'/') {
        match comp {
            b"" | b"." => {}
            b".." => {
                stack.pop();
            }
            c if c.len() > MAX_NAME_LEN => return Err(VfsError::InvalidPath),
            c => stack.push(c.to_vec()),
        }
    }
    let mut out = Vec::new();
    for c in &stack {
        out.push(b'/');
        out.extend_from_slice(c);
    }
    if out.is_empty() {
        out.push(b'/');
    }
    if out.len() > MAX_PATH_LEN {
        return Err(VfsError::InvalidPath);
    }
    Ok(out)
}

/// Components of a path (split on `/`, empty ones skipped). Does not normalise.
pub fn components(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    path.split(|b| *b == b'/').filter(|c| !c.is_empty())
}

/// Join an already-normalised directory and one component.
#[must_use]
pub fn join(dir: &[u8], name: &[u8]) -> Vec<u8> {
    let mut out = dir.to_vec();
    if out.last() != Some(&b'/') {
        out.push(b'/');
    }
    out.extend_from_slice(name);
    out
}

/// Parent of a normalised path and its final component; `None` for the root.
#[must_use]
pub fn split_parent(norm: &[u8]) -> Option<(&[u8], &[u8])> {
    if norm == b"/" {
        return None;
    }
    let idx = norm.iter().rposition(|b| *b == b'/')?;
    let parent = if idx == 0 { &norm[..1] } else { &norm[..idx] };
    Some((parent, &norm[idx + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basics() {
        assert_eq!(normalize(b"/").unwrap(), b"/");
        assert_eq!(normalize(b"//a/./b//../c/").unwrap(), b"/a/c");
        assert_eq!(normalize(b"/../..").unwrap(), b"/");
        assert_eq!(normalize(b"a"), Err(VfsError::InvalidPath));
        assert_eq!(normalize(b""), Err(VfsError::InvalidPath));
        assert_eq!(normalize(b"/a\0b"), Err(VfsError::InvalidPath));
        assert_eq!(
            normalize(&[b"/".as_slice(), &[b'x'; 256]].concat()),
            Err(VfsError::InvalidPath)
        );
        assert_eq!(
            normalize(&[b"/".as_slice(), &[b'x'; 255]].concat())
                .unwrap()
                .len(),
            256
        );
    }

    #[test]
    fn resolve_relative() {
        assert_eq!(resolve(b"/a/b", b"../c").unwrap(), b"/a/c");
        assert_eq!(resolve(b"/a", b"/x/./y").unwrap(), b"/x/y");
        assert_eq!(resolve(b"/", b"..").unwrap(), b"/");
        assert_eq!(resolve(b"rel", b"x"), Err(VfsError::InvalidPath));
    }

    #[test]
    fn parent_split() {
        assert_eq!(split_parent(b"/"), None);
        assert_eq!(split_parent(b"/a"), Some((&b"/"[..], &b"a"[..])));
        assert_eq!(split_parent(b"/a/b"), Some((&b"/a"[..], &b"b"[..])));
        assert_eq!(join(b"/", b"a"), b"/a");
        assert_eq!(join(b"/a", b"b"), b"/a/b");
    }

    /// Deterministic xorshift generator (no dev-dependencies).
    fn rng(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }

    #[test]
    fn property_normal_form_and_idempotence() {
        const ALPHABET: &[&[u8]] = &[b"/", b"/", b".", b"..", b"a", b"bc", b"//", b"./", b"../"];
        let mut s = 0x9E37_79B9_7F4A_7C15_u64;
        for _ in 0..5000 {
            let n = rng(&mut s) % 12;
            let mut p = vec![b'/'];
            for _ in 0..n {
                p.extend_from_slice(ALPHABET[(rng(&mut s) % ALPHABET.len() as u64) as usize]);
            }
            let norm = normalize(&p).unwrap();
            assert_eq!(norm[0], b'/');
            assert!(norm == b"/" || norm.last() != Some(&b'/'));
            assert!(!norm.windows(2).any(|w| w == b"//"));
            assert!(components(&norm).all(|c| c != b"." && c != b".."));
            assert_eq!(normalize(&norm).unwrap(), norm, "idempotent for {p:?}");
            // Resolving against root equals normalising the absolute form.
            assert_eq!(resolve(b"/", &p[1..]).unwrap(), norm);
            // Appending `/x/..` never changes the result.
            let mut q = p.clone();
            q.extend_from_slice(b"/x/..");
            assert_eq!(normalize(&q).unwrap(), norm);
        }
    }
}
