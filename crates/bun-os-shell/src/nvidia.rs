//! Read-only NVIDIA state for the quick menu: NVAPI (`nvapi64.dll`, through
//! `nvapi_QueryInterface`) for the GPU name, driver, temperature, clocks, load, G-SYNC/VRR and Reflex
//! availability; NVML (`nvml.dll`) for board power. Nothing here writes a driver profile or a
//! global setting.

use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Debug, Default)]
pub struct GpuState {
    pub available: bool,
    pub name: String,
    pub driver: String,
    pub temperature_c: Option<i32>,
    pub core_mhz: Option<u32>,
    pub memory_mhz: Option<u32>,
    pub load_percent: Option<u32>,
    pub power_w: Option<f32>,
    pub power_limit_w: Option<f32>,
    pub vram_used_mb: Option<u64>,
    pub vram_total_mb: Option<u64>,
    /// G-SYNC / VRR on the primary display: (enabled, possible, active now).
    pub vrr: Option<(bool, bool, bool)>,
    /// The driver exports the Reflex low-latency entry points (`NvAPI_D3D_SetSleepMode`).
    pub reflex_api: bool,
    pub error: Option<String>,
}

impl GpuState {
    pub fn summary(&self) -> String {
        if !self.available {
            return self
                .error
                .clone()
                .unwrap_or_else(|| "NVIDIA GPU not detected".into());
        }
        let mut parts = vec![self.name.replace("NVIDIA ", "").replace("GeForce ", "")];
        if let Some(t) = self.temperature_c {
            parts.push(format!("{t}°C"));
        }
        if let Some(p) = self.power_w {
            parts.push(format!("{p:.0} W"));
        }
        parts.join(" · ")
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::core::{s, w};

    use super::GpuState;

    type QueryInterface = unsafe extern "C" fn(u32) -> *mut c_void;
    type Handle = *mut c_void;

    const INITIALIZE: u32 = 0x0150_E828;
    const ENUM_PHYSICAL_GPUS: u32 = 0xE5AC_921F;
    const GPU_GET_FULL_NAME: u32 = 0xCEEE_8E9F;
    const GPU_GET_THERMAL_SETTINGS: u32 = 0xE364_0A56;
    const GPU_GET_ALL_CLOCK_FREQUENCIES: u32 = 0xDCB6_16C3;
    const GPU_GET_DYNAMIC_PSTATES_INFO_EX: u32 = 0x60DE_D2ED;
    const SYS_GET_DRIVER_AND_BRANCH_VERSION: u32 = 0x2926_AAAD;
    const DISP_GET_GDI_PRIMARY_DISPLAY_ID: u32 = 0x1E9D_8A31;
    const DISP_GET_VRR_INFO: u32 = 0xDF8F_DA57;
    const D3D_SET_SLEEP_MODE: u32 = 0xAC1C_A9E0;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct ThermalSensor {
        controller: i32,
        default_min: i32,
        default_max: i32,
        current: i32,
        target: i32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ThermalSettings {
        version: u32,
        count: u32,
        sensor: [ThermalSensor; 3],
    }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct ClockDomain {
        present: u32,
        frequency_khz: u32,
    }
    #[repr(C)]
    struct ClockFrequencies {
        version: u32,
        flags: u32,
        domain: [ClockDomain; 32],
    }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Utilization {
        present: u32,
        percentage: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct DynamicPstates {
        version: u32,
        flags: u32,
        utilization: [Utilization; 8],
    }
    #[repr(C)]
    #[derive(Default)]
    struct VrrInfo {
        version: u32,
        bits: u32,
        reserved: [u32; 4],
    }

    const fn version<T>(v: u32) -> u32 {
        size_of::<T>() as u32 | (v << 16)
    }

    pub struct Nvapi {
        query: QueryInterface,
        gpu: Handle,
        nvml: Option<Nvml>,
    }

    // SAFETY: NVAPI and NVML are thread-safe for these read-only queries; the handles are opaque
    // driver tokens used only by the poll thread that owns this value.
    unsafe impl Send for Nvapi {}

    struct Nvml {
        device: *mut c_void,
        power: unsafe extern "C" fn(*mut c_void, *mut u32) -> i32,
        limit: unsafe extern "C" fn(*mut c_void, *mut u32) -> i32,
        memory: unsafe extern "C" fn(*mut c_void, *mut [u64; 3]) -> i32,
    }

    fn library(name: windows::core::PCWSTR) -> Option<HMODULE> {
        // SAFETY: loading a system DLL by name.
        unsafe { LoadLibraryW(name).ok() }
    }

    impl Nvapi {
        unsafe fn function<F: Copy>(&self, id: u32) -> Option<F> {
            // SAFETY: nvapi_QueryInterface returns the entry point for `id` or null; the caller
            // names the documented signature `F` of that entry point.
            unsafe {
                let ptr = (self.query)(id);
                (!ptr.is_null()).then(|| std::mem::transmute_copy::<*mut c_void, F>(&ptr))
            }
        }

        pub fn open() -> Result<Self, String> {
            let module =
                library(w!("nvapi64.dll")).ok_or("nvapi64.dll not found (no NVIDIA driver)")?;
            // SAFETY: resolving the single exported NVAPI entry point and calling the documented
            // initialization functions with valid out pointers.
            unsafe {
                let query = GetProcAddress(module, s!("nvapi_QueryInterface"))
                    .ok_or("nvapi_QueryInterface missing")?;
                let query: QueryInterface = std::mem::transmute(query);
                let mut api = Self {
                    query,
                    gpu: std::ptr::null_mut(),
                    nvml: None,
                };
                let init: unsafe extern "C" fn() -> i32 =
                    api.function(INITIALIZE).ok_or("NvAPI_Initialize missing")?;
                let status = init();
                if status != 0 {
                    return Err(format!("NvAPI_Initialize failed ({status})"));
                }
                let enumerate: unsafe extern "C" fn(*mut [Handle; 64], *mut u32) -> i32 = api
                    .function(ENUM_PHYSICAL_GPUS)
                    .ok_or("NvAPI_EnumPhysicalGPUs missing")?;
                let mut gpus = [std::ptr::null_mut(); 64];
                let mut count = 0;
                if enumerate(&mut gpus, &mut count) != 0 || count == 0 {
                    return Err("no NVIDIA GPU".into());
                }
                api.gpu = gpus[0];
                api.nvml = Nvml::open();
                Ok(api)
            }
        }

        pub fn read(&self, state: &mut GpuState) {
            state.available = true;
            // SAFETY: every call passes the GPU handle from NvAPI_EnumPhysicalGPUs and a versioned,
            // zero-initialized struct of the documented layout.
            unsafe {
                if state.name.is_empty()
                    && let Some(f) = self
                        .function::<unsafe extern "C" fn(Handle, *mut [u8; 64]) -> i32>(
                            GPU_GET_FULL_NAME,
                        )
                {
                    let mut name = [0u8; 64];
                    if f(self.gpu, &mut name) == 0 {
                        state.name = cstr(&name);
                    }
                }
                if state.driver.is_empty()
                    && let Some(f) = self
                        .function::<unsafe extern "C" fn(*mut u32, *mut [u8; 64]) -> i32>(
                            SYS_GET_DRIVER_AND_BRANCH_VERSION,
                        )
                {
                    let (mut version, mut branch) = (0u32, [0u8; 64]);
                    if f(&mut version, &mut branch) == 0 {
                        state.driver =
                            format!("{}.{:02} ({})", version / 100, version % 100, cstr(&branch));
                    }
                }
                if let Some(f) = self
                    .function::<unsafe extern "C" fn(Handle, u32, *mut ThermalSettings) -> i32>(
                        GPU_GET_THERMAL_SETTINGS,
                    )
                {
                    let mut t = ThermalSettings {
                        version: version::<ThermalSettings>(2),
                        ..Default::default()
                    };
                    if f(self.gpu, 15, &mut t) == 0 && t.count > 0 {
                        state.temperature_c = Some(t.sensor[0].current);
                    }
                }
                if let Some(f) = self
                    .function::<unsafe extern "C" fn(Handle, *mut ClockFrequencies) -> i32>(
                        GPU_GET_ALL_CLOCK_FREQUENCIES,
                    )
                {
                    for v in [3, 2] {
                        let mut c = ClockFrequencies {
                            version: version::<ClockFrequencies>(v),
                            flags: 0,
                            domain: [ClockDomain::default(); 32],
                        };
                        if f(self.gpu, &mut c) == 0 {
                            let mhz = |d: usize| {
                                (c.domain[d].present & 1 != 0)
                                    .then_some(c.domain[d].frequency_khz / 1000)
                            };
                            state.core_mhz = mhz(0);
                            state.memory_mhz = mhz(4);
                            break;
                        }
                    }
                }
                if let Some(f) = self
                    .function::<unsafe extern "C" fn(Handle, *mut DynamicPstates) -> i32>(
                        GPU_GET_DYNAMIC_PSTATES_INFO_EX,
                    )
                {
                    let mut p = DynamicPstates {
                        version: version::<DynamicPstates>(1),
                        ..Default::default()
                    };
                    if f(self.gpu, &mut p) == 0 && p.utilization[0].present & 1 != 0 {
                        state.load_percent = Some(p.utilization[0].percentage);
                    }
                }
                if let (Some(primary), Some(vrr)) = (
                    self.function::<unsafe extern "C" fn(*mut u32) -> i32>(
                        DISP_GET_GDI_PRIMARY_DISPLAY_ID,
                    ),
                    self.function::<unsafe extern "C" fn(u32, *mut VrrInfo) -> i32>(
                        DISP_GET_VRR_INFO,
                    ),
                ) {
                    let mut display = 0u32;
                    let mut info = VrrInfo {
                        version: version::<VrrInfo>(1),
                        ..Default::default()
                    };
                    if primary(&mut display) == 0 && vrr(display, &mut info) == 0 {
                        state.vrr =
                            Some((info.bits & 1 != 0, info.bits & 2 != 0, info.bits & 16 != 0));
                    }
                }
                state.reflex_api = !(self.query)(D3D_SET_SLEEP_MODE).is_null();
                if let Some(nvml) = &self.nvml {
                    let mut mw = 0u32;
                    if (nvml.power)(nvml.device, &mut mw) == 0 {
                        state.power_w = Some(mw as f32 / 1000.0);
                    }
                    if (nvml.limit)(nvml.device, &mut mw) == 0 {
                        state.power_limit_w = Some(mw as f32 / 1000.0);
                    }
                    let mut memory = [0u64; 3];
                    if (nvml.memory)(nvml.device, &mut memory) == 0 {
                        state.vram_total_mb = Some(memory[0] >> 20);
                        state.vram_used_mb = Some(memory[2] >> 20);
                    }
                }
            }
        }
    }

    impl Nvml {
        fn open() -> Option<Self> {
            let module = library(w!("nvml.dll"))?;
            // SAFETY: NVML's documented C entry points resolved from the driver's nvml.dll.
            unsafe {
                let init: unsafe extern "C" fn() -> i32 =
                    std::mem::transmute(GetProcAddress(module, s!("nvmlInit_v2"))?);
                if init() != 0 {
                    return None;
                }
                let by_index: unsafe extern "C" fn(u32, *mut *mut c_void) -> i32 =
                    std::mem::transmute(GetProcAddress(
                        module,
                        s!("nvmlDeviceGetHandleByIndex_v2"),
                    )?);
                let mut device = std::ptr::null_mut();
                if by_index(0, &mut device) != 0 {
                    return None;
                }
                Some(Self {
                    device,
                    power: std::mem::transmute(GetProcAddress(
                        module,
                        s!("nvmlDeviceGetPowerUsage"),
                    )?),
                    limit: std::mem::transmute(GetProcAddress(
                        module,
                        s!("nvmlDeviceGetEnforcedPowerLimit"),
                    )?),
                    memory: std::mem::transmute(GetProcAddress(
                        module,
                        s!("nvmlDeviceGetMemoryInfo"),
                    )?),
                })
            }
        }
    }

    fn cstr(bytes: &[u8]) -> String {
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).trim().to_string()
    }
}

/// Starts the 1 Hz poll thread; the returned state is shared with the UI.
pub fn spawn_monitor() -> Arc<Mutex<GpuState>> {
    let shared = Arc::new(Mutex::new(GpuState::default()));
    let out = shared.clone();
    let _ = std::thread::Builder::new()
        .name("nvidia monitor".into())
        .spawn(move || {
            #[cfg(windows)]
            {
                let api = match imp::Nvapi::open() {
                    Ok(api) => api,
                    Err(e) => {
                        out.lock().unwrap().error = Some(e);
                        return;
                    }
                };
                loop {
                    let mut state = out.lock().unwrap().clone();
                    api.read(&mut state);
                    *out.lock().unwrap() = state;
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            #[cfg(not(windows))]
            {
                out.lock().unwrap().error =
                    Some("NVAPI is Windows-only; Linux uses NVML through the engine".into());
                let _ = Duration::ZERO;
            }
        });
    shared
}

/// One synchronous read (for `bun-os-shell status`).
pub fn read_once() -> GpuState {
    let mut state = GpuState::default();
    #[cfg(windows)]
    match imp::Nvapi::open() {
        Ok(api) => api.read(&mut state),
        Err(e) => state.error = Some(e),
    }
    state
}
