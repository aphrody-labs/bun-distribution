//! Safe Rust API over the Bun OS emulator host: load a C++ emulator core plugin
//! (`bun_emu_melonds`, `bun_emu_dolphin`, `bun_emu_azahar`, `bun_emu_kyty`) and drive it
//! headless, one deterministic frame at a time.
//!
//! ```no_run
//! let core = bun_emu_host::Core::open_named("melonds")?;
//! let mut emu = core.create()?;
//! emu.load_content_path("game.nds")?;
//! while emu.run_frame()? == bun_emu_host::Step::Frame && emu.frame_count() < 60 {}
//! let top = emu.frame(0).unwrap().to_rgb();
//! # Ok::<(), bun_emu_host::Error>(())
//! ```

use std::{
    ffi::{CStr, CString, c_char, c_void},
    fmt,
    path::{Path, PathBuf},
    ptr::NonNull,
    sync::Arc,
};

use bun_emu_host_sys as sys;

pub use sys::{DEFAULT_PLUGIN_DIR, plugin_file_name};

/// Button bits; 0-11 equal `bun_engine::machine::keys`.
pub mod buttons {
    use super::sys;
    pub const A: u64 = sys::BUN_EMU_BTN_A as u64;
    pub const B: u64 = sys::BUN_EMU_BTN_B as u64;
    pub const SELECT: u64 = sys::BUN_EMU_BTN_SELECT as u64;
    pub const START: u64 = sys::BUN_EMU_BTN_START as u64;
    pub const RIGHT: u64 = sys::BUN_EMU_BTN_RIGHT as u64;
    pub const LEFT: u64 = sys::BUN_EMU_BTN_LEFT as u64;
    pub const UP: u64 = sys::BUN_EMU_BTN_UP as u64;
    pub const DOWN: u64 = sys::BUN_EMU_BTN_DOWN as u64;
    pub const R: u64 = sys::BUN_EMU_BTN_R as u64;
    pub const L: u64 = sys::BUN_EMU_BTN_L as u64;
    pub const X: u64 = sys::BUN_EMU_BTN_X as u64;
    pub const Y: u64 = sys::BUN_EMU_BTN_Y as u64;
    pub const ZL: u64 = sys::BUN_EMU_BTN_ZL as u64;
    pub const ZR: u64 = sys::BUN_EMU_BTN_ZR as u64;
    pub const Z: u64 = sys::BUN_EMU_BTN_Z as u64;
    pub const HOME: u64 = sys::BUN_EMU_BTN_HOME as u64;
    pub const L3: u64 = sys::BUN_EMU_BTN_L3 as u64;
    pub const R3: u64 = sys::BUN_EMU_BTN_R3 as u64;
    pub const LID: u64 = sys::BUN_EMU_BTN_LID as u64;
    pub const DEBUG: u64 = sys::BUN_EMU_BTN_DEBUG as u64;
}

/// Analog axis indices of [`Input::analog`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Axis {
    LeftX = sys::BUN_EMU_AXIS_LX,
    LeftY = sys::BUN_EMU_AXIS_LY,
    RightX = sys::BUN_EMU_AXIS_RX,
    RightY = sys::BUN_EMU_AXIS_RY,
    LeftTrigger = sys::BUN_EMU_AXIS_LT,
    RightTrigger = sys::BUN_EMU_AXIS_RT,
}

