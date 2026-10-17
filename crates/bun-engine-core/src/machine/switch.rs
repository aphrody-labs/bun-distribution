//! Nintendo Switch on Ruzu (`crates/ruzu-*`, the Rust port of yuzu/Eden) with the rdynarmic JIT.
//!
//! The guest runs on Ruzu's own CPU and GPU threads. The renderer is Ruzu's null renderer with
//! a CPU readback: every composition reads the presented framebuffer from device memory
//! (block-linear) and publishes it as the machine's screen. CPU-drawn surfaces (libnx
//! framebuffers, consoles, software UIs) are shown; GPU-rendered scenes need a real renderer.
//! Homebrew (NRO/NSO) boots without keys or firmware.

use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use ruzu_common::settings_enums::RendererBackend;
use ruzu_core::core::{System, SystemRef, SystemResultStatus};
use ruzu_core::memory::memory::Memory;
use video_core::renderer_null::renderer_null::{CapturedFrame, RendererNull};

use super::{Input, Machine, Screen, Step, keys};

/// Longest wall-clock wait for the guest's next presentation.
const FRAME_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Shared {
    frames: u64,
    latest: Option<CapturedFrame>,
    exited: bool,
}

type Signal = Arc<(Mutex<Shared>, Condvar)>;

pub struct Switch {
    // Boxed so the `SystemRef`s handed to Ruzu's threads stay valid. Never dropped: Ruzu's CPU,
    // GPU and timer threads do not join on teardown (ruzu-cmd exits the process instead).
    system: std::mem::ManuallyDrop<Box<System>>,
    signal: Signal,
    seen: u64,
    screen: Option<Screen>,
    stopped: Option<String>,
}

