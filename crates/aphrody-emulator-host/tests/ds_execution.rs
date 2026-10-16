#[path = "support/rom.rs"]
mod rom;

use aphrody_dust_core::{
    Model, SaveContents, audio,
    cpu::interpreter::Interpreter,
    ds_slot,
    emu::{self, RunOutput, input::Keys},
    flash::Flash,
    gpu::{
        Scanline,
        engine_3d::{Polygon, RendererTx, RenderingState, ScreenVertex, SoftRendererRx},
    },
    rtc,
    spi::firmware,
    utils::mem_prelude::*,
};
use aphrody_dust_soft_3d::{Renderer, RenderingData};
use aphrody_emulator_host::{DsHost, DsInput};
use std::{cell::RefCell, rc::Rc};

struct Soft3d {
    data: Box<RenderingData>,
    renderer: Renderer,
    output: Box<[Scanline<u32>; 192]>,
}
struct Tx(Rc<RefCell<Soft3d>>);
struct Rx {
    shared: Rc<RefCell<Soft3d>>,
    line: usize,
    output: Scanline<u32>,
}
impl RendererTx for Tx {
    fn set_capture_enabled(&mut self, _: bool) {}
    fn swap_buffers(
        &mut self,
        vertices: &[ScreenVertex],
        polygons: &[Polygon],
        state: &RenderingState,
    ) {
        self.0.borrow_mut().data.prepare(vertices, polygons, state);
    }
    fn repeat_last_frame(&mut self, state: &RenderingState) {
        self.0.borrow_mut().data.repeat_last_frame(state);
    }
    fn start_rendering(
        &mut self,
        texture: &Bytes<0x80000>,
        palette: &Bytes<0x18000>,
        state: &RenderingState,
    ) {
        let mut shared = self.0.borrow_mut();
        let Soft3d { data, renderer, output } = &mut *shared;
        data.copy_vram(texture, palette, state);
        renderer.start_frame(data);
        renderer.render_line(0, data);
        for y in 0..192_u8 {
            if y < 191 {
                renderer.render_line(y + 1, data);
            }
            renderer.postprocess_line(y, &mut output[y as usize], data);
        }
    }
    fn skip_rendering(&mut self) {}
}
impl SoftRendererRx for Rx {
    fn start_frame(&mut self) {
        self.line = 0;
    }
    fn read_scanline(&mut self) -> &Scanline<u32> {
        self.output.0.copy_from_slice(&self.shared.borrow().output[self.line].0);
        self.line += 1;
        &self.output
    }
    fn skip_scanline(&mut self) {
        self.line += 1;
    }
}
fn host() -> DsHost {
    host_with_rom(rom::counter_rom())
}

fn host_with_rom(bytes: Vec<u8>) -> DsHost {
    // These POD buffers contain only integer/SIMD fields; zero is valid, as in
    // the retained renderer's own initialization. Allocate directly on the heap.
    let shared = Rc::new(RefCell::new(Soft3d {
        data: unsafe { Box::new_zeroed().assume_init() },
        renderer: Renderer::new(),
        output: unsafe { Box::new_zeroed().assume_init() },
    }));
    let rx = Rx { shared: shared.clone(), line: 0, output: Scanline([0; 256]) };
    let mut contents = BoxedByteSlice::new_zeroed(bytes.len());
    contents.copy_from_slice(&bytes);
    let builder = emu::Builder::new(
        Flash::new(
            SaveContents::Existing(firmware::default(Model::Ds)),
            firmware::id_for_model(Model::Ds),
        )
        .unwrap(),
        Some(Box::new(contents)),
        ds_slot::spi::Empty::new().into(),
        Box::new(audio::DummyBackend),
        None,
        Box::new(rtc::DummyBackend),
        Box::new(aphrody_dust_soft_2d::sync::Renderer::new(Box::new(rx))),
        Box::new(Tx(shared)),
        None,
    );
    DsHost::new(builder.build(Interpreter).unwrap_or_else(|_| panic!("legal test ROM must boot")))
}

#[test]
fn guest_mmio_backdrops_are_rendered_on_the_selected_screens() {
    let mut host = host_with_rom(rom::backdrop_rom());
    for _ in 0..3 {
        assert_eq!(host.update(DsInput::default()).last_output, Some(RunOutput::FrameFinished));
    }
    let framebuffer = host.emu().gpu.renderer_2d().framebuffer();
    // Retained 2D reference expands RGB5 to RGB6 by shifting, not replicating.
    // Hence RGB5 maximum 31 is RGB6 62, mapped to RGBA8 251 by the UI/GPU.
    assert_eq!(framebuffer[0][96 * 256 + 128] & 0x3_ffff, 62);
    assert_eq!(framebuffer[1][96 * 256 + 128] & 0x3_ffff, 62 << 12);
}

#[test]
fn real_cpus_advance_for_exactly_one_frame_per_bevy_update() {
    let mut first = host();
    let mut second = host();
    let mut previous_counts = [0; 2];
    for frame in 1..=3 {
        let input = DsInput { keys: if frame == 2 { Keys::A } else { Keys::empty() }, touch: None };
        let a = first.update(input);
        let b = second.update(input);
        assert_eq!(a, b);
        assert_eq!(a.run_calls, frame);
        assert_eq!(a.finished_frames, frame);
        assert_eq!(a.last_output, Some(RunOutput::FrameFinished));
        let r9 = first.emu().arm9.regs().gprs;
        let r7 = first.emu().arm7.regs().gprs;
        assert!(r9[0] > previous_counts[0] && r7[0] > previous_counts[1]);
        previous_counts = [r9[0], r7[0]];
        assert!(r9[0] > 0 && r7[0] > 0, "both ARM interpreters execute the fixture");
        assert_eq!(r9, second.emu().arm9.regs().gprs);
        assert_eq!(r7, second.emu().arm7.regs().gprs);
        assert_eq!(first.emu().input.status().0 & 1, if frame == 2 { 0 } else { 1 });
        println!("frame {frame}: ARM9 ADD executions={}, ARM7 ADD executions={}", r9[0], r7[0]);
    }
}

#[test]
fn shutdown_is_terminal_without_running_more_cpu_instructions() {
    let mut host = host();
    host.update(DsInput::default());
    host.emu_mut().request_shutdown();
    let ended = host.update(DsInput::default());
    assert_eq!(ended.last_output, Some(RunOutput::Shutdown));
    let registers = host.emu().arm9.regs().gprs;
    let arm7_registers = host.emu().arm7.regs().gprs;
    assert_eq!(host.update(DsInput { keys: Keys::A, touch: None }), ended);
    assert_eq!(host.emu().arm9.regs().gprs, registers);
    assert_eq!(host.emu().arm7.regs().gprs, arm7_registers);
}
