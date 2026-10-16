// SPDX-License-Identifier: Apache-2.0
fn main() -> bun_windows_winclean::Result<()> {
    let runtime = bun_windows_winclean::Winclean::load()?;
    println!("winclean {} (Bun Windows SDK)", runtime.version()?);
    let observation = runtime
        .computer_observe(
            &bun_windows_winclean::ComputerObserveArgs::new().window_handle(0).max_elements(40),
        )?
        .ok()?;
    if let Some(png) = observation.images().first() {
        std::fs::write("foreground.png", &png.bytes).expect("write foreground.png");
        println!("foreground.png: {} bytes", png.bytes.len());
    }
    println!("{}", observation.text());
    Ok(())
}
