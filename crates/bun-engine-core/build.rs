// With the `steam` feature on Windows/MSVC, `steam_api64.dll` is delay-loaded: the binaries still
// start without the Steamworks redistributable and `bun_engine::steam` reports it missing.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let target = std::env::var("TARGET").unwrap_or_default();
    if std::env::var_os("CARGO_FEATURE_STEAM").is_some() && target.contains("windows-msvc") {
        let dll = if target.starts_with("i686") { "steam_api.dll" } else { "steam_api64.dll" };
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:{dll}");
        println!("cargo:rustc-link-arg-bins=delayimp.lib");
    }
}