impl Switch {
    /// Loads an NRO, NSO or any format Ruzu's loader accepts and starts the guest.
    pub fn from_path(path: &str) -> Result<Self, String> {
        console::install();
        ruzu_common::settings::values_mut().renderer_backend.set_value(RendererBackend::Null);

        let mut system = Box::new(System::new());
        system.initialize();
        system.set_content_provider(Arc::new(Mutex::new(
            ruzu_core::file_sys::registered_cache::ContentProviderUnion::new(),
        )));
        if system.get_filesystem().is_none() {
            system.set_filesystem(ruzu_core::file_sys::vfs::vfs_real::RealVfsFilesystem::new());
        }
        let filesystem = system.get_filesystem().unwrap().clone();
        system.get_filesystem_controller().lock().unwrap().create_factories(filesystem, false);
        system.clear_user_channel();

        let signal: Signal = Arc::default();
        let sink = signal.clone();
        system.set_subsystem_factory(Box::new(move |system| {
            let host1x = video_core::host1x::host1x::Host1x::new_with_system(SystemRef::from_ref(system));
            let syncpoints = host1x.syncpoint_manager().clone();
            let device_memory = host1x.memory_manager().clone();
            system.set_host1x_core(Box::new(host1x));

            let gpu = video_core::video_core::create_gpu(SystemRef::from_ref(system), |_, gpu| {
                let gpu_ptr = gpu as *const video_core::gpu::Gpu as usize;
                let layout = Arc::new(std::sync::RwLock::new(
                    ruzu_core::frontend::framebuffer_layout::default_frame_layout(1280, 720),
                ));
                let mut renderer = RendererNull::new(
                    syncpoints,
                    layout,
                    Arc::new(|| {}),
                    Arc::new(move || {
                        // SAFETY: the GPU owns this renderer and outlives it.
                        unsafe { (*(gpu_ptr as *const video_core::gpu::Gpu)).renderer_frame_end_notify() }
                    }),
                );
                renderer.set_frame_capture(
                    device_memory,
                    Arc::new(move |frame| {
                        let (lock, cvar) = &*sink;
                        let mut shared = lock.lock().unwrap();
                        shared.frames += 1;
                        shared.latest = Some(frame);
                        cvar.notify_all();
                    }),
                );
                Ok::<_, String>(Box::new(renderer) as Box<dyn video_core::renderer_base::RendererBase>)
            })?;

            // GPU engines reach guest memory through device addresses: SMMU first, then the
            // process page table, then DRAM directly (the order ruzu-cmd uses).
            let memory_raw: Arc<OnceLock<usize>> = Arc::default();
            let system_ref = SystemRef::from_ref(system);
            let raw = memory_raw.clone();
            gpu.set_guest_memory_reader(Arc::new(move |addr, out: &mut [u8]| {
                let sys = system_ref.get();
                if let Some(ptr) = sys.host1x_core().map(|h| h.smmu_lookup(addr)).filter(|&p| p != 0) {
                    // SAFETY: SMMU-mapped host backing covers the requested span.
                    unsafe { std::ptr::copy_nonoverlapping(ptr as *const u8, out.as_mut_ptr(), out.len()) };
                    return true;
                }
                if let Some(memory) = sys.memory_shared() {
                    if memory_of(&raw, &memory).read_block(addr, out) {
                        return true;
                    }
                }
                dram(sys, addr, out.len()).is_some_and(|ptr| {
                    // SAFETY: inside the emulated DRAM backing.
                    unsafe { std::ptr::copy_nonoverlapping(ptr, out.as_mut_ptr(), out.len()) };
                    true
                })
            }));
            let system_ref = SystemRef::from_ref(system);
            gpu.set_guest_memory_writer(Arc::new(move |addr, data: &[u8]| {
                let sys = system_ref.get();
                if let Some(ptr) = sys.host1x_core().map(|h| h.smmu_lookup(addr)).filter(|&p| p != 0) {
                    // SAFETY: SMMU-mapped host backing covers the span.
                    unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, data.len()) };
                    return;
                }
                if let Some(memory) = sys.memory_shared() {
                    if memory_of(&memory_raw, &memory).write_block(addr, data) {
                        return;
                    }
                }
                if let Some(ptr) = dram(sys, addr, data.len()) {
                    // SAFETY: inside the emulated DRAM backing.
                    unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, data.len()) };
                }
            }));
            system.set_gpu_core(gpu);
            Ok(())
        }));

        let status = system.load(path);
        if status != SystemResultStatus::Success {
            return Err(format!("Switch: cannot load {path}: {status:?}"));
        }
        system.apply_settings();
        if let Some(gpu) = system.gpu_core().and_then(|g| g.as_any().downcast_ref::<video_core::gpu::Gpu>()) {
            gpu.start();
        }
        system.get_cpu_manager().on_gpu_ready();
        let exit = signal.clone();
        system.register_exit_callback(Box::new(move || {
            let (lock, cvar) = &*exit;
            lock.lock().unwrap().exited = true;
            cvar.notify_all();
        }));
        system.run();
        Ok(Self { system: std::mem::ManuallyDrop::new(system), signal, seen: 0, screen: None, stopped: None })
    }
}

/// The process `Memory` without its mutex, as ruzu-cmd reads it from the GPU thread.
fn memory_of<'a>(cell: &OnceLock<usize>, memory: &'a Arc<Mutex<Memory>>) -> &'a Memory {
    let ptr = *cell.get_or_init(|| &*memory.lock().unwrap() as *const Memory as usize);
    // SAFETY: the pointee lives inside the `Arc` allocation the system keeps for the session;
    // the `Memory` methods used take `&self`.
    unsafe { &*(ptr as *const Memory) }
}

fn dram(system: &System, addr: u64, len: usize) -> Option<*const u8> {
    let base = ruzu_core::device_memory::dram_memory_map::BASE;
    let offset = addr.checked_sub(base)? as usize;
    // The retail 4 GiB DRAM; larger memory layouts keep the SMMU/page-table paths only.
    if offset.checked_add(len)? > 4 << 30 {
        return None;
    }
    // SAFETY: offsets past BASE inside the DRAM size index the emulated DRAM backing.
    Some(unsafe { system.device_memory().buffer.backing_base_pointer().add(offset) as *const u8 })
}

