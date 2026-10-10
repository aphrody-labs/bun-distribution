// SPDX-License-Identifier: Apache-2.0
//! Native diagnostic entry point for factory qualification without rebuilding the OS engine.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let map = aphrody_winclean::browser::discover(None, None)?;
    if std::env::args().any(|a| a == "--setup") {
        println!("{}", serde_json::to_string_pretty(&aphrody_winclean::browser::setup(&map)?)?);
    } else {
        println!("{}", serde_json::to_string_pretty(&map)?);
    }
    Ok(())
}
