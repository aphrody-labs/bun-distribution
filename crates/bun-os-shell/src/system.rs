//! Windows integration, all user mode and per-user: HDR/display state (DXGI), master volume (Core
//! Audio), reduced-motion preference, power actions, the opt-in per-user startup entry, and the
//! window/process orchestration of games the shell launches (focus, borderless, exit detection).

#[derive(Clone, Debug, Default)]
pub struct DisplayInfo {
    pub name: String,
    pub hdr: bool,
    pub bits_per_color: u32,
    pub max_nits: f32,
    pub min_nits: f32,
    pub color_space: String,
}

impl DisplayInfo {
    pub fn summary(&self) -> String {
        if self.name.is_empty() {
            return "display unknown".into();
        }
        if self.hdr {
            format!(
                "HDR on · {:.0} nits peak · {}-bit",
                self.max_nits, self.bits_per_color
            )
        } else {
            format!("SDR · {}-bit · HDR passthrough off", self.bits_per_color)
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput6};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    };
    use windows::Win32::System::Power::SetSuspendState;
    use windows::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_SZ, RegCloseKey, RegDeleteValueW,
        RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VK_MENU,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GWL_EXSTYLE, GWL_STYLE, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsWindowVisible, PostMessageW, SPI_GETCLIENTAREAANIMATION,
        SW_RESTORE, SW_SHOWNORMAL, SWP_FRAMECHANGED, SWP_NOOWNERZORDER, SWP_NOZORDER,
        SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos,
        ShowWindow, SystemParametersInfoW, WM_CLOSE, WS_CAPTION, WS_EX_CLIENTEDGE,
        WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
        WS_SYSMENU, WS_THICKFRAME,
    };
    use windows::core::BOOL;
    use windows::core::{HSTRING, PCWSTR, w};

    use super::DisplayInfo;

    pub fn display_info(hwnd: Option<isize>) -> DisplayInfo {
        let mut info = DisplayInfo::default();
        // SAFETY: DXGI enumeration with owned COM interfaces; out structs are plain data.
        unsafe {
            let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
                return info;
            };
            let monitor =
                hwnd.map(|h| MonitorFromWindow(HWND(h as *mut c_void), MONITOR_DEFAULTTONEAREST));
            let mut first = None;
            let mut a = 0;
            while let Ok(adapter) = factory.EnumAdapters1(a) {
                let mut o = 0;
                while let Ok(output) = adapter.EnumOutputs(o) {
                    if let Ok(output6) = output.cast_output6() {
                        if let Ok(desc) = output6.GetDesc1() {
                            let matches = monitor.is_some_and(|m| m == desc.Monitor);
                            let entry = DisplayInfo {
                                name: String::from_utf16_lossy(&desc.DeviceName)
                                    .trim_end_matches('\0')
                                    .to_string(),
                                hdr: desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020,
                                bits_per_color: desc.BitsPerColor,
                                max_nits: desc.MaxLuminance,
                                min_nits: desc.MinLuminance,
                                color_space: format!("{:?}", desc.ColorSpace),
                            };
                            if matches {
                                return entry;
                            }
                            first.get_or_insert(entry);
                        }
                    }
                    o += 1;
                }
                a += 1;
            }
            if let Some(entry) = first {
                info = entry;
            }
        }
        info
    }

    trait CastOutput6 {
        fn cast_output6(&self) -> windows::core::Result<IDXGIOutput6>;
    }
    impl CastOutput6 for windows::Win32::Graphics::Dxgi::IDXGIOutput {
        fn cast_output6(&self) -> windows::core::Result<IDXGIOutput6> {
            windows::core::Interface::cast(self)
        }
    }

    fn endpoint() -> Option<IAudioEndpointVolume> {
        // SAFETY: COM initialization (ignored when the thread already has an apartment) and
        // activation of the default render endpoint's volume interface.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            device
                .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                .ok()
        }
    }

    pub fn volume() -> Option<f32> {
        // SAFETY: reading the scalar master volume.
        unsafe { endpoint()?.GetMasterVolumeLevelScalar().ok() }
    }

    pub fn set_volume(level: f32) -> Option<f32> {
        let endpoint = endpoint()?;
        // SAFETY: setting the scalar master volume (the same action as the taskbar slider).
        unsafe {
            endpoint
                .SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null())
                .ok()?;
            endpoint.GetMasterVolumeLevelScalar().ok()
        }
    }

    pub fn reduced_motion() -> bool {
        let mut animate = BOOL(1);
        // SAFETY: SPI_GETCLIENTAREAANIMATION writes one BOOL.
        let ok = unsafe {
            SystemParametersInfoW(
                SPI_GETCLIENTAREAANIMATION,
                0,
                Some((&raw mut animate).cast()),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        };
        ok.is_ok() && !animate.as_bool()
    }

    pub fn sleep() -> bool {
        // SAFETY: requests system sleep for the interactive user (no setting is changed).
        unsafe { SetSuspendState(false, false, false) }
    }

    pub fn open_uri(uri: &str) -> bool {
        let target = HSTRING::from(uri);
        // SAFETY: ShellExecuteW with owned wide strings; the URI is validated by the caller.
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &target,
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        result.0 as isize > 32
    }

    const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    const RUN_VALUE: PCWSTR = w!("BunOSConsoleShell");

    fn run_key(access: windows::Win32::System::Registry::REG_SAM_FLAGS) -> Option<HKEY> {
        let mut key = HKEY::default();
        // SAFETY: opening the per-user Run key.
        unsafe {
            RegOpenKeyExW(HKEY_CURRENT_USER, RUN_KEY, None, access, &mut key)
                .is_ok()
                .then_some(key)
        }
    }

    pub fn session_entry() -> Option<String> {
        let key = run_key(KEY_READ)?;
        let mut buffer = [0u16; 1024];
        let mut size = (buffer.len() * 2) as u32;
        // SAFETY: querying a REG_SZ value into a bounded buffer.
        let ok = unsafe {
            let ok = RegQueryValueExW(
                key,
                RUN_VALUE,
                None,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
            .is_ok();
            let _ = RegCloseKey(key);
            ok
        };
        ok.then(|| {
            String::from_utf16_lossy(&buffer[..(size as usize / 2)])
                .trim_end_matches('\0')
                .to_string()
        })
    }

    pub fn set_session_entry(command: Option<&str>) -> Result<(), String> {
        let key = run_key(KEY_SET_VALUE).ok_or("cannot open HKCU Run key")?;
        // SAFETY: writing or deleting our own value under the per-user Run key.
        let status = unsafe {
            let status = match command {
                Some(command) => {
                    let wide: Vec<u16> = command.encode_utf16().chain([0]).collect();
                    let bytes =
                        std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2);
                    RegSetValueExW(key, RUN_VALUE, None, REG_SZ, Some(bytes))
                }
                None => RegDeleteValueW(key, RUN_VALUE),
            };
            let _ = RegCloseKey(key);
            status
        };
        status.ok().map_err(|e| e.to_string())
    }

    struct Search {
        pids: Vec<u32>,
        found: Vec<isize>,
    }

    unsafe extern "system" fn collect(hwnd: HWND, param: LPARAM) -> BOOL {
        // SAFETY: `param` is the `Search` passed by `windows_of` for the duration of EnumWindows.
        let search = unsafe { &mut *(param.0 as *mut Search) };
        let mut pid = 0;
        // SAFETY: reading the owner process and visibility of an enumerated top-level window.
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if search.pids.contains(&pid) && IsWindowVisible(hwnd).as_bool() {
                search.found.push(hwnd.0 as isize);
            }
        }
        BOOL(1)
    }

    /// Visible top-level windows owned by `pids`.
    pub fn windows_of(pids: &[u32]) -> Vec<isize> {
        let mut search = Search {
            pids: pids.to_vec(),
            found: Vec::new(),
        };
        // SAFETY: the callback only reads window properties and writes into `search`.
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&raw mut search as isize));
        }
        search.found
    }

    pub fn foreground() -> isize {
        // SAFETY: plain query.
        unsafe { GetForegroundWindow().0 as isize }
    }

    pub fn window_pid(hwnd: isize) -> u32 {
        let mut pid = 0;
        // SAFETY: plain query on a window handle.
        unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut c_void), Some(&mut pid)) };
        pid
    }

    /// Bring a window to the foreground. A short Alt tap first makes this process eligible under
    /// the foreground lock (the documented user-input rule), without changing any setting.
    pub fn focus(hwnd: isize) {
        let alt = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_MENU,
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        // SAFETY: synthetic Alt down/up and foreground activation of a window handle.
        unsafe {
            let inputs = [alt(Default::default()), alt(KEYEVENTF_KEYUP)];
            SendInput(&inputs, size_of::<INPUT>() as i32);
            let window = HWND(hwnd as *mut c_void);
            let _ = ShowWindow(window, SW_RESTORE);
            let _ = SetForegroundWindow(window);
        }
    }

    /// Borderless full screen on the window's monitor (style change on a window of a game the
    /// shell launched). Returns false when the window already covers its monitor.
    pub fn make_borderless(hwnd: isize) -> bool {
        let window = HWND(hwnd as *mut c_void);
        // SAFETY: style and position updates on a window of a process we started.
        unsafe {
            let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
                return false;
            }
            let mut rect = RECT::default();
            let _ = GetWindowRect(window, &mut rect);
            let m = mi.rcMonitor;
            if rect == m {
                return false;
            }
            let style = GetWindowLongPtrW(window, GWL_STYLE) as u32;
            let style = (style
                & !(WS_CAPTION.0
                    | WS_THICKFRAME.0
                    | WS_MINIMIZEBOX.0
                    | WS_MAXIMIZEBOX.0
                    | WS_SYSMENU.0))
                | WS_POPUP.0;
            SetWindowLongPtrW(window, GWL_STYLE, style as isize);
            let ex = GetWindowLongPtrW(window, GWL_EXSTYLE) as u32;
            let ex = ex & !(WS_EX_DLGMODALFRAME.0 | WS_EX_CLIENTEDGE.0 | WS_EX_STATICEDGE.0);
            SetWindowLongPtrW(window, GWL_EXSTYLE, ex as isize);
            SetWindowPos(
                window,
                None,
                m.left,
                m.top,
                m.right - m.left,
                m.bottom - m.top,
                SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOOWNERZORDER,
            )
            .is_ok()
        }
    }

    /// Ask a window of a game we launched to close (WM_CLOSE, the same as its close button).
    pub fn close(hwnd: isize) {
        // SAFETY: posting WM_CLOSE to a window handle.
        unsafe {
            let _ = PostMessageW(
                Some(HWND(hwnd as *mut c_void)),
                WM_CLOSE,
                Default::default(),
                Default::default(),
            );
        }
    }
}