#[derive(Debug)]
pub enum Error {
    /// The plugin library could not be loaded or lacks a symbol.
    Load(String),
    /// ABI version mismatch between plugin and bindings.
    Abi { plugin: u32, expected: u32 },
    /// A call returned a negative status; `message` is `bun_emu_last_error`.
    Status { status: i32, message: String },
    Invalid(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Load(m) => write!(f, "cannot load emulator plugin: {m}"),
            Error::Abi { plugin, expected } => write!(f, "plugin ABI {plugin}, bindings expect {expected}"),
            Error::Status { status, message } => write!(f, "{message} (status {status})"),
            Error::Invalid(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// Static description of a core plugin.
#[derive(Clone, Debug)]
pub struct CoreInfo {
    pub abi_version: u32,
    pub flags: u32,
    pub name: String,
    pub version: String,
    pub systems: Vec<String>,
    pub extensions: Vec<String>,
    pub firmware_kinds: Vec<String>,
    pub max_screens: u32,
}

impl CoreInfo {
    pub fn has(&self, cap: u32) -> bool {
        self.flags & cap != 0
    }
}

pub use sys::{
    BUN_EMU_CAP_ANALOG as CAP_ANALOG, BUN_EMU_CAP_AUDIO as CAP_AUDIO, BUN_EMU_CAP_MEMORY as CAP_MEMORY,
    BUN_EMU_CAP_NEEDS_QT_GUI as CAP_NEEDS_QT_GUI, BUN_EMU_CAP_SAVESTATE as CAP_SAVESTATE, BUN_EMU_CAP_TOUCH as CAP_TOUCH,
};

/// One loaded core plugin. Cheap to clone; instances keep the library alive.
#[derive(Clone)]
pub struct Core {
    lib: Arc<sys::BunEmuHost>,
    info: CoreInfo,
    path: PathBuf,
}

fn cstr_list(p: *const c_char) -> Vec<String> {
    cstr(p).split(',').filter(|s| !s.is_empty()).map(str::to_owned).collect()
}

fn cstr(p: *const c_char) -> String {
    if p.is_null() { String::new() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned() }
}

/// Directories searched by [`Core::open_named`]: `BUN_EMU_HOST_DIR`, the executable's
/// directory, then the checkout's `build/emu-host/bin`.
pub fn plugin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(d) = std::env::var_os("BUN_EMU_HOST_DIR") {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(d) = exe.parent()
    {
        dirs.push(d.to_path_buf());
    }
    dirs.push(PathBuf::from(DEFAULT_PLUGIN_DIR));
    dirs
}

#[cfg(windows)]
fn load_library(path: &Path) -> Result<libloading::Library> {
    use libloading::os::windows::{LOAD_WITH_ALTERED_SEARCH_PATH, Library};
    // Resolve the plugin's own dependencies (Qt6Core.dll, ...) from its directory.
    let path = std::path::absolute(path).map_err(|e| Error::Load(format!("{}: {e}", path.display())))?;
    unsafe { Library::load_with_flags(&path, LOAD_WITH_ALTERED_SEARCH_PATH) }
        .map(Into::into)
        .map_err(|e| Error::Load(format!("{}: {e}", path.display())))
}

#[cfg(not(windows))]
fn load_library(path: &Path) -> Result<libloading::Library> {
    unsafe { libloading::Library::new(path) }.map_err(|e| Error::Load(format!("{}: {e}", path.display())))
}

impl Core {
    /// Load a plugin library by path.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let library = load_library(&path)?;
        let lib = unsafe { sys::BunEmuHost::from_library(library) }
            .map_err(|e| Error::Load(format!("{}: {e}", path.display())))?;
        let raw = unsafe { lib.bun_emu_core() };
        if raw.is_null() {
            return Err(Error::Load(format!("{}: bun_emu_core returned NULL", path.display())));
        }
        let raw = unsafe { &*raw };
        let info = CoreInfo {
            abi_version: raw.abi_version,
            flags: raw.flags,
            name: cstr(raw.name),
            version: cstr(raw.version),
            systems: cstr_list(raw.systems),
            extensions: cstr_list(raw.extensions),
            firmware_kinds: cstr_list(raw.firmware_kinds),
            max_screens: raw.max_screens,
        };
        if info.abi_version != sys::BUN_EMU_ABI_VERSION {
            return Err(Error::Abi { plugin: info.abi_version, expected: sys::BUN_EMU_ABI_VERSION });
        }
        Ok(Self { lib: Arc::new(lib), info, path })
    }

    /// Load `bun_emu_<name>` from the first of [`plugin_dirs`] that has it.
    pub fn open_named(name: &str) -> Result<Self> {
        let file = plugin_file_name(name);
        let dirs = plugin_dirs();
        for dir in &dirs {
            let candidate = dir.join(&file);
            if candidate.is_file() {
                return Self::open(candidate);
            }
        }
        Err(Error::Load(format!(
            "{file} not found in {} (build it with `bun packages/bun-emu-host/scripts/build.ts {name}`)",
            dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ")
        )))
    }

    pub fn info(&self) -> &CoreInfo {
        &self.info
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn create(&self) -> Result<Emulator> {
        let raw = unsafe { self.lib.bun_emu_create() };
        let raw = NonNull::new(raw).ok_or_else(|| Error::Load(format!("{}: bun_emu_create failed", self.info.name)))?;
        Ok(Emulator { lib: self.lib.clone(), raw, log: None })
    }
}

/// Result of [`Emulator::run_frame`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Frame,
    Stopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    Bgrx8888,
    Rgbx8888,
    Rgb565,
}

/// A CPU-readable screen borrowed from the emulator until its next mutation.
#[derive(Clone, Copy, Debug)]
pub struct Frame<'a> {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub format: PixelFormat,
    pub pixels: &'a [u8],
}

impl Frame<'_> {
    /// Packed 24-bit RGB, row-major.
    pub fn to_rgb(&self) -> Vec<u8> {
        let (w, h, stride) = (self.width as usize, self.height as usize, self.stride as usize);
        let mut out = Vec::with_capacity(w * h * 3);
        for y in 0..h {
            let row = &self.pixels[y * stride..];
            for x in 0..w {
                match self.format {
                    PixelFormat::Bgrx8888 => out.extend_from_slice(&[row[x * 4 + 2], row[x * 4 + 1], row[x * 4]]),
                    PixelFormat::Rgbx8888 => out.extend_from_slice(&row[x * 4..x * 4 + 3]),
                    PixelFormat::Rgb565 => {
                        let v = u16::from_le_bytes([row[x * 2], row[x * 2 + 1]]);
                        let (r, g, b) = ((v >> 11) & 31, (v >> 5) & 63, v & 31);
                        out.extend_from_slice(&[(r * 255 / 31) as u8, (g * 255 / 63) as u8, (b * 255 / 31) as u8]);
                    }
                }
            }
        }
        out
    }
}

