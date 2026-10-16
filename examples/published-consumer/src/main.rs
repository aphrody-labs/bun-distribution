// SPDX-License-Identifier: Apache-2.0
use aphrody_m3::interaction::StateLayer;
use aphrody_m3_tokens::{role::Role, scheme::Variant};
use libm3::{Theme, ThemeMode};

fn main() -> Result<(), String> {
    let theme = Theme::from_seed(ThemeMode::Light, 0xff006c4c, Variant::TonalSpot, 0.0)?;
    // These assignments require identical types across the direct dependency and facade.
    let role: libm3::Role = Role::Primary;
    let layer: StateLayer = libm3::components_owner::interaction::StateLayer::Pressed;
    println!(
        "{{\"roles\":{},\"variants\":{},\"primary\":\"{:08x}\",\"pressedOpacity\":{}}}",
        Role::ALL.len(),
        Variant::ALL.len(),
        theme.colors.get(role).0,
        layer.opacity()
    );
    Ok(())
}
