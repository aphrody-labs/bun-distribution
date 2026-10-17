// SPDX-License-Identifier: Apache-2.0
//! Deterministic benchmark and test scenes.

use aphrody_m3_tokens::facade::color::{Role, Variant};

use crate::{
    mesh3d::Geometry,
    scene::{Corners, Node, Outline, Paint, Rect, Rgba8, Scene, StateKind, TypeStyleName},
    scene3d::{Camera, Light, Material, Node3d, Projection, Scene3d, ShadowSettings, Transform},
};

/// Build a dashboard-like scene with roughly `element_count` M3 surfaces
/// (cards with elevation, outlines, a state layer, an icon and a text label
/// each) tiled over a `width`x`height` canvas. Used by
/// `benches/frame.rs` and the GPU/CPU parity tests.
#[must_use]
pub fn dashboard_scene(width: u32, height: u32, element_count: usize) -> Scene {
    let columns = (element_count as f32).sqrt().ceil().max(1.0) as u32;
    let rows = element_count.div_ceil(columns as usize).max(1) as u32;
    let card_w = (width / columns.max(1)).max(24) as f32 - 8.0;
    let card_h = (height / rows.max(1)).max(24) as f32 - 8.0;

    let mut nodes = Vec::with_capacity(element_count * 4);
    let mut placed = 0_usize;
    'outer: for row in 0..rows {
        for col in 0..columns {
            if placed >= element_count {
                break 'outer;
            }
            let x = f32::from(col as u16) * (card_w + 8.0) + 4.0;
            let y = f32::from(row as u16) * (card_h + 8.0) + 4.0;
            let rect = Rect::new(x, y, card_w.max(8.0), card_h.max(8.0));
            nodes.push(Node::Surface {
                rect,
                corners: Corners::uniform(12.0),
                fill: Paint::Role(Role::SurfaceContainer),
                elevation: 1 + (placed % 3) as u8,
                outline: Some(Outline {
                    color: Paint::Role(Role::OutlineVariant),
                    width: 1.0,
                }),
            });
            nodes.push(Node::StateLayer {
                rect,
                corners: Corners::uniform(12.0),
                content: Paint::Role(Role::OnSurface),
                state: if placed % 2 == 0 {
                    StateKind::Hover
                } else {
                    StateKind::Focus
                },
            });
            nodes.push(Node::Icon {
                rect: Rect::new(x + 8.0, y + 8.0, 24.0, 24.0),
                path: "M12 2 L15 9 L22 9 L16.5 13.5 L18.5 20.5 L12 16.5 L5.5 20.5 L7.5 13.5 L2 9 \
                       L9 9 Z"
                    .to_string(),
                color: Paint::Role(Role::Primary),
            });
            nodes.push(Node::Text {
                rect: Rect::new(x + 8.0, y + card_h - 20.0, (card_w - 16.0).max(8.0), 18.0),
                text: format!("Card {placed}"),
                style: TypeStyleName::LabelMedium,
                color: Paint::Role(Role::OnSurface),
            });
            placed += 1;
        }
    }

    Scene {
        width,
        height,
        seed_argb: 0xFF67_50A4,
        variant: Variant::TonalSpot,
        is_dark: false,
        contrast_level: 0.0,
        background: Some(Paint::Role(Role::Surface)),
        nodes,
    }
}

fn material(base: Role, metallic: f32, roughness: f32) -> Material {
    Material {
        base: Paint::Role(base),
        metallic,
        roughness,
        emissive: None,
        emissive_intensity: 1.0,
        opacity: 1.0,
        unlit: false,
        double_sided: false,
        cast_shadow: true,
    }
}

fn at(translation: [f32; 3], rotation_deg: [f32; 3], scale: [f32; 3]) -> Transform {
    Transform {
        translation,
        rotation_deg,
        scale,
    }
}

fn m3_lights() -> Vec<Light> {
    vec![
        Light::Hemisphere {
            sky: Paint::Role(Role::SurfaceBright),
            ground: Paint::Role(Role::SurfaceContainerHighest),
            intensity: 0.45,
        },
        Light::Directional {
            direction: [-0.4, -1.0, -0.6],
            color: Paint::Fixed(Rgba8 {
                r: 255,
                g: 255,
                b: 255,
                a: 255,
            }),
            intensity: 2.6,
            cast_shadow: true,
        },
        Light::Point {
            position: [1.6, 1.2, 2.2],
            color: Paint::Role(Role::Tertiary),
            intensity: 6.0,
            range: 8.0,
        },
    ]
}