/// Controller state applied before the next frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    pub buttons: u64,
    /// Touch point on the touch screen (DS bottom screen, 3DS bottom screen).
    pub touch: Option<(u32, u32)>,
    /// Indexed by [`Axis`]; sticks -32768..=32767, triggers 0..=32767.
    pub analog: [i32; 6],
}

/// A serialized machine produced by [`Emulator::save_state`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SaveState(pub Vec<u8>);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

type LogFn = Box<dyn Fn(LogLevel, &str) + Send + Sync>;

/// One emulator instance. Driven from one thread at a time (it is `Send`, not `Sync`).
pub struct Emulator {
    lib: Arc<sys::BunEmuHost>,
    raw: NonNull<sys::bun_emu>,
    log: Option<Box<LogFn>>,
}

unsafe impl Send for Emulator {}

unsafe extern "C" fn log_trampoline(user: *mut c_void, level: i32, message: *const c_char, len: usize) {
    let f = unsafe { &*(user as *const LogFn) };
    let bytes = unsafe { std::slice::from_raw_parts(message as *const u8, len) };
    let level = match level as u32 {
        sys::BUN_EMU_LOG_DEBUG => LogLevel::Debug,
        sys::BUN_EMU_LOG_INFO => LogLevel::Info,
        sys::BUN_EMU_LOG_WARN => LogLevel::Warn,
        _ => LogLevel::Error,
    };
    f(level, String::from_utf8_lossy(bytes).trim_end());
}

fn c(s: &str) -> Result<CString> {
    CString::new(s).map_err(|_| Error::Invalid("string contains NUL"))
}

impl Emulator {
    fn h(&self) -> *mut sys::bun_emu {
        self.raw.as_ptr()
    }

    fn check(&self, status: i32) -> Result<i32> {
        if status < 0 {
            let message = cstr(unsafe { self.lib.bun_emu_last_error(self.h()) });
            return Err(Error::Status { status, message });
        }
        Ok(status)
    }

    /// Route core logs to `f` (called from emulator threads too).
    pub fn set_log(&mut self, f: impl Fn(LogLevel, &str) + Send + Sync + 'static) {
        let boxed: Box<LogFn> = Box::new(Box::new(f));
        let user = &*boxed as *const LogFn as *mut c_void;
        unsafe { self.lib.bun_emu_set_log(self.h(), Some(log_trampoline), user) };
        self.log = Some(boxed);
    }

    pub fn set_config(&mut self, key: &str, value: &str) -> Result<()> {
        let (k, v) = (c(key)?, c(value)?);
        self.check(unsafe { self.lib.bun_emu_set_config(self.h(), k.as_ptr(), v.as_ptr()) }).map(drop)
    }

    pub fn config(&self, key: &str) -> Option<String> {
        let k = c(key).ok()?;
        let len = unsafe { self.lib.bun_emu_get_config(self.h(), k.as_ptr(), std::ptr::null_mut(), 0) };
        if len < 0 {
            return None;
        }
        let mut buf = vec![0u8; len as usize + 1];
        unsafe { self.lib.bun_emu_get_config(self.h(), k.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) };
        buf.truncate(len as usize);
        String::from_utf8(buf).ok()
    }

    pub fn load_firmware(&mut self, kind: &str, data: &[u8]) -> Result<()> {
        let k = c(kind)?;
        self.check(unsafe { self.lib.bun_emu_load_firmware(self.h(), k.as_ptr(), data.as_ptr(), data.len()) }).map(drop)
    }

    pub fn load_content_path(&mut self, path: impl AsRef<Path>) -> Result<()> {
        let p = c(&path.as_ref().to_string_lossy())?;
        self.check(unsafe { self.lib.bun_emu_load_content_path(self.h(), p.as_ptr()) }).map(drop)
    }

