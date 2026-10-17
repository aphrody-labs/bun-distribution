//! Explicit, deterministic Bevy scheduling of an actual Nintendo DS core.
//!
//! The caller constructs the core with its renderer, audio and firmware
//! backends. This library neither creates a GPU device nor reads wall time.

use aphrody_dust_core::{
    cpu::interpreter::Interpreter,
    emu::{Emu, RunOutput, input::Keys},
};
use crate::bevy::app::{App, Update};
use crate::bevy::ecs::prelude::{NonSendMut, Res, ResMut, Resource};

/// Input sampled immediately before an explicit emulator tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Resource)]
pub struct DsInput {
    pub keys: Keys,
    /// Dust's native touch coordinates, passed directly to its touchscreen.
    pub touch: Option<[u16; 2]>,
}

impl Default for DsInput {
    fn default() -> Self {
        Self { keys: Keys::empty(), touch: None }
    }
}

/// Outcomes measured from core execution, not from presentation timing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Resource)]
pub struct DsProgress {
    pub run_calls: u64,
    pub finished_frames: u64,
    pub last_output: Option<RunOutput>,
}

struct DsSession {
    emu: Emu<Interpreter>,
    previous_keys: Keys,
    previous_touch: Option<[u16; 2]>,
    touch_initialized: bool,
}

fn run_ds_tick(
    mut session: NonSendMut<DsSession>,
    input: Res<DsInput>,
    mut progress: ResMut<DsProgress>,
) {
    if progress.last_output == Some(RunOutput::Shutdown) {
        return;
    }
    let pressed = input.keys & !session.previous_keys;
    let released = session.previous_keys & !input.keys;
    if !pressed.is_empty() {
        session.emu.press_keys(pressed);
    }
    if !released.is_empty() {
        session.emu.release_keys(released);
    }
    session.previous_keys = input.keys;
    if !session.touch_initialized || session.previous_touch != input.touch {
        match input.touch {
            Some(position) => session.emu.set_touch_pos(position),
            None => session.emu.end_touch(),
        }
        session.previous_touch = input.touch;
        session.touch_initialized = true;
    }
    // Exactly one call: debugger stops and shutdown are returned to the caller
    // without retrying, spinning or attempting to catch up to wall time.
    let output = session.emu.run();
    progress.run_calls = progress.run_calls.saturating_add(1);
    if output == RunOutput::FrameFinished {
        progress.finished_frames = progress.finished_frames.saturating_add(1);
    }
    progress.last_output = Some(output);
}

/// Owns a Bevy application with one main-thread DS execution system.
pub struct DsHost {
    app: App,
}

impl DsHost {
    /// Retains the supplied core and all of its existing backends unchanged.
    pub fn new(emu: Emu<Interpreter>) -> Self {
        let previous_keys = Keys::from_bits_truncate(!emu.input.status().0);
        let mut app = App::new();
        app.insert_resource(DsInput::default())
            .insert_resource(DsProgress::default())
            .insert_non_send(DsSession {
                emu,
                previous_keys,
                previous_touch: None,
                touch_initialized: false,
            })
            .add_systems(Update, run_ds_tick);
        Self { app }
    }

    /// Samples input and updates Bevy once, advancing at most one DS frame.
    /// A debugger stop may end execution earlier; shutdown prevents later runs.
    pub fn update(&mut self, input: DsInput) -> DsProgress {
        *self.app.world_mut().resource_mut::<DsInput>() = input;
        self.app.update();
        self.progress()
    }

    pub fn progress(&self) -> DsProgress {
        *self.app.world().resource::<DsProgress>()
    }

    /// Inspect the same core used by the execution system.
    pub fn emu(&self) -> &Emu<Interpreter> {
        &self.app.world().non_send::<DsSession>().emu
    }

    /// Mutate host backends or save storage between execution ticks.
    pub fn emu_mut(&mut self) -> &mut Emu<Interpreter> {
        &mut self.app.world_mut().non_send_mut::<DsSession>().into_inner().emu
    }

    /// Returns the owned core without replacing its renderer or audio backend.
    pub fn into_emu(mut self) -> Emu<Interpreter> {
        self.app.world_mut().remove_non_send::<DsSession>().expect("DS session exists").emu
    }
}
