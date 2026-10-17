// SPDX-License-Identifier: Apache-2.0
//! Conformance suite every [`Vfs`] backend must pass.
//!
//! ```
//! use aphrody_shell_vfs::{conformance, MemVfs};
//! conformance::run(MemVfs::new);
//! ```
//!
//! The suite assumes only the trait contract (no backend limits) and panics
//! with a descriptive message on the first violation. `make` must return a
//! fresh, empty filesystem each call.

#![allow(clippy::missing_panics_doc)]

use crate::{DirEntry, FileKind, Stat, Vfs, VfsError};

/// Run every case against fresh instances from `make`.
pub fn run<V: Vfs>(mut make: impl FnMut() -> V) {
    root_and_paths(&mut make());
    files(&mut make());
    directories(&mut make());
    remove(&mut make());
    rename(&mut make());
    helpers(&mut make());
}

fn names(entries: &[DirEntry]) -> Vec<&[u8]> {
    entries.iter().map(|e| e.name.as_slice()).collect()
}

fn root_and_paths<V: Vfs>(v: &mut V) {
    assert_eq!(
        v.stat(b"/"),
        Ok(Stat {
            kind: FileKind::Dir,
            size: 0
        }),
        "root is a dir"
    );
    assert_eq!(v.read_dir(b"/"), Ok(vec![]), "root starts empty");
    assert_eq!(v.stat(b"/nope"), Err(VfsError::NotFound));
    assert_eq!(v.stat(b"relative"), Err(VfsError::InvalidPath));
    assert_eq!(v.stat(b""), Err(VfsError::InvalidPath));
    assert_eq!(v.write(b"/a\0b", b"x"), Err(VfsError::InvalidPath));
    v.write(b"/f", b"1").expect("write");
    assert_eq!(
        v.read(b"//./x/../f/"),
        Ok(b"1".to_vec()),
        "paths are normalised"
    );
    assert_eq!(
        v.stat(b"/../../f").map(|s| s.size),
        Ok(1),
        ".. clamps at root"
    );
}

fn files<V: Vfs>(v: &mut V) {
    v.write(b"/f", b"hello").expect("create");
    assert_eq!(v.read(b"/f"), Ok(b"hello".to_vec()));
    assert_eq!(
        v.stat(b"/f"),
        Ok(Stat {
            kind: FileKind::File,
            size: 5
        })
    );
    v.write(b"/f", b"hi").expect("truncate");
    assert_eq!(v.read(b"/f"), Ok(b"hi".to_vec()), "write truncates");
    v.write(b"/empty", b"").expect("empty file");
    assert_eq!(v.read(b"/empty"), Ok(vec![]));
    let bin: Vec<u8> = (0..=255u8).collect();
    v.write(b"/bin", &bin).expect("binary");
    assert_eq!(v.read(b"/bin"), Ok(bin), "binary safe");
    assert_eq!(v.read(b"/missing"), Err(VfsError::NotFound));
    assert_eq!(v.write(b"/no/parent", b"x"), Err(VfsError::NotFound));
    assert_eq!(v.write(b"/f/child", b"x"), Err(VfsError::NotADirectory));
    v.mkdir(b"/d").expect("mkdir");
    assert_eq!(v.write(b"/d", b"x"), Err(VfsError::IsADirectory));
    assert_eq!(v.read(b"/d"), Err(VfsError::IsADirectory));
    let non_utf8 = b"/\xff\xfe";
    v.write(non_utf8, b"raw").expect("non-utf8 name");
    assert_eq!(v.read(non_utf8), Ok(b"raw".to_vec()));
}

fn directories<V: Vfs>(v: &mut V) {
    v.mkdir(b"/d").expect("mkdir");
    assert_eq!(v.mkdir(b"/d"), Err(VfsError::AlreadyExists));
    assert_eq!(v.mkdir(b"/"), Err(VfsError::AlreadyExists));
    assert_eq!(v.mkdir(b"/x/y"), Err(VfsError::NotFound));
    v.write(b"/f", b"").expect("file");
    assert_eq!(v.mkdir(b"/f"), Err(VfsError::AlreadyExists));
    assert_eq!(v.mkdir(b"/f/y"), Err(VfsError::NotADirectory));
    v.write(b"/d/b", b"1").unwrap();
    v.write(b"/d/a", b"22").unwrap();
    v.mkdir(b"/d/c").unwrap();
    v.write(b"/d/c/deep", b"x").unwrap();
    let list = v.read_dir(b"/d").expect("read_dir");
    assert_eq!(
        names(&list),
        [&b"a"[..], b"b", b"c"],
        "sorted, direct children only"
    );
    assert_eq!(list[0].kind, FileKind::File);
    assert_eq!(list[2].kind, FileKind::Dir);
    assert_eq!(v.read_dir(b"/f"), Err(VfsError::NotADirectory));
    assert_eq!(v.read_dir(b"/zzz"), Err(VfsError::NotFound));
    v.mkdir(b"/d2").unwrap();
    assert_eq!(
        names(&v.read_dir(b"/d").unwrap()).len(),
        3,
        "sibling with shared prefix not listed"
    );
}

