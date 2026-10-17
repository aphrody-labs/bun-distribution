//! C++ emulator cores (melonDS, Dolphin, Azahar, Kyty) hosted by `packages/bun-emu-host` and
//! loaded at run time through `bun-emu-host`: `bun-engine run melonds|dolphin|azahar|kyty <file>`.
//!
//! `BUN_EMU_CONFIG="key=value;key=value"` sets core configuration before the content boots.

use bun_emu_host::{Core, Emulator, Step as HostStep};

use super::{Input, Machine, Screen, Step};

pub struct CppHost {
    name: &'static str,
    emu: Emulator,
    stopped: Option<String>,
}

/// Plugin names accepted by [`CppHost::open`].
pub const CORES: [&str; 4] = ["melonds", "dolphin", "azahar", "kyty"];

impl CppHost {
    /// Load the `core` plugin, apply `BUN_EMU_CONFIG`, optional firmware (`kind=path` or a path
    /// for the core's first firmware kind) and boot `content`.
    ///
    /// # Errors
    /// Returns the plugin, firmware or content error.
    pub fn open(core: &str, content: &std::path::Path, firmware: Option<&std::path::Path>) -> Result<Self, String> {
        let name = CORES.into_iter().find(|c| *c == core).ok_or_else(|| format!("unknown C++ core `{core}`"))?;
        let plugin = Core::open_named(name).map_err(|e| e.to_string())?;
        let mut emu = plugin.create().map_err(|e| e.to_string())?;
        if std::env::var_os("BUN_EMU_VERBOSE").is_some() {
            emu.set_log(|level, msg| eprintln!("[{level:?}] {msg}"));
        }
        if let Ok(config) = std::env::var("BUN_EMU_CONFIG") {
            for pair in config.split(';').filter(|p| !p.is_empty()) {
                let (k, v) = pair.split_once('=').unwrap_or((pair, "1"));
                emu.set_config(k.trim(), v.trim()).map_err(|e| e.to_string())?;
            }
        }
        if let Some(fw) = firmware {
            let spec = fw.to_string_lossy();
            let (kind, path) = match spec.split_once('=') {
                Some((kind, path)) if plugin.info().firmware_kinds.iter().any(|k| k == kind) => (kind.to_owned(), path.to_owned()),
                _ => (
                    plugin.info().firmware_kinds.first().cloned().ok_or("this core takes no firmware")?,
                    spec.into_owned(),
                ),
            };
            let data = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
            emu.load_firmware(&kind, &data).map_err(|e| e.to_string())?;
        }
        emu.load_content_path(content).map_err(|e| e.to_string())?;
        Ok(Self { name, emu, stopped: None })
    }

    pub fn emulator(&mut self) -> &mut Emulator {
        &mut self.emu
    }
}

impl Machine for CppHost {
    fn name(&self) -> &'static str {
        self.name
    }

    fn run_frame(&mut self) -> Step {
        if self.stopped.is_some() {
            return Step::Shutdown;
        }
        match self.emu.run_frame() {
            Ok(HostStep::Frame) => Step::Frame,
            Ok(HostStep::Stopped) => {
                self.stopped = Some("guest stopped".into());
                Step::Shutdown
            }
            Err(e) => {
                self.stopped = Some(e.to_string());
                Step::Shutdown
            }
        }
    }

    fn screens(&self) -> Vec<Screen> {
        self.emu
            .frames()
            .into_iter()
            .map(|f| Screen { width: f.width as usize, height: f.height as usize, rgb: f.to_rgb() })
            .collect()
    }

    fn set_input(&mut self, input: Input) {
        self.emu.set_input(&bun_emu_host::Input {
            buttons: u64::from(input.keys),
            touch: input.touch.map(|(x, y)| (u32::from(x), u32::from(y))),
            analog: [0; 6],
        });
    }

    fn diagnostic(&self) -> Option<String> {
        self.stopped.clone()
    }

    fn console(&mut self) -> Vec<u8> {
        self.emu.console()
    }
}
