//! Bevy runtime of Bun Engine: one `App`, one window (`bevy_winit`), one input layer
//! (`bevy_input`, gamepads through `bevy_gilrs`), audio (`bevy_audio`), UI, assets and the render
//! schedules on the shared wgpu 30 device. Machines are plugins over the [`Machine`] trait; the
//! stream client and Steam are plugins too. See `crates/bun-engine-core/BEVY.md`.
//!
//! [`Machine`]: crate::machine::Machine

#[cfg(feature = "audio")]
pub mod audio;
#[cfg(feature = "render")]
pub mod fsr1;
pub mod input;
pub mod machine;
pub mod run;
#[cfg(all(feature = "render", feature = "steam"))]
pub mod steam;

use std::time::Duration;

use crate::bevy::{
    MinimalPlugins,
    app::{App, AppExit, Plugin, PluginGroup, PreUpdate, ScheduleRunnerPlugin, Update},
    ecs::prelude::*,
};

pub use input::{EngineInput, ExternalPads, KeyMap};
pub use machine::*;

/// Ordering of the engine's systems inside the Bevy schedules.
#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EngineSystems {
    /// `PreUpdate`: keyboard, gamepads and external pads folded into [`EngineInput`].
    Input,
    /// `FixedUpdate` (windowed) or `Update` (headless): `Machine::run_frame`.
    Machine,
    /// `PostUpdate`: machine screens uploaded to their `Image`.
    Present,
}

/// How the app is driven; inserted by [`BunEnginePlugin`].
#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineMode {
    /// A window; machines advance at their refresh rate in `FixedUpdate`.
    Windowed,
    /// No window, no GPU; machines advance one frame per `Update`, as fast as possible.
    Headless,
}

/// Failure reported by a plugin (machine factory, stream setup, decoder). The CLI returns it as
/// the process error once the app exits.
#[derive(Resource, Default, Clone, Debug)]
pub struct EngineExit {
    pub failure: Option<String>,
}

impl EngineExit {
    pub fn fail(&mut self, why: impl Into<String>) {
        self.failure.get_or_insert_with(|| why.into());
    }
}

/// The engine runtime. Add it first, then machine or stream plugins.
pub struct BunEnginePlugin {
    pub title: String,
    /// Initial logical window size; `None` lets machine plugins pick twice their screen size.
    pub size: Option<(u32, u32)>,
    pub headless: bool,
    /// Add Bevy's `DefaultPlugins` (windowed) or `MinimalPlugins` (headless). Set `false` when
    /// the host app already added them (the console shell).
    pub default_plugins: bool,
    /// Escape exits the app.
    pub escape_exits: bool,
    /// Low-latency presentation: no pipelined rendering, reactive updates (stream client).
    pub low_latency: bool,
    #[cfg(feature = "render")]
    pub present_mode: crate::bevy::window::PresentMode,
    #[cfg(feature = "render")]
    pub frame_latency: Option<u32>,
    /// wgpu backends; `None` keeps Bevy's choice (`WGPU_BACKEND` or the platform default).
    /// Windows hosts default to DX12, the backend of the stream client's NV12 sharing.
    #[cfg(feature = "render")]
    pub backends: Option<wgpu::Backends>,
    /// Spawn the engine's 2D camera ([`EngineCamera`]).
    pub camera: bool,
}

impl BunEnginePlugin {
    pub fn windowed(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            size: None,
            headless: false,
            default_plugins: true,
            escape_exits: true,
            low_latency: false,
            #[cfg(feature = "render")]
            present_mode: crate::bevy::window::PresentMode::AutoVsync,
            #[cfg(feature = "render")]
            frame_latency: Some(2),
            #[cfg(feature = "render")]
            backends: cfg!(windows).then_some(wgpu::Backends::DX12),
            camera: true,
        }
    }

    pub fn headless() -> Self {
        Self {
            headless: true,
            escape_exits: false,
            camera: false,
            ..Self::windowed("Bun Engine")
        }
    }
}

/// Whether the host chose the window size; otherwise the first machine sizes it (2x its screen).
#[derive(Resource, Clone, Copy, Debug)]
pub struct EngineWindowSize {
    pub explicit: bool,
}

/// Marker of the camera spawned by [`BunEnginePlugin`].
#[derive(Component, Clone, Copy, Debug, Default)]
pub struct EngineCamera;