fn remove<V: Vfs>(v: &mut V) {
    v.mkdir(b"/d").unwrap();
    v.write(b"/d/f", b"x").unwrap();
    assert_eq!(v.remove(b"/d"), Err(VfsError::DirectoryNotEmpty));
    assert_eq!(v.remove(b"/"), Err(VfsError::InvalidInput));
    assert_eq!(v.remove(b"/zzz"), Err(VfsError::NotFound));
    v.remove(b"/d/f").expect("remove file");
    assert_eq!(v.read(b"/d/f"), Err(VfsError::NotFound));
    v.remove(b"/d").expect("remove empty dir");
    assert!(!v.exists(b"/d"));
}

fn rename<V: Vfs>(v: &mut V) {
    v.write(b"/a", b"A").unwrap();
    v.rename(b"/a", b"/b").expect("rename file");
    assert_eq!(v.read(b"/a"), Err(VfsError::NotFound));
    assert_eq!(v.read(b"/b"), Ok(b"A".to_vec()));
    v.write(b"/c", b"C").unwrap();
    v.rename(b"/b", b"/c").expect("replace file");
    assert_eq!(v.read(b"/c"), Ok(b"A".to_vec()));
    v.rename(b"/c", b"/c").expect("self rename is a no-op");
    assert_eq!(v.read(b"/c"), Ok(b"A".to_vec()));
    assert_eq!(v.rename(b"/nope", b"/x"), Err(VfsError::NotFound));
    assert_eq!(v.rename(b"/c", b"/no/x"), Err(VfsError::NotFound));

    v.mkdir_all(b"/src/sub").unwrap();
    v.write(b"/src/sub/f", b"F").unwrap();
    v.write(b"/src/g", b"G").unwrap();
    v.mkdir(b"/dst").unwrap();
    v.rename(b"/src", b"/dst").expect("dir over empty dir");
    assert_eq!(v.read(b"/dst/sub/f"), Ok(b"F".to_vec()), "subtree moved");
    assert_eq!(v.read(b"/dst/g"), Ok(b"G".to_vec()));
    assert!(!v.exists(b"/src"));
    assert_eq!(
        v.rename(b"/dst", b"/dst/sub/in"),
        Err(VfsError::InvalidInput)
    );
    v.mkdir(b"/full").unwrap();
    v.write(b"/full/x", b"").unwrap();
    assert_eq!(
        v.rename(b"/dst", b"/full"),
        Err(VfsError::DirectoryNotEmpty)
    );
    assert_eq!(v.rename(b"/c", b"/dst"), Err(VfsError::IsADirectory));
    assert_eq!(v.rename(b"/dst", b"/c"), Err(VfsError::NotADirectory));
    assert_eq!(v.rename(b"/", b"/r"), Err(VfsError::InvalidInput));
}

fn helpers<V: Vfs>(v: &mut V) {
    v.append(b"/log", b"a").expect("append creates");
    v.append(b"/log", b"b").expect("append appends");
    assert_eq!(v.read(b"/log"), Ok(b"ab".to_vec()));
    v.mkdir_all(b"/p/q/r").expect("mkdir_all");
    v.mkdir_all(b"/p/q/r").expect("mkdir_all idempotent");
    assert_eq!(v.mkdir_all(b"/log/x"), Err(VfsError::NotADirectory));
    v.write(b"/p/q/r/f", b"x").unwrap();
    v.remove_all(b"/p").expect("remove_all");
    assert!(!v.exists(b"/p"));
    assert!(v.exists(b"/log"));
    v.remove_all(b"/").expect("remove_all root empties it");
    assert_eq!(v.read_dir(b"/"), Ok(vec![]));
}