impl Machine for Switch {
    fn name(&self) -> &'static str {
        "nintendo-switch"
    }

    fn run_frame(&mut self) -> Step {
        if self.stopped.is_some() {
            return Step::Shutdown;
        }
        let deadline = Instant::now() + FRAME_TIMEOUT;
        let (lock, cvar) = &*self.signal;
        let mut shared = lock.lock().unwrap();
        loop {
            if shared.frames > self.seen {
                self.seen = shared.frames;
                if let Some(frame) = shared.latest.take() {
                    let rgb = frame.rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
                    self.screen = Some(Screen { width: frame.width as usize, height: frame.height as usize, rgb });
                }
                return Step::Frame;
            }
            if shared.exited {
                drop(shared);
                self.stopped = Some("the guest exited".into());
                return Step::Shutdown;
            }
            let now = Instant::now();
            if now >= deadline {
                drop(shared);
                self.stopped = Some(format!("no frame presented within {}s", FRAME_TIMEOUT.as_secs()));
                return Step::Shutdown;
            }
            shared = cvar.wait_timeout(shared, deadline - now).unwrap().0;
        }
    }

    fn screens(&self) -> Vec<Screen> {
        let screen = self.screen.as_ref().map_or_else(
            || Screen { width: 1280, height: 720, rgb: vec![0; 1280 * 720 * 3] },
            |s| Screen { width: s.width, height: s.height, rgb: s.rgb.clone() },
        );
        vec![screen]
    }

    fn set_input(&mut self, input: Input) {
        use hid_core::frontend::emulated_controller::set_simple_npad_button;
        use hid_core::hid_types::NpadButton;
        const MAP: [(u32, NpadButton); 12] = [
            (keys::A, NpadButton::A),
            (keys::B, NpadButton::B),
            (keys::X, NpadButton::X),
            (keys::Y, NpadButton::Y),
            (keys::L, NpadButton::L),
            (keys::R, NpadButton::R),
            (keys::START, NpadButton::PLUS),
            (keys::SELECT, NpadButton::MINUS),
            (keys::UP, NpadButton::UP),
            (keys::DOWN, NpadButton::DOWN),
            (keys::LEFT, NpadButton::LEFT),
            (keys::RIGHT, NpadButton::RIGHT),
        ];
        for (bit, button) in MAP {
            set_simple_npad_button(button, input.keys & bit != 0);
        }
    }

    fn diagnostic(&self) -> Option<String> {
        self.stopped.clone()
    }

    fn console(&mut self) -> Vec<u8> {
        console::take()
    }
}

/// Collects `svcOutputDebugString` text from Ruzu's log; `BUN_ENGINE_LOG=1` echoes warnings.
mod console {
    use std::sync::Mutex;

    static OUTPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
    const PREFIX: &str = "OutputDebugString(";

    struct Sink {
        echo: bool,
    }

    impl log::Log for Sink {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.target().ends_with("svc_debug_string") || (self.echo && metadata.level() <= log::Level::Warn)
        }

        fn log(&self, record: &log::Record) {
            if !self.enabled(record.metadata()) {
                return;
            }
            let text = record.args().to_string();
            if let Some(rest) = text.strip_prefix(PREFIX) {
                let message = rest.split_once("): ").map_or(rest, |(_, m)| m);
                let mut out = OUTPUT.lock().unwrap();
                out.extend_from_slice(message.as_bytes());
                if !message.ends_with('\n') {
                    out.push(b'\n');
                }
            } else if self.echo && record.level() <= log::Level::Warn {
                eprintln!("[{} {}] {text}", record.level(), record.target());
            }
        }

        fn flush(&self) {}
    }

    pub fn install() {
        let echo = std::env::var_os("BUN_ENGINE_LOG").is_some_and(|v| v != "0");
        if log::set_boxed_logger(Box::new(Sink { echo })).is_ok() {
            log::set_max_level(log::LevelFilter::Info);
        }
    }

    pub fn take() -> Vec<u8> {
        std::mem::take(&mut OUTPUT.lock().unwrap())
    }
}
