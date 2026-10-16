fn main() {
    // Native JIT/profiling features remain in the retained source, but are not
    // exposed by this measured interpreter restoration.
    println!(
        "cargo:rustc-check-cfg=cfg(feature, values(\"jit\", \"jit-stats\", \"profile\", \"gx-stats\", \"hotpath\", \"audio-wav-dump\", \"vtx-jit-validate\"))"
    );
    for name in ["gekko", "dsp", "wii_gekko", "wii_dsp"] {
        chipi_build::generate_bindings(format!("spec/{name}.bindings.chipi"))
            .unwrap_or_else(|error| panic!("Wii {name} codegen failed: {error}"));
    }
}
