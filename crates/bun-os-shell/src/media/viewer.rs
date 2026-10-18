//! glTF viewer: Bevy's glTF loader and PBR renderer draw the model into an image target that the
//! M3 panel shows (`ImageNode`), with an orbit camera driven by the right stick (IJKL on the
//! keyboard) and LB/RB zoom. Models come from the media library through the `bun-os-usr` asset
//! source (RE game exports `#EMD`/G4MD -> GLB, NIE model exports). Like ArtCraft's viewer
//! (`@storyteller/ui-viewer-3d`), the camera frames the model's bounds once it is spawned.

use bevy::camera::RenderTarget;
use bevy::camera::primitives::Aabb;
use bevy::prelude::*;
use bevy::render::render_resource::TextureFormat;
use bevy::render::view::Tonemapping;

/// Everything the viewer spawned (despawned when the view closes).
#[derive(Component)]
pub struct ViewerEntity;

#[derive(Component)]
pub struct ViewerCamera;

#[derive(Resource, Clone, Debug)]
pub struct Orbit {
    pub image: Handle<Image>,
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub target: Vec3,
    pub framed: bool,
}

/// Spawn camera, light and model; returns the render target shown by the panel.
pub fn spawn(
    commands: &mut Commands,
    images: &mut Assets<Image>,
    assets: &AssetServer,
    asset_path: String,
    size: UVec2,
    clear: Color,
) -> Orbit {
    let image = Image::new_target_texture(size.x, size.y, TextureFormat::Rgba8Unorm, Some(TextureFormat::Rgba8UnormSrgb));
    let handle = images.add(image);
    commands.spawn((
        Camera3d::default(),
        Camera {
            order: -1,
            clear_color: ClearColorConfig::Custom(clear),
            ..default()
        },
        RenderTarget::Image(handle.clone().into()),
        Tonemapping::None,
        Transform::from_xyz(0.0, 1.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
        ViewerCamera,
        ViewerEntity,
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: light_consts::lux::OVERCAST_DAY,
            ..default()
        },
        Transform::from_xyz(3.0, 6.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
        ViewerEntity,
    ));
    commands.spawn((
        WorldAssetRoot(assets.load(GltfAssetLabel::Scene(0).from_asset(asset_path))),
        ViewerEntity,
    ));
    Orbit {
        image: handle,
        yaw: 0.6,
        pitch: 0.3,
        distance: 4.0,
        target: Vec3::ZERO,
        framed: false,
    }
}

/// Frame the loaded meshes once (bounds of every `Aabb`; the shell draws no other 3D).
pub fn frame(mut orbit: ResMut<Orbit>, meshes: Query<(&Aabb, &GlobalTransform), With<Mesh3d>>) {
    if orbit.framed {
        return;
    }
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);
    let mut any = false;
    for (aabb, transform) in &meshes {
        let center = transform.transform_point(Vec3::from(aabb.center));
        let reach = Vec3::from(aabb.half_extents) * transform.compute_transform().scale.abs();
        min = min.min(center - reach);
        max = max.max(center + reach);
        any = true;
    }
    if !any {
        return;
    }
    let radius = ((max - min).length() * 0.5).max(1e-3);
    orbit.target = (min + max) * 0.5;
    orbit.distance = radius * 2.6;
    orbit.framed = true;
}

/// Orbit input: right stick or IJKL, zoom with LB/RB (wired by the plugin) or U/O.
pub fn orbit_input(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    pads: Query<&Gamepad>,
    mut orbit: ResMut<Orbit>,
    mut cameras: Query<&mut Transform, With<ViewerCamera>>,
) {
    let dt = time.delta_secs();
    let mut turn = Vec2::ZERO;
    let mut zoom = 0.0;
    for pad in &pads {
        let stick = pad.right_stick();
        if stick.length() > 0.2 {
            turn += stick;
        }
        zoom += pad.get(GamepadButton::RightTrigger2).unwrap_or(0.0)
            - pad.get(GamepadButton::LeftTrigger2).unwrap_or(0.0);
    }
    let key = |k: KeyCode| f32::from(u8::from(keys.pressed(k)));
    turn.x += key(KeyCode::KeyL) - key(KeyCode::KeyJ);
    turn.y += key(KeyCode::KeyI) - key(KeyCode::KeyK);
    zoom += key(KeyCode::KeyU) - key(KeyCode::KeyO);
    if turn != Vec2::ZERO || zoom != 0.0 {
        orbit.yaw -= turn.x * 2.2 * dt;
        orbit.pitch = (orbit.pitch + turn.y * 1.6 * dt).clamp(-1.4, 1.4);
        orbit.distance = (orbit.distance * (1.0 - zoom * 1.5 * dt)).max(0.05);
    }
    let Ok(mut transform) = cameras.single_mut() else { return };
    let offset = Vec3::new(
        orbit.yaw.sin() * orbit.pitch.cos(),
        orbit.pitch.sin(),
        orbit.yaw.cos() * orbit.pitch.cos(),
    ) * orbit.distance;
    let next = Transform::from_translation(orbit.target + offset).looking_at(orbit.target, Vec3::Y);
    if *transform != next {
        *transform = next;
    }
}

/// Step zoom from LB/RB intents.
pub fn zoom_step(orbit: &mut Orbit, inward: bool) {
    orbit.distance = (orbit.distance * if inward { 0.85 } else { 1.0 / 0.85 }).max(0.05);
}
