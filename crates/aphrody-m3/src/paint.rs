// SPDX-License-Identifier: Apache-2.0
//! Turn component [`Part`]s into `aphrody_render` scene nodes for the native CPU/GPU renderers.

use aphrody_m3_tokens::facade::color::DynamicScheme;
use aphrody_render::scene::{
    Corners, Node, Outline, Paint, Rect as SceneRect, Rgba8, StateKind, TypeStyleName,
};

use crate::interaction::StateLayer;
use crate::visual::{Glyph, Part, Radii, Rect, Tint};

/// Material Icons `check` (24x24 view box).
pub const CHECK_PATH: &str = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
/// Material Icons `remove` (24x24 view box), the indeterminate checkbox bar.
pub const INDETERMINATE_PATH: &str = "M19 13H5v-2h14v2z";

/// Resolves a Material Symbol name to SVG path data in a 24x24 view box.
pub trait SymbolPaths {
    /// Path data for `name`, or `None` to skip the glyph.
    fn path(&self, name: &str) -> Option<String>;
}

/// No symbol font available: only the built-in check and indeterminate glyphs are drawn.
pub struct NoSymbols;

impl SymbolPaths for NoSymbols {
    fn path(&self, _name: &str) -> Option<String> {
        None
    }
}

impl<F: Fn(&str) -> Option<String>> SymbolPaths for F {
    fn path(&self, name: &str) -> Option<String> {
        self(name)
    }
}

fn paint(tint: Tint, scheme: &DynamicScheme) -> Paint {
    if tint.opacity >= 1.0 {
        Paint::Role(tint.role)
    } else {
        Paint::Fixed(Rgba8::from_argb(scheme.argb(tint.role)).with_alpha_factor(tint.opacity))
    }
}

fn rect(r: Rect, scale: f32) -> SceneRect {
    SceneRect::new(r.x * scale, r.y * scale, r.w * scale, r.h * scale)
}

fn corners(r: Radii, scale: f32) -> Corners {
    Corners {
        tl: r.tl * scale,
        tr: r.tr * scale,
        br: r.br * scale,
        bl: r.bl * scale,
    }
}

/// The renderer strokes outlines centred on the edge; parts describe strokes inside the bounds.
fn inner_stroke(r: Rect, radii: Radii, width: f32) -> (Rect, Radii) {
    let half = width / 2.0;
    let shrink = |v: f32| (v - half).max(0.0);
    (
        r.inflate(-half),
        Radii {
            tl: shrink(radii.tl),
            tr: shrink(radii.tr),
            br: shrink(radii.br),
            bl: shrink(radii.bl),
        },
    )
}

/// Renderer type style for a system type-scale name.
#[must_use]
pub fn type_style_name(name: &str) -> Option<TypeStyleName> {
    use TypeStyleName as T;
    const ORDER: [TypeStyleName; 15] = [
        T::DisplayLarge,
        T::DisplayMedium,
        T::DisplaySmall,
        T::HeadlineLarge,
        T::HeadlineMedium,
        T::HeadlineSmall,
        T::TitleLarge,
        T::TitleMedium,
        T::TitleSmall,
        T::BodyLarge,
        T::BodyMedium,
        T::BodySmall,
        T::LabelLarge,
        T::LabelMedium,
        T::LabelSmall,
    ];
    aphrody_m3_tokens::typography::NAMES
        .iter()
        .position(|candidate| *candidate == name)
        .map(|index| ORDER[index])
}

const fn state_kind(layer: StateLayer) -> StateKind {
    match layer {
        StateLayer::Hover => StateKind::Hover,
        StateLayer::Focus => StateKind::Focus,
        StateLayer::Pressed => StateKind::Pressed,
        StateLayer::Dragged => StateKind::Dragged,
    }
}