/// An M3 showcase: a grouped elevated card (rounded box, `extra-large`-like
/// corners) holding a sphere, a torus and a cone, standing on a tonal floor
/// behind a translucent glass panel. Every colour is an M3 role, so the scene
/// follows the seed, variant and dark mode.
#[must_use]
pub fn showcase_scene3d(width: u32, height: u32) -> Scene3d {
    let card = Node3d::Group {
        transform: at([0.0, 0.05, 0.0], [-12.0, 18.0, 0.0], [1.0; 3]),
        children: vec![
            Node3d::Mesh {
                transform: Transform::IDENTITY,
                geometry: Geometry::RoundedBox {
                    size: [2.6, 1.7, 0.16],
                    radius: 0.07,
                    segments: 4,
                },
                material: material(Role::SurfaceContainerHigh, 0.0, 0.7),
            },
            Node3d::Mesh {
                transform: at([-0.75, 0.1, 0.45], [0.0; 3], [1.0; 3]),
                geometry: Geometry::Sphere {
                    radius: 0.38,
                    width_segments: 48,
                    height_segments: 24,
                },
                material: material(Role::Primary, 0.0, 0.35),
            },
            Node3d::Mesh {
                transform: at([0.2, 0.1, 0.4], [20.0, 30.0, 0.0], [1.0; 3]),
                geometry: Geometry::Torus {
                    radius: 0.3,
                    tube: 0.1,
                    radial_segments: 24,
                    tubular_segments: 64,
                },
                material: material(Role::Secondary, 0.9, 0.25),
            },
            Node3d::Mesh {
                transform: at([0.85, 0.05, 0.4], [0.0; 3], [1.0; 3]),
                geometry: Geometry::Cylinder {
                    radius_top: 0.0,
                    radius_bottom: 0.28,
                    height: 0.7,
                    radial_segments: 48,
                    open_ended: false,
                },
                material: Material {
                    emissive: Some(Paint::Role(Role::Tertiary)),
                    emissive_intensity: 0.15,
                    ..material(Role::TertiaryContainer, 0.0, 0.5)
                },
            },
        ],
    };
    let floor = Node3d::Mesh {
        transform: at([0.0, -1.0, 0.0], [-90.0, 0.0, 0.0], [1.0; 3]),
        geometry: Geometry::Plane { size: [40.0, 40.0] },
        material: Material {
            cast_shadow: false,
            ..material(Role::SurfaceContainerLow, 0.0, 0.9)
        },
    };
    let glass = Node3d::Mesh {
        transform: at([1.3, -0.35, 1.3], [0.0, -25.0, 0.0], [1.0; 3]),
        geometry: Geometry::RoundedBox {
            size: [0.9, 1.1, 0.04],
            radius: 0.02,
            segments: 2,
        },
        material: Material {
            opacity: 0.45,
            double_sided: true,
            ..material(Role::PrimaryContainer, 0.0, 0.1)
        },
    };
    Scene3d {
        width,
        height,
        seed_argb: 0xFF67_50A4,
        variant: Variant::TonalSpot,
        is_dark: false,
        contrast_level: 0.0,
        background: Some(Paint::Role(Role::Surface)),
        samples: 4,
        camera: Camera {
            eye: [0.0, 0.6, 4.6],
            target: [0.0, -0.1, 0.0],
            up: [0.0, 1.0, 0.0],
            projection: Projection::Perspective {
                fov_y_deg: 45.0,
                near: 0.1,
                far: 50.0,
            },
        },
        lights: m3_lights(),
        shadows: ShadowSettings::default(),
        nodes: vec![floor, card, glass],
    }
}

/// A `count`-instance grid of identical spheres and rounded boxes: the
/// instancing/batching stress scene used by `benches/frame.rs`.
#[must_use]
pub fn instanced_grid_scene3d(width: u32, height: u32, count: usize) -> Scene3d {
    let side = (count as f32).sqrt().ceil().max(1.0) as usize;
    let spacing = 4.0 / side as f32;
    let mut nodes = Vec::with_capacity(count);
    for i in 0..count {
        let (col, row) = ((i % side) as f32, (i / side) as f32);
        let translation = [
            (col - (side as f32 - 1.0) * 0.5) * spacing,
            (row - (side as f32 - 1.0) * 0.5) * spacing,
            0.0,
        ];
        let (geometry, role) = if i % 2 == 0 {
            (
                Geometry::Sphere {
                    radius: spacing * 0.4,
                    width_segments: 16,
                    height_segments: 12,
                },
                Role::Primary,
            )
        } else {
            (
                Geometry::RoundedBox {
                    size: [spacing * 0.7; 3],
                    radius: spacing * 0.1,
                    segments: 2,
                },
                Role::Tertiary,
            )
        };
        nodes.push(Node3d::Mesh {
            transform: at(translation, [15.0, (i % 90) as f32, 0.0], [1.0; 3]),
            geometry,
            material: material(role, (i % 3) as f32 * 0.4, 0.4),
        });
    }
    Scene3d {
        width,
        height,
        seed_argb: 0xFF67_50A4,
        variant: Variant::TonalSpot,
        is_dark: true,
        contrast_level: 0.0,
        background: Some(Paint::Role(Role::Surface)),
        samples: 4,
        camera: Camera {
            eye: [0.0, 0.0, 6.0],
            target: [0.0; 3],
            up: [0.0, 1.0, 0.0],
            projection: Projection::Perspective {
                fov_y_deg: 45.0,
                near: 0.1,
                far: 50.0,
            },
        },
        lights: m3_lights(),
        shadows: ShadowSettings::default(),
        nodes: vec![Node3d::Group {
            transform: Transform::IDENTITY,
            children: nodes,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_scene_places_all_elements() {
        let scene = dashboard_scene(1920, 1080, 500);
        let surfaces = scene
            .nodes
            .iter()
            .filter(|n| matches!(n, Node::Surface { .. }))
            .count();
        assert_eq!(surfaces, 500);
    }

    #[test]
    fn scene3d_fixtures_prepare_and_batch() {
        let showcase = showcase_scene3d(320, 200)
            .prepare()
            .expect("valid showcase");
        assert_eq!(showcase.instances.len(), 6);
        let grid = instanced_grid_scene3d(640, 360, 400)
            .prepare()
            .expect("valid grid");
        assert_eq!(grid.instances.len(), 400);
        assert_eq!(grid.meshes.len(), 2);
        assert_eq!(grid.batches.len(), 2);
    }
}
