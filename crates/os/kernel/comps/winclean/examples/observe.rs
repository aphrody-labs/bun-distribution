// SPDX-License-Identifier: Apache-2.0
//! `cargo run -p aphrody-winclean --example observe` — capture the foreground window.

fn main() -> aphrody_winclean::Result<()> {
    let wc = aphrody_winclean::Winclean::load()?;
    println!("winclean {} (Rust in-process)", wc.version()?);
    let obs = wc
        .computer_observe(
            &aphrody_winclean::ComputerObserveArgs::new().window_handle(0).max_elements(40),
        )?
        .ok()?;
    if let Some(png) = obs.images().first() {
        std::fs::write("foreground.png", &png.bytes).expect("write foreground.png");
        println!("foreground.png: {} bytes", png.bytes.len());
    }
    println!("{}", obs.text());
    Ok(())
}
