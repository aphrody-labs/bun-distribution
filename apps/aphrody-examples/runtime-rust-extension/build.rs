// SPDX-License-Identifier: Apache-2.0
use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=YOLO_RUNTIME_LIB_DIR");
    let directory = PathBuf::from(
        env::var_os("YOLO_RUNTIME_LIB_DIR")
            .expect("YOLO_RUNTIME_LIB_DIR must name an installed precompiled SDK directory"),
    );
    let filename = match env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("linux") => "libaphrody_ffi.so",
        Ok("macos") => "libaphrody_ffi.dylib",
        Ok("windows") => "aphrody_ffi.lib",
        _ => panic!("this dynamic extension requires a native runtime SDK"),
    };
    assert!(directory.join(filename).is_file(), "precompiled SDK library missing: {filename}");
    println!("cargo:rustc-link-search=native={}", directory.display());
    println!("cargo:rustc-link-lib=dylib=aphrody_ffi");
}
