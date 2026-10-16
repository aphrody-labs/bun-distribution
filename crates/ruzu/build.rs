// SPDX-License-Identifier: GPL-3.0-or-later

fn main() {
    println!("cargo:rerun-if-changed=resources/ruzu.ico");
    println!("cargo:rerun-if-changed=resources/ruzu.manifest");
    println!("cargo:rerun-if-changed=resources/ruzu.rc");

    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        embed_resource::compile("resources/ruzu.rc", embed_resource::NONE)
            .manifest_required()
            .expect("failed to embed the Ruzu Windows icon and manifest");
    }
}
