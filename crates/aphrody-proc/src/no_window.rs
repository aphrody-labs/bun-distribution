// SPDX-License-Identifier: Apache-2.0
//! Child processes that never open a console window.
//!
//! On Windows a console program spawned by a process without a console gets a fresh console
//! window. [`NoWindow::no_window`] prevents that with `CREATE_NO_WINDOW`; when the parent already
//! owns a console the child inherits it instead, so interactive children keep a working terminal.
//! On other platforms both methods are no-ops.

/// Window policy for a process builder.
pub trait NoWindow: Sized {
    /// Keep the child from opening a console window when the parent has no console.
    #[must_use]
    fn no_window(self) -> Self;

    /// Start the child as a daemon: no console window and no console at all.
    #[must_use]
    fn detached(self) -> Self;
}

#[cfg(windows)]
mod flags {
    use std::sync::OnceLock;

    use windows::Win32::System::Console::GetConsoleWindow;

    pub(super) const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    pub(super) const DETACHED_PROCESS: u32 = 0x0000_0008;

    pub(super) fn parent_has_console() -> bool {
        static HAS_CONSOLE: OnceLock<bool> = OnceLock::new();
        // SAFETY: `GetConsoleWindow` takes no arguments and only reads the calling process state.
        *HAS_CONSOLE.get_or_init(|| !unsafe { GetConsoleWindow() }.0.is_null())
    }
}

impl NoWindow for std::process::Command {
    fn no_window(self) -> Self {
        #[cfg(windows)]
        {
            let mut command = self;
            if !flags::parent_has_console() {
                std::os::windows::process::CommandExt::creation_flags(
                    &mut command,
                    flags::CREATE_NO_WINDOW,
                );
            }
            command
        }
        #[cfg(not(windows))]
        self
    }

    fn detached(self) -> Self {
        #[cfg(windows)]
        {
            let mut command = self;
            std::os::windows::process::CommandExt::creation_flags(
                &mut command,
                flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS,
            );
            command
        }
        #[cfg(not(windows))]
        self
    }
}

#[cfg(all(feature = "tokio", not(target_arch = "wasm32")))]
impl NoWindow for tokio::process::Command {
    fn no_window(self) -> Self {
        #[cfg(windows)]
        {
            let mut command = self;
            if !flags::parent_has_console() {
                command.creation_flags(flags::CREATE_NO_WINDOW);
            }
            command
        }
        #[cfg(not(windows))]
        self
    }

    fn detached(self) -> Self {
        #[cfg(windows)]
        {
            let mut command = self;
            command.creation_flags(flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS);
            command
        }
        #[cfg(not(windows))]
        self
    }
}
