// SPDX-License-Identifier: Apache-2.0
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let map = bun_windows_winclean::browser::discover(None, None)?;
    if std::env::args().any(|argument| argument == "--setup") {
        println!(
            "{}",
            serde_json::to_string_pretty(&bun_windows_winclean::browser::setup(&map)?)?
        );
    } else {
        println!("{}", serde_json::to_string_pretty(&map)?);
    }
    Ok(())
}
