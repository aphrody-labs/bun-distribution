fn cpp11(cc: &mut cc::Build) {
    cc.cpp(true);
    if cfg!(not(all(windows, target_env = "msvc"))) {
        cc.flag("-std=c++11");
    }
}

fn main() {
    println!("cargo:rerun-if-changed=cpp/");

    let mut cc = cc::Build::new();
    cpp11(&mut cc);
    // V8 links its own simdutf implementation into the same Aphrody process.
    // Keep this crate's C ABI while giving its bundled C++ implementation a
    // private namespace, so the two archives define distinct symbols.
    cc.define("simdutf", "aphrody_rio_simdutf");
    cc.file("cpp/simdutfrs.cpp").compile("simdutfrs");
}