/// Convert parts (in dp) to scene nodes (in pixels at `scale` px/dp).
#[must_use]
pub fn to_nodes(
    parts: &[Part],
    scheme: &DynamicScheme,
    scale: f32,
    symbols: &dyn SymbolPaths,
) -> Vec<Node> {
    let mut nodes = Vec::with_capacity(parts.len());
    for part in parts {
        match part {
            Part::Surface {
                rect: r,
                radii,
                fill,
                outline,
                elevation,
            } => {
                if fill.is_some() || *elevation > 0 {
                    nodes.push(Node::Surface {
                        rect: rect(*r, scale),
                        corners: corners(*radii, scale),
                        fill: fill
                            .map_or(Paint::Fixed(Rgba8::TRANSPARENT), |tint| paint(tint, scheme)),
                        elevation: *elevation,
                        outline: None,
                    });
                }
                if let Some((tint, width)) = outline {
                    let (r, radii) = inner_stroke(*r, *radii, *width);
                    nodes.push(Node::Surface {
                        rect: rect(r, scale),
                        corners: corners(radii, scale),
                        fill: Paint::Fixed(Rgba8::TRANSPARENT),
                        elevation: 0,
                        outline: Some(Outline {
                            color: paint(*tint, scheme),
                            width: width * scale,
                        }),
                    });
                }
            }
            Part::StateLayer {
                rect: r,
                radii,
                role,
                layer,
            } => nodes.push(Node::StateLayer {
                rect: rect(*r, scale),
                corners: corners(*radii, scale),
                content: Paint::Role(*role),
                state: state_kind(*layer),
            }),
            Part::FocusRing {
                rect: r,
                radii,
                role,
                thickness,
            } => {
                let (r, radii) = inner_stroke(*r, *radii, *thickness);
                nodes.push(Node::Surface {
                    rect: rect(r, scale),
                    corners: corners(radii, scale),
                    fill: Paint::Fixed(Rgba8::TRANSPARENT),
                    elevation: 0,
                    outline: Some(Outline {
                        color: Paint::Role(*role),
                        width: thickness * scale,
                    }),
                });
            }
            Part::Glyph {
                rect: r,
                glyph,
                tint,
            } => {
                let path = match glyph {
                    Glyph::Check => Some(CHECK_PATH.to_owned()),
                    Glyph::Indeterminate => Some(INDETERMINATE_PATH.to_owned()),
                    Glyph::Symbol(name) => symbols.path(name),
                };
                if let Some(path) = path {
                    nodes.push(Node::Icon {
                        rect: rect(*r, scale),
                        path,
                        color: paint(*tint, scheme),
                    });
                }
            }
            Part::Label {
                rect: r,
                text,
                style,
                tint,
            } => {
                if let Some(style) = type_style_name(style) {
                    nodes.push(Node::Text {
                        rect: rect(*r, scale),
                        text: text.clone(),
                        style,
                        color: paint(*tint, scheme),
                    });
                }
            }
        }
    }
    nodes
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::component::{checkbox, switch};
    use aphrody_render::raster::render_scene;
    use aphrody_render::scene::{Paint, Rgba8, Scene};

    use super::{NoSymbols, to_nodes, type_style_name};
    use crate::controls::{CheckState, Checkbox, Control, Switch};
    use crate::interaction::Interaction;
    use crate::visual::Rect;

    fn scene(nodes: Vec<aphrody_render::scene::Node>, size: u32) -> Scene {
        Scene {
            width: size,
            height: size,
            seed_argb: 0xFF67_50A4,
            variant: aphrody_m3_tokens::facade::color::Variant::TonalSpot,
            is_dark: false,
            contrast_level: 0.0,
            background: Some(Paint::Role(aphrody_m3_tokens::scheme::Role::Surface)),
            nodes,
        }
    }

    fn pixel(canvas: &aphrody_render::raster::Canvas, x: u32, y: u32) -> Rgba8 {
        let i = ((y * canvas.width + x) * 4) as usize;
        Rgba8 {
            r: canvas.pixels[i],
            g: canvas.pixels[i + 1],
            b: canvas.pixels[i + 2],
            a: canvas.pixels[i + 3],
        }
    }

    #[test]
    fn checked_checkbox_paints_primary_container_and_on_primary_check() {
        let mut checkbox = Checkbox::new("Accept");
        checkbox.state = CheckState::Checked;
        let probe = scene(Vec::new(), 48);
        let scheme = probe.scheme();
        let nodes = to_nodes(
            &checkbox.parts(Rect::new(0.0, 0.0, 48.0, 48.0), Interaction::IDLE),
            &scheme,
            1.0,
            &NoSymbols,
        );
        let canvas = render_scene(&scene(nodes, 48));
        let primary = Rgba8::from_argb(scheme.argb(checkbox::SELECTED_CONTAINER_COLOR));
        // Container edge (inside the 18 dp box, away from the check stroke).
        assert_eq!(pixel(&canvas, 16, 16), primary);
        // Outside the 18 dp container the surface shows through.
        let surface = Rgba8::from_argb(scheme.argb(aphrody_m3_tokens::scheme::Role::Surface));
        assert_eq!(pixel(&canvas, 4, 4), surface);
        // The check glyph centre stroke is on-primary.
        let on_primary = Rgba8::from_argb(scheme.argb(checkbox::SELECTED_ICON_COLOR));
        assert_eq!(pixel(&canvas, 22, 27), on_primary);
    }

    #[test]
    fn switch_track_and_handle_resolve_token_roles() {
        let mut toggle = Switch::new("Wi-Fi");
        toggle.selected = true;
        let probe = scene(Vec::new(), 64);
        let scheme = probe.scheme();
        let nodes = to_nodes(
            &toggle.parts(Rect::new(6.0, 16.0, 52.0, 32.0), Interaction::IDLE),
            &scheme,
            1.0,
            &NoSymbols,
        );
        let canvas = render_scene(&scene(nodes, 64));
        let track = Rgba8::from_argb(scheme.argb(switch::SELECTED_TRACK_COLOR));
        let handle = Rgba8::from_argb(scheme.argb(switch::SELECTED_HANDLE_COLOR));
        assert_eq!(pixel(&canvas, 20, 32), track);
        // Selected handle: 24 dp, centred 16 dp from the track end.
        assert_eq!(pixel(&canvas, 42, 32), handle);
    }

    #[test]
    fn type_names_map_to_renderer_styles() {
        assert!(type_style_name("label-large").is_some());
        assert!(type_style_name("label-huge").is_none());
    }
}