impl Plugin for BunEnginePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<EngineInput>()
            .init_resource::<KeyMap>()
            .init_resource::<ExternalPads>()
            .init_resource::<EngineExit>()
            .insert_resource(if self.headless {
                EngineMode::Headless
            } else {
                EngineMode::Windowed
            })
            .configure_sets(PreUpdate, EngineSystems::Input)
            .add_systems(PreUpdate, input::gather.in_set(EngineSystems::Input));
        if self.headless {
            if self.default_plugins {
                app.add_plugins(MinimalPlugins.set(ScheduleRunnerPlugin::run_loop(Duration::ZERO)));
            }
            app.add_plugins(machine::MachineRuntimePlugin);
            return;
        }
        #[cfg(feature = "render")]
        self.build_windowed(app);
        #[cfg(not(feature = "render"))]
        panic!("BunEnginePlugin::windowed needs the `render` feature");
    }
}

#[cfg(feature = "render")]
impl BunEnginePlugin {
    fn build_windowed(&self, app: &mut App) {
        use crate::bevy::{
            DefaultPlugins,
            image::ImagePlugin,
            window::{Window, WindowPlugin, WindowResolution},
        };
        if self.default_plugins {
            let (w, h) = self.size.unwrap_or((1024, 768));
            let window = Window {
                title: self.title.clone(),
                resolution: WindowResolution::new(w, h),
                present_mode: self.present_mode,
                desired_maximum_frame_latency: self.frame_latency.and_then(std::num::NonZero::new),
                // Browser: draw into `<canvas id="bun-engine">` sized by its parent.
                #[cfg(target_arch = "wasm32")]
                canvas: Some("#bun-engine".into()),
                #[cfg(target_arch = "wasm32")]
                fit_canvas_to_parent: true,
                ..Default::default()
            };
            let mut settings = crate::bevy::render::settings::WgpuSettings::default();
            if let Some(backends) = self.backends
                && std::env::var_os("WGPU_BACKEND").is_none()
            {
                settings.backends = Some(backends);
            }
            let plugins = DefaultPlugins
                .set(WindowPlugin {
                    primary_window: Some(window),
                    ..Default::default()
                })
                .set(ImagePlugin::default_nearest())
                .set(crate::bevy::render::RenderPlugin {
                    render_creation: crate::bevy::render::settings::RenderCreation::Automatic(
                        Box::new(settings),
                    ),
                    ..Default::default()
                });
            #[cfg(not(target_arch = "wasm32"))]
            let plugins = if self.low_latency {
                plugins
                    .disable::<crate::bevy::render::pipelined_rendering::PipelinedRenderingPlugin>()
            } else {
                plugins
            };
            app.add_plugins(plugins);
        }
        if self.low_latency {
            use crate::bevy::winit::{UpdateMode, WinitSettings};
            // Redraw when a producer wakes the loop (decoded frame) or input arrives.
            let reactive = UpdateMode::reactive(Duration::from_millis(250));
            app.insert_resource(WinitSettings {
                focused_mode: reactive,
                unfocused_mode: reactive,
            });
        }
        if self.camera {
            app.insert_resource(crate::bevy::camera::ClearColor(
                crate::bevy::color::Color::BLACK,
            ))
            .add_systems(crate::bevy::app::Startup, spawn_camera);
        }
        app.insert_resource(EngineWindowSize {
            explicit: self.size.is_some(),
        });
        if self.escape_exits {
            app.add_systems(Update, exit_on_escape);
        }
        app.add_plugins((fsr1::Fsr1Plugin, machine::MachineRuntimePlugin));
    }
}

#[cfg(feature = "render")]
fn spawn_camera(mut commands: Commands) {
    use crate::bevy::{camera::Camera2d, render::view::Msaa};
    commands.spawn((Camera2d, Msaa::Off, EngineCamera));
}

#[cfg(feature = "render")]
fn exit_on_escape(
    keys: Option<Res<crate::bevy::input::ButtonInput<crate::bevy::input::keyboard::KeyCode>>>,
    mut exit: MessageWriter<AppExit>,
) {
    if keys.is_some_and(|k| k.just_pressed(crate::bevy::input::keyboard::KeyCode::Escape)) {
        exit.write(AppExit::Success);
    }
}

/// Write an [`AppExit`] carrying `why` into [`EngineExit`].
pub fn fail(world: &mut World, why: impl Into<String>) {
    let why = why.into();
    world.get_resource_or_init::<EngineExit>().fail(why);
    world.write_message(AppExit::error());
}
