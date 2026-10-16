//! Scalar ABI: no caller pointers, provider state or host imports.
//! Exports are deliberately named and versioned; indices are checked before use.
use libm3::{
    Role,
    layout::ApplicationFamily,
    tokens_owner::{scheme::Variant, theme::ThemeRequest},
};

#[unsafe(no_mangle)]
pub extern "C" fn m3_abi_version() -> u32 {
    2
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_color_count() -> u32 {
    Role::ALL.len() as u32
}

/// UTF-8 bytes from the role owner; zero terminates the name or rejects an index.
#[unsafe(no_mangle)]
pub extern "C" fn m3_role_name_byte(role: u32, offset: u32) -> u32 {
    Role::ALL
        .get(role as usize)
        .and_then(|role| role.camel_name().as_bytes().get(offset as usize))
        .map_or(0, |value| u32::from(*value))
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_variant_name_byte(variant: u32, offset: u32) -> u32 {
    Variant::ALL
        .get(variant as usize)
        .and_then(|variant| variant.name().as_bytes().get(offset as usize))
        .map_or(0, |value| u32::from(*value))
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_color(mode: u32, role: u32) -> u32 {
    let Some(role) = Role::ALL.get(role as usize) else {
        return 0;
    };
    if mode > 1 {
        return 0;
    }
    ThemeRequest::default().scheme(mode == 1).argb(*role)
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_variant_count() -> u32 {
    Variant::ALL.len() as u32
}

/// Zero signals an invalid request; valid colors are always opaque ARGB.
#[unsafe(no_mangle)]
pub extern "C" fn m3_seed_color(
    seed: u32,
    variant: u32,
    contrast: f64,
    mode: u32,
    role: u32,
) -> u32 {
    let Some(variant) = Variant::ALL.get(variant as usize) else {
        return 0;
    };
    let Some(role) = Role::ALL.get(role as usize) else {
        return 0;
    };
    if mode > 1 {
        return 0;
    }
    let Ok(request) = ThemeRequest::new(seed, *variant, contrast) else {
        return 0;
    };
    request.scheme(mode == 1).argb(*role)
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_type_size(role: u32) -> f32 {
    libm3::tokens::TYPOGRAPHY
        .0
        .get(role as usize)
        .map_or(0.0, |style| style.size)
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_shape_radius(role: u32) -> u32 {
    libm3::tokens::SHAPES
        .0
        .get(role as usize)
        .map_or(0, |radius| u32::from(*radius))
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_application_navigation(family: u32, width: u32) -> u32 {
    use libm3::layout::Navigation;
    let Some(family) = ApplicationFamily::ALL.get(family as usize) else {
        return u32::MAX;
    };
    match family.layout(width).navigation {
        Navigation::None => 0,
        Navigation::Bar => 1,
        Navigation::RailCollapsed => 2,
        Navigation::RailExpanded => 3,
        Navigation::Drawer => 4,
    }
}