#[cfg(windows)]
pub use imp::*;

/// Process ids and executable names of every running process.
#[cfg(windows)]
pub fn processes() -> Vec<(u32, u32, String)> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    // SAFETY: Toolhelp snapshot iteration with a correctly sized entry; the handle is closed.
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                out.push((
                    entry.th32ProcessID,
                    entry.th32ParentProcessID,
                    String::from_utf16_lossy(&entry.szExeFile[..end]),
                ));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    out
}

/// `pid` plus every descendant process.
#[cfg(windows)]
pub fn process_tree(pid: u32) -> Vec<u32> {
    let all = processes();
    let mut tree = vec![pid];
    let mut i = 0;
    while i < tree.len() {
        let parent = tree[i];
        tree.extend(
            all.iter()
                .filter(|(p, pp, _)| *pp == parent && !tree.contains(p))
                .map(|(p, _, _)| *p)
                .collect::<Vec<_>>(),
        );
        i += 1;
    }
    tree
}

/// Game streaming or remote play sessions that should not be disturbed.
pub const STREAMING: [&str; 6] = [
    "sunshine.exe",
    "moonlight.exe",
    "parsecd.exe",
    "wolf.exe",
    "steamstreamingclient.exe",
    "streaming_client.exe",
];

/// Steam's `RunningAppID` (0 when idle).
pub fn steam_running_app() -> u32 {
    bun_steam::config::read_client_registry()
        .ok()
        .and_then(|r| r.running_app_id)
        .unwrap_or(0)
}

/// The exact one-line command that registers the session for the current user.
pub fn session_install_command() -> String {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "bun-os-shell.exe".into());
    format!("\"{exe}\" install-session")
}

pub fn session_command() -> String {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "bun-os-shell.exe".into());
    format!("\"{exe}\" --session")
}
