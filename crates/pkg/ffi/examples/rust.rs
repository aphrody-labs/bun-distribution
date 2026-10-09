// SPDX-License-Identifier: Apache-2.0
// cargo run -p aphrody-pkg-ffi --example rust -- <test-store>
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Native Rust callers use the owner directly; no foreign memory contract.
    let root = std::env::args().nth(1).ok_or("pass an explicit test store")?;
    let store = aphrody_pkg_store::Store::new(root);
    let id = store.put(&b"ffi-package"[..], None)?;
    store.verify(&id)?;
    println!("{} {:?}", id.as_str(), store.stats()?);
    Ok(())
}
