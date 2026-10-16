fn main() {
    for name in ["gekko", "dsp"] {
        chipi_build::generate_bindings(format!("{name}.bindings.chipi"))
            .unwrap_or_else(|error| panic!("Wii {name} disassembly codegen failed: {error}"));
    }
}
