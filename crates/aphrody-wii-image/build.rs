fn main() {
    // Retained upstream tooling is excluded from the measured DOL/DVD owner.
    println!("cargo:rustc-check-cfg=cfg(feature, values(\"symbols\", \"rvz\"))");
}