    pub fn load_content(&mut self, name_hint: &str, data: &[u8]) -> Result<()> {
        let n = c(name_hint)?;
        self.check(unsafe { self.lib.bun_emu_load_content(self.h(), n.as_ptr(), data.as_ptr(), data.len()) }).map(drop)
    }

    pub fn reset(&mut self) -> Result<()> {
        self.check(unsafe { self.lib.bun_emu_reset(self.h()) }).map(drop)
    }

    pub fn run_frame(&mut self) -> Result<Step> {
        let r = self.check(unsafe { self.lib.bun_emu_run_frame(self.h()) })?;
        Ok(if r == sys::BUN_EMU_STOPPED as i32 { Step::Stopped } else { Step::Frame })
    }

    pub fn frame_count(&self) -> u64 {
        unsafe { self.lib.bun_emu_frame_count(self.h()) }
    }

    pub fn screen_count(&self) -> u32 {
        unsafe { self.lib.bun_emu_screen_count(self.h()) }
    }

    pub fn frame(&self, index: u32) -> Option<Frame<'_>> {
        let mut s = sys::bun_emu_screen::default();
        if unsafe { self.lib.bun_emu_get_screen(self.h(), index, &mut s) } != 0 || s.pixels.is_null() {
            return None;
        }
        let format = match s.format {
            sys::BUN_EMU_PIXEL_BGRX8888 => PixelFormat::Bgrx8888,
            sys::BUN_EMU_PIXEL_RGBX8888 => PixelFormat::Rgbx8888,
            sys::BUN_EMU_PIXEL_RGB565 => PixelFormat::Rgb565,
            _ => return None,
        };
        let pixels = unsafe { std::slice::from_raw_parts(s.pixels, s.stride as usize * s.height as usize) };
        Some(Frame { width: s.width, height: s.height, stride: s.stride, format, pixels })
    }

    pub fn frames(&self) -> Vec<Frame<'_>> {
        (0..self.screen_count()).filter_map(|i| self.frame(i)).collect()
    }

    pub fn audio_rate(&self) -> u32 {
        unsafe { self.lib.bun_emu_audio_rate(self.h()) }
    }

    /// Drain queued stereo frames, interleaved L,R.
    pub fn audio(&mut self) -> Vec<i16> {
        let mut out = Vec::new();
        let mut buf = vec![0i16; 8192 * 2];
        loop {
            let n = unsafe { self.lib.bun_emu_audio(self.h(), buf.as_mut_ptr(), 8192) };
            out.extend_from_slice(&buf[..n * 2]);
            if n < 8192 {
                return out;
            }
        }
    }

    pub fn set_input(&mut self, input: &Input) {
        unsafe {
            self.lib.bun_emu_set_buttons(self.h(), 0, input.buttons);
            let (x, y) = input.touch.unwrap_or((0, 0));
            self.lib.bun_emu_set_touch(self.h(), i32::from(input.touch.is_some()), x, y);
            for (axis, value) in input.analog.iter().enumerate() {
                self.lib.bun_emu_set_analog(self.h(), 0, axis as u32, *value);
            }
        }
    }

    pub fn set_buttons(&mut self, port: u32, buttons: u64) {
        unsafe { self.lib.bun_emu_set_buttons(self.h(), port, buttons) };
    }

    pub fn save_state(&mut self) -> Result<SaveState> {
        let mut data = std::ptr::null();
        let mut len = 0usize;
        self.check(unsafe { self.lib.bun_emu_save_state(self.h(), &mut data, &mut len) })?;
        Ok(SaveState(unsafe { std::slice::from_raw_parts(data, len) }.to_vec()))
    }

    pub fn load_state(&mut self, state: &SaveState) -> Result<()> {
        self.check(unsafe { self.lib.bun_emu_load_state(self.h(), state.0.as_ptr(), state.0.len()) }).map(drop)
    }

    pub fn read_memory(&mut self, address: u64, out: &mut [u8]) -> Result<()> {
        self.check(unsafe { self.lib.bun_emu_read_memory(self.h(), address, out.as_mut_ptr(), out.len()) }).map(drop)
    }

    /// Drain guest console output.
    pub fn console(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            let n = unsafe { self.lib.bun_emu_console(self.h(), buf.as_mut_ptr().cast(), buf.len()) };
            if n == 0 {
                return out;
            }
            out.extend_from_slice(&buf[..n]);
        }
    }
}

impl Drop for Emulator {
    fn drop(&mut self) {
        unsafe { self.lib.bun_emu_destroy(self.h()) };
    }
}
