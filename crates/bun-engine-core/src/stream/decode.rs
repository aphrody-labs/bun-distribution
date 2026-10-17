//! Zero-copy hardware video decode into wgpu textures on Windows.
//!
//! The Windows path of lumina-video (`lumina-video-core/src/windows_video.rs` and the
//! `zero_copy::windows` module, Apache-2.0 OR MIT, Copyright (c) 2024-2026 alltheseas) is absorbed and
//! extended: Media Foundation decodes H.264/HEVC/AV1 with DXVA on a D3D11 device created on the
//! same adapter as the wgpu D3D12 device; every decoded NV12 surface is copied on the GPU into a
//! ring of NT-shared NV12 textures, a shared D3D11 fence is signalled, and the renderer opens the
//! textures and the fence through D3D12 and samples the Y/UV planes directly. No pixel touches the
//! CPU. Upstream only shared BGRA surfaces and waited on the CPU; here the D3D12 queue waits on the
//! shared fence, so the decode thread never blocks on the GPU.

use std::{
    ffi::c_void,
    mem::ManuallyDrop,
    ptr::null_mut,
    sync::{Arc, Condvar, Mutex},
    time::Instant,
};

use aphrody_gpu_backend::wgpu;
use windows::{
    Win32::{
        Foundation::{CloseHandle, GENERIC_ALL, HANDLE, HMODULE, LUID},
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_1},
            Direct3D11::{
                D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                D3D11_FEATURE_D3D11_OPTIONS4, D3D11_FEATURE_DATA_D3D11_OPTIONS4,
                D3D11_FENCE_FLAG_SHARED, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
                D3D11_RESOURCE_MISC_SHARED, D3D11_RESOURCE_MISC_SHARED_NTHANDLE, D3D11_SDK_VERSION,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING, D3D11CreateDevice,
                ID3D11Device, ID3D11Device5, ID3D11DeviceContext, ID3D11DeviceContext4,
                ID3D11Fence, ID3D11Multithread, ID3D11Texture2D,
            },
            Direct3D12::{ID3D12Device, ID3D12Fence, ID3D12Resource},
            Dxgi::{
                Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC},
                CreateDXGIFactory1, DXGI_SHARED_RESOURCE_READ, DXGI_SHARED_RESOURCE_WRITE,
                IDXGIAdapter, IDXGIFactory4, IDXGIResource1,
            },
        },
        Media::MediaFoundation::{
            IMFActivate, IMFDXGIBuffer, IMFDXGIDeviceManager, IMFMediaType, IMFSample,
            IMFTransform, MF_E_NOTACCEPTING, MF_E_TRANSFORM_NEED_MORE_INPUT,
            MF_E_TRANSFORM_STREAM_CHANGE, MF_LOW_LATENCY, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE,
            MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE,
            MF_SA_D3D11_AWARE, MF_VERSION, MFCreateDXGIDeviceManager, MFCreateMediaType,
            MFCreateMemoryBuffer, MFCreateSample, MFMediaType_Video, MFSTARTUP_NOSOCKET, MFStartup,
            MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_SORTANDFILTER, MFT_ENUM_FLAG_SYNCMFT,
            MFT_FRIENDLY_NAME_Attribute, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
            MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_MESSAGE_SET_D3D_MANAGER,
            MFT_OUTPUT_DATA_BUFFER, MFT_OUTPUT_STREAM_PROVIDES_SAMPLES, MFT_REGISTER_TYPE_INFO,
            MFTEnumEx, MFVideoFormat_AV1, MFVideoFormat_H264, MFVideoFormat_HEVC,
            MFVideoFormat_NV12, MFVideoInterlace_Progressive,
        },
        System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoTaskMemFree},
    },
    core::{GUID, Interface, PWSTR},
};

pub use super::Codec;

fn subtype(codec: Codec) -> GUID {
    match codec {
        Codec::H264 => MFVideoFormat_H264,
        Codec::Hevc => MFVideoFormat_HEVC,
        Codec::Av1 => MFVideoFormat_AV1,
    }
}

/// A raw Windows handle moved between the decode and render threads.
#[derive(Clone, Copy, Debug)]
pub struct SendHandle(pub HANDLE);
// SAFETY: NT handles are process-wide kernel object references, valid on any thread.
unsafe impl Send for SendHandle {}
// SAFETY: see above; the handle value is only read.
unsafe impl Sync for SendHandle {}

/// The shared NV12 ring and fence, announced once per output geometry.
#[derive(Clone, Debug)]
pub struct SharedSet {
    pub generation: u32,
    pub width: u32,
    pub height: u32,
    pub textures: Vec<SendHandle>,
    pub fence: SendHandle,
}

/// One decoded picture, either resident in a shared ring slot or read back to the CPU.
#[derive(Debug)]
pub enum Picture {
    Shared {
        generation: u32,
        slot: usize,
        fence_value: u64,
    },
    /// NV12 rows (`pitch` bytes each): `height` luma rows then `height / 2` chroma rows.
    Cpu {
        width: u32,
        height: u32,
        pitch: u32,
        nv12: Vec<u8>,
    },
}

/// Timing and identity of a decoded frame.
#[derive(Clone, Copy, Debug)]
pub struct FrameMeta {
    pub index: u32,
    pub rtp_timestamp: u32,
    pub host_latency: u16,
    pub first_packet: Instant,
    pub completed: Instant,
    pub decode_start: Instant,
    pub decoded: Instant,
    pub recovered: u32,
    pub bytes: usize,
    /// Shared-fence value of the decoder's copy (0 for CPU pictures).
    pub fence_value: u64,
}

pub struct Decoded {
    pub picture: Picture,
    pub meta: FrameMeta,
}

pub const RING: usize = 5;

#[derive(Default)]
struct MailboxState {
    frame: Option<Decoded>,
    /// Ring slots the renderer still samples (bit per slot).
    pinned: u32,
    /// Ring announced by the decoder and not yet imported by the renderer.
    announce: Option<SharedSet>,
    closed: Option<String>,
    decoded: u64,
    replaced: u64,
}

/// Latest-frame mailbox between the decoder and the renderer (tether's `LatestFrame`, extended
/// with ring-slot pinning so the decoder never overwrites a texture the GPU still reads).
#[derive(Default)]
pub struct Mailbox {
    state: Mutex<MailboxState>,
    freed: Condvar,
    /// When the GPU finished decoding + copying each fence value.
    pub decode_clock: DecodeClock,
}

const DECODE_SLOTS: usize = 256;

/// GPU completion time of the decoder's shared-fence values.
pub struct DecodeClock {
    epoch: Instant,
    done: Vec<std::sync::atomic::AtomicU64>,
}

impl Default for DecodeClock {
    fn default() -> Self {
        Self {
            epoch: Instant::now(),
            done: (0..DECODE_SLOTS).map(|_| Default::default()).collect(),
        }
    }
}

impl DecodeClock {
    fn record(&self, value: u64, at: Instant) {
        let ns = at.duration_since(self.epoch).as_nanos() as u64;
        // Low bits carry the slot; the stored word tags the value so stale slots are ignored.
        self.done[value as usize % DECODE_SLOTS].store(
            (ns << 8) | (value & 0xff),
            std::sync::atomic::Ordering::Release,
        );
    }

    pub fn done(&self, value: u64) -> Option<Instant> {
        let word =
            self.done[value as usize % DECODE_SLOTS].load(std::sync::atomic::Ordering::Acquire);
        (word != 0 && word & 0xff == value & 0xff)
            .then(|| self.epoch + std::time::Duration::from_nanos(word >> 8))
    }
}

impl Mailbox {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Decoder: a ring slot that is neither pinned nor waiting in the mailbox.
    fn free_slot(&self, after: usize) -> usize {
        let mut state = self.state.lock().unwrap();
        loop {
            let waiting = match state.frame.as_ref().map(|f| &f.picture) {
                Some(Picture::Shared { slot, .. }) => 1 << slot,
                _ => 0,
            };
            let busy = state.pinned | waiting;
            if let Some(slot) = (1..=RING)
                .map(|d| (after + d) % RING)
                .find(|s| busy & (1 << s) == 0)
            {
                return slot;
            }
            state = self.freed.wait(state).unwrap();
        }
    }

    fn announce(&self, set: SharedSet) {
        let mut state = self.state.lock().unwrap();
        state.announce = Some(set);
        state.frame = None;
        state.pinned = 0;
    }

    fn publish(&self, frame: Decoded) {
        let mut state = self.state.lock().unwrap();
        state.decoded += 1;
        if state.frame.replace(frame).is_some() {
            state.replaced += 1;
        }
    }

    pub fn close(&self, why: String) {
        self.state.lock().unwrap().closed = Some(why);
    }

    /// Renderer: take the newest frame, pinning its ring slot.
    pub fn take(&self) -> (Option<SharedSet>, Option<Decoded>) {
        let mut state = self.state.lock().unwrap();
        let announce = state.announce.take();
        let frame = state.frame.take();
        if let Some(Decoded {
            picture: Picture::Shared { slot, .. },
            ..
        }) = frame.as_ref()
        {
            state.pinned |= 1 << slot;
        }
        (announce, frame)
    }

    /// Renderer: the GPU finished every submission that sampled `slot`.
    pub fn release(&self, slot: usize) {
        self.state.lock().unwrap().pinned &= !(1 << slot);
        self.freed.notify_all();
    }

    pub fn closed(&self) -> Option<String> {
        self.state.lock().unwrap().closed.clone()
    }

    /// (frames decoded, frames replaced before the renderer took them).
    pub fn counters(&self) -> (u64, u64) {
        let state = self.state.lock().unwrap();
        (state.decoded, state.replaced)
    }
}

fn hr(context: &str) -> impl FnOnce(windows::core::Error) -> String + '_ {
    move |e| format!("{context}: {e}")
}

/// Initialize COM (MTA) and Media Foundation on the calling thread.
pub fn media_foundation_startup() -> Result<(), String> {
    // SAFETY: plain COM/MF initialization; failures are reported, repeated calls are refcounted.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(hr("MFStartup"))
    }
}

/// D3D11 device on the adapter identified by `luid`, with video support and multithread
/// protection (Media Foundation uses it from its own threads).
pub fn d3d11_device(luid: LUID) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    // SAFETY: COM calls with valid out pointers; returned interfaces are reference counted.
    unsafe {
        let factory: IDXGIFactory4 = CreateDXGIFactory1().map_err(hr("CreateDXGIFactory1"))?;
        let adapter: IDXGIAdapter = factory
            .EnumAdapterByLuid(luid)
            .map_err(hr("EnumAdapterByLuid"))?;
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(
            &adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_1]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(hr("D3D11CreateDevice"))?;
        let device: ID3D11Device = device.ok_or("D3D11CreateDevice returned no device")?;
        let context = context.ok_or("D3D11CreateDevice returned no context")?;
        let multithread: ID3D11Multithread = device.cast().map_err(hr("ID3D11Multithread"))?;
        let _ = multithread.SetMultithreadProtected(true);
        Ok((device, context))
    }
}

/// The LUID of the adapter behind a wgpu DX12 device.
pub fn wgpu_adapter_luid(device: &wgpu::Device) -> Result<LUID, String> {
    // SAFETY: the HAL device is only borrowed for the duration of the call.
    unsafe {
        let hal = device
            .as_hal::<wgpu::hal::api::Dx12>()
            .ok_or("the wgpu device is not DX12")?;
        Ok(hal.raw_device().GetAdapterLuid())
    }
}

pub(crate) fn media_type(major: GUID, subtype: GUID) -> Result<IMFMediaType, String> {
    // SAFETY: attribute setters on a freshly created media type.
    unsafe {
        let t = MFCreateMediaType().map_err(hr("MFCreateMediaType"))?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &major)
            .map_err(hr("MF_MT_MAJOR_TYPE"))?;
        t.SetGUID(&MF_MT_SUBTYPE, &subtype)
            .map_err(hr("MF_MT_SUBTYPE"))?;
        Ok(t)
    }
}

pub fn pack(hi: u32, lo: u32) -> u64 {
    (u64::from(hi) << 32) | u64::from(lo)
}

/// Every registered decoder MFT for `codec`, best first (activation objects).
fn enumerate(
    category: GUID,
    input: Option<GUID>,
    output: Option<GUID>,
) -> Result<Vec<IMFActivate>, String> {
    let input = input.map(|subtype| MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: subtype,
    });
    let output = output.map(|subtype| MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: subtype,
    });
    let mut list: *mut Option<IMFActivate> = null_mut();
    let mut count = 0u32;
    // SAFETY: MFTEnumEx allocates `list` with CoTaskMemAlloc; every element is taken (released by
    // drop) before the array itself is freed.
    unsafe {
        MFTEnumEx(
            category,
            MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
            input.as_ref().map(|i| i as *const _),
            output.as_ref().map(|o| o as *const _),
            &mut list,
            &mut count,
        )
        .map_err(hr("MFTEnumEx"))?;
        let items = if list.is_null() {
            Vec::new()
        } else {
            std::slice::from_raw_parts_mut(list, count as usize)
                .iter_mut()
                .filter_map(Option::take)
                .collect()
        };
        if !list.is_null() {
            CoTaskMemFree(Some(list as *const c_void));
        }
        Ok(items)
    }
}

pub fn friendly_name(activate: &IMFActivate) -> String {
    let mut name = PWSTR::null();
    let mut len = 0u32;
    // SAFETY: GetAllocatedString returns a CoTaskMemAlloc string we free after copying.
    unsafe {
        if activate
            .GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut name, &mut len)
            .is_ok()
            && !name.is_null()
        {
            let s = name.to_string().unwrap_or_default();
            CoTaskMemFree(Some(name.0 as *const c_void));
            return s;
        }
    }
    "unnamed MFT".into()
}

pub(crate) fn activate_mfts(
    category: GUID,
    input: Option<GUID>,
    output: Option<GUID>,
) -> Result<Vec<(String, IMFTransform)>, String> {
    let mut out = Vec::new();
    for activate in enumerate(category, input, output)? {
        // SAFETY: activation of a registered MFT.
        if let Ok(transform) = unsafe { activate.ActivateObject::<IMFTransform>() } {
            out.push((friendly_name(&activate), transform));
        }
    }
    Ok(out)
}

/// Is a Media Foundation decoder registered for `codec`?
pub fn decoder_available(codec: Codec) -> bool {
    let _ = media_foundation_startup();
    enumerate(MFT_CATEGORY_VIDEO_DECODER, Some(subtype(codec)), None).is_ok_and(|v| !v.is_empty())
}

struct Slot {
    texture: ID3D11Texture2D,
    handle: HANDLE,
}

/// Media Foundation hardware decoder bound to the wgpu adapter.
pub struct Decoder {
    pub name: String,
    pub hardware: bool,
    pub codec: Codec,
    device: ID3D11Device,
    context: ID3D11DeviceContext4,
    _manager: IMFDXGIDeviceManager,
    transform: IMFTransform,
    provides_samples: bool,
    output_bytes: u32,
    width: u32,
    height: u32,
    stride: u32,
    fence: ID3D11Fence,
    fence_handle: HANDLE,
    fence_value: u64,
    slots: Vec<Slot>,
    retired: Vec<Slot>,
    last_slot: usize,
    generation: u32,
    shared_nv12: bool,
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    mailbox: Arc<Mailbox>,
    watch: Option<std::sync::mpsc::Sender<u64>>,
}

struct D3D11FenceRef(ID3D11Fence);
// SAFETY: ID3D11Fence is free-threaded.
unsafe impl Send for D3D11FenceRef {}

/// Timestamp the GPU completion of each decoder copy (hardware decode + NV12 copy).
fn watch_decode(fence: ID3D11Fence, mailbox: Arc<Mailbox>) -> Option<std::sync::mpsc::Sender<u64>> {
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
    let (tx, rx) = std::sync::mpsc::channel::<u64>();
    let fence = D3D11FenceRef(fence);
    std::thread::Builder::new()
        .name("decode-clock".into())
        .spawn(move || {
            let fence = fence;
            // SAFETY: an auto-reset event owned by this thread, waited on with our fence.
            unsafe {
                let Ok(event) = CreateEventW(None, false, false, None) else {
                    return;
                };
                for value in rx {
                    if fence.0.GetCompletedValue() < value
                        && fence.0.SetEventOnCompletion(value, event).is_ok()
                    {
                        WaitForSingleObject(event, 2000);
                    }
                    mailbox.decode_clock.record(value, Instant::now());
                }
                let _ = CloseHandle(event);
            }
        })
        .ok()?;
    Some(tx)
}

// SAFETY: the decoder is created and used on its own decode thread only; it is moved there once.
unsafe impl Send for Decoder {}

impl Decoder {
    pub fn new(
        codec: Codec,
        luid: LUID,
        width: u32,
        height: u32,
        fps: u32,
        mailbox: Arc<Mailbox>,
    ) -> Result<Self, String> {
        media_foundation_startup()?;
        let (device, context) = d3d11_device(luid)?;
        let context: ID3D11DeviceContext4 = context.cast().map_err(hr("ID3D11DeviceContext4"))?;
        // SAFETY: COM calls on interfaces created above; out pointers are valid locals.
        unsafe {
            let mut token = 0u32;
            let mut manager = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)
                .map_err(hr("MFCreateDXGIDeviceManager"))?;
            let manager: IMFDXGIDeviceManager = manager.ok_or("no DXGI device manager")?;
            manager
                .ResetDevice(&device, token)
                .map_err(hr("ResetDevice"))?;

            let candidates = activate_mfts(MFT_CATEGORY_VIDEO_DECODER, Some(subtype(codec)), None)?;
            if candidates.is_empty() {
                return Err(format!(
                    "no Media Foundation {} decoder is installed",
                    codec.name()
                ));
            }
            let mut last_error = String::new();
            for (name, transform) in candidates {
                let attrs = transform.GetAttributes().ok();
                let aware = attrs
                    .as_ref()
                    .is_some_and(|a| a.GetUINT32(&MF_SA_D3D11_AWARE).unwrap_or(0) != 0);
                if let Some(a) = attrs.as_ref() {
                    let _ = a.SetUINT32(&MF_LOW_LATENCY, 1);
                }
                if aware
                    && let Err(e) = transform
                        .ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)
                {
                    last_error = format!("{name}: D3D manager: {e}");
                    continue;
                }
                let input = media_type(MFMediaType_Video, subtype(codec))?;
                input
                    .SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))
                    .map_err(hr("frame size"))?;
                input
                    .SetUINT64(&MF_MT_FRAME_RATE, pack(fps.max(1), 1))
                    .map_err(hr("frame rate"))?;
                input
                    .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                    .map_err(hr("interlace"))?;
                if let Err(e) = transform.SetInputType(0, &input, 0) {
                    last_error = format!("{name}: input type: {e}");
                    continue;
                }
                let fence: ID3D11Fence = {
                    let device5: ID3D11Device5 = device.cast().map_err(hr("ID3D11Device5"))?;
                    let mut fence: Option<ID3D11Fence> = None;
                    device5
                        .CreateFence(0, D3D11_FENCE_FLAG_SHARED, &mut fence)
                        .map_err(hr("CreateFence"))?;
                    fence.ok_or("CreateFence returned nothing")?
                };
                let fence_handle = fence
                    .CreateSharedHandle(None, GENERIC_ALL.0, None)
                    .map_err(hr("fence handle"))?;
                let mut options = D3D11_FEATURE_DATA_D3D11_OPTIONS4::default();
                let shared_nv12 = device
                    .CheckFeatureSupport(
                        D3D11_FEATURE_D3D11_OPTIONS4,
                        &mut options as *mut _ as *mut c_void,
                        size_of::<D3D11_FEATURE_DATA_D3D11_OPTIONS4>() as u32,
                    )
                    .is_ok()
                    && options.ExtendedNV12SharedTextureSupported.as_bool()
                    && std::env::var_os("BUN_STREAM_CPU_COPY").is_none();
                let mut decoder = Self {
                    name,
                    hardware: aware,
                    codec,
                    device: device.clone(),
                    context: context.clone(),
                    _manager: manager.clone(),
                    transform,
                    provides_samples: false,
                    output_bytes: 0,
                    width,
                    height,
                    stride: width,
                    fence,
                    fence_handle,
                    fence_value: 0,
                    slots: Vec::new(),
                    retired: Vec::new(),
                    last_slot: 0,
                    generation: 0,
                    shared_nv12,
                    staging: None,
                    mailbox: mailbox.clone(),
                    watch: None,
                };
                decoder.watch = watch_decode(decoder.fence.clone(), mailbox.clone());
                if let Err(e) = decoder.configure_output() {
                    last_error = format!("{}: {e}", decoder.name);
                    continue;
                }
                let _ = decoder
                    .transform
                    .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
                let _ = decoder
                    .transform
                    .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
                return Ok(decoder);
            }
            Err(format!("no usable {} decoder: {last_error}", codec.name()))
        }
    }

    /// Select NV12 output and read its geometry.
    fn configure_output(&mut self) -> Result<(), String> {
        // SAFETY: media-type enumeration on our transform.
        unsafe {
            let mut index = 0;
            loop {
                let t = self
                    .transform
                    .GetOutputAvailableType(0, index)
                    .map_err(hr("no NV12 output type"))?;
                if t.GetGUID(&MF_MT_SUBTYPE).ok() == Some(MFVideoFormat_NV12) {
                    self.transform
                        .SetOutputType(0, &t, 0)
                        .map_err(hr("SetOutputType"))?;
                    if let Ok(size) = t.GetUINT64(&MF_MT_FRAME_SIZE) {
                        self.width = (size >> 32) as u32;
                        self.height = size as u32;
                    }
                    self.stride = t
                        .GetUINT32(&MF_MT_DEFAULT_STRIDE)
                        .map_or(self.width, |s| s as i32 as u32);
                    break;
                }
                index += 1;
            }
            let info = self
                .transform
                .GetOutputStreamInfo(0)
                .map_err(hr("GetOutputStreamInfo"))?;
            self.provides_samples = info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0;
            self.output_bytes = info.cbSize;
        }
        Ok(())
    }

    /// Create (or recreate) the shared NV12 ring for `width` x `height`.
    fn ensure_ring(&mut self, width: u32, height: u32) -> Result<(), String> {
        let (width, height) = (width & !1, height & !1);
        if !self.slots.is_empty() {
            // SAFETY: GetDesc fills a plain struct.
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { self.slots[0].texture.GetDesc(&mut desc) };
            if desc.Width == width && desc.Height == height {
                return Ok(());
            }
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 | D3D11_RESOURCE_MISC_SHARED.0)
                as u32,
        };
        let mut slots = Vec::with_capacity(RING);
        for _ in 0..RING {
            // SAFETY: texture creation with a valid descriptor, then an NT handle for D3D12.
            unsafe {
                let mut texture = None;
                self.device
                    .CreateTexture2D(&desc, None, Some(&mut texture))
                    .map_err(hr("shared NV12 texture"))?;
                let texture: ID3D11Texture2D = texture.ok_or("no texture")?;
                let resource: IDXGIResource1 = texture.cast().map_err(hr("IDXGIResource1"))?;
                let handle = resource
                    .CreateSharedHandle(
                        None,
                        DXGI_SHARED_RESOURCE_READ.0 | DXGI_SHARED_RESOURCE_WRITE.0,
                        None,
                    )
                    .map_err(hr("CreateSharedHandle"))?;
                slots.push(Slot { texture, handle });
            }
        }
        // The renderer holds its own D3D12 references. Handles of the ring before the previous one
        // are closed now; the previous ring's stay open one more generation in case the renderer is
        // importing it right now.
        for old in self.retired.drain(..) {
            // SAFETY: the handle came from CreateSharedHandle and is closed once.
            unsafe {
                let _ = CloseHandle(old.handle);
            }
        }
        self.retired = std::mem::replace(&mut self.slots, slots);
        self.generation += 1;
        self.mailbox.announce(SharedSet {
            generation: self.generation,
            width,
            height,
            textures: self.slots.iter().map(|s| SendHandle(s.handle)).collect(),
            fence: SendHandle(self.fence_handle),
        });
        Ok(())
    }

    /// Decode one access unit and publish every picture it yields.
    pub fn decode(&mut self, au: &[u8], meta: FrameMeta) -> Result<usize, String> {
        // SAFETY: MF sample/buffer construction and transform calls on our own objects; the locked
        // buffer pointer is valid for `au.len()` bytes until Unlock.
        unsafe {
            let sample = MFCreateSample().map_err(hr("MFCreateSample"))?;
            let buffer =
                MFCreateMemoryBuffer(au.len() as u32).map_err(hr("MFCreateMemoryBuffer"))?;
            let mut ptr = null_mut();
            buffer.Lock(&mut ptr, None, None).map_err(hr("Lock"))?;
            std::ptr::copy_nonoverlapping(au.as_ptr(), ptr, au.len());
            buffer.Unlock().map_err(hr("Unlock"))?;
            buffer
                .SetCurrentLength(au.len() as u32)
                .map_err(hr("SetCurrentLength"))?;
            sample.AddBuffer(&buffer).map_err(hr("AddBuffer"))?;
            sample
                .SetSampleTime(i64::from(meta.index) * 10_000)
                .map_err(hr("SetSampleTime"))?;
            let mut produced = 0;
            for _ in 0..4 {
                match self.transform.ProcessInput(0, &sample, 0) {
                    Ok(()) => break,
                    Err(e) if e.code() == MF_E_NOTACCEPTING => produced += self.drain(meta)?,
                    Err(e) => return Err(format!("ProcessInput: {e}")),
                }
            }
            produced += self.drain(meta)?;
            Ok(produced)
        }
    }

    unsafe fn drain(&mut self, meta: FrameMeta) -> Result<usize, String> {
        let mut produced = 0;
        loop {
            let provided = if self.provides_samples {
                None
            } else {
                // SAFETY: MF allocation calls.
                unsafe {
                    let s = MFCreateSample().map_err(hr("MFCreateSample"))?;
                    let b = MFCreateMemoryBuffer(
                        self.output_bytes.max(self.width * self.height * 3 / 2),
                    )
                    .map_err(hr("MFCreateMemoryBuffer"))?;
                    s.AddBuffer(&b).map_err(hr("AddBuffer"))?;
                    Some(s)
                }
            };
            let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: ManuallyDrop::new(provided),
                dwStatus: 0,
                pEvents: ManuallyDrop::new(None),
            }];
            let mut status = 0u32;
            // SAFETY: `buffers` lives across the call; ownership of the returned sample and event
            // collection is taken back with ManuallyDrop::take below.
            let result = unsafe { self.transform.ProcessOutput(0, &mut buffers, &mut status) };
            let sample = unsafe { ManuallyDrop::take(&mut buffers[0].pSample) };
            drop(unsafe { ManuallyDrop::take(&mut buffers[0].pEvents) });
            match result {
                Ok(()) => {
                    if let Some(sample) = sample {
                        self.publish(&sample, meta)?;
                        produced += 1;
                    }
                }
                Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(produced),
                Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => self.configure_output()?,
                Err(e) => return Err(format!("ProcessOutput: {e}")),
            }
        }
    }

    fn publish(&mut self, sample: &IMFSample, meta: FrameMeta) -> Result<(), String> {
        let (width, height) = (self.width & !1, self.height & !1);
        // SAFETY: buffer/texture queries and GPU copies on objects owned by this decoder.
        let picture = unsafe {
            let buffer = sample.GetBufferByIndex(0).map_err(hr("GetBufferByIndex"))?;
            if let Ok(dxgi) = buffer.cast::<IMFDXGIBuffer>() {
                let mut texture: Option<ID3D11Texture2D> = None;
                dxgi.GetResource(
                    &ID3D11Texture2D::IID,
                    &mut texture as *mut _ as *mut *mut c_void,
                )
                .map_err(hr("IMFDXGIBuffer::GetResource"))?;
                let texture = texture.ok_or("decoder sample has no texture")?;
                let subresource = dxgi
                    .GetSubresourceIndex()
                    .map_err(hr("GetSubresourceIndex"))?;
                let region = D3D11_BOX {
                    left: 0,
                    top: 0,
                    front: 0,
                    right: width,
                    bottom: height,
                    back: 1,
                };
                if self.shared_nv12 {
                    self.ensure_ring(width, height)?;
                    let slot = self.mailbox.free_slot(self.last_slot);
                    self.last_slot = slot;
                    self.context.CopySubresourceRegion(
                        &self.slots[slot].texture,
                        0,
                        0,
                        0,
                        0,
                        &texture,
                        subresource,
                        Some(&region),
                    );
                    self.fence_value += 1;
                    self.context
                        .Signal(&self.fence, self.fence_value)
                        .map_err(hr("Signal"))?;
                    self.context.Flush();
                    if let Some(watch) = self.watch.as_ref() {
                        let _ = watch.send(self.fence_value);
                    }
                    Picture::Shared {
                        generation: self.generation,
                        slot,
                        fence_value: self.fence_value,
                    }
                } else {
                    let staging = self.staging_texture(width, height)?;
                    self.context.CopySubresourceRegion(
                        &staging,
                        0,
                        0,
                        0,
                        0,
                        &texture,
                        subresource,
                        Some(&region),
                    );
                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                    self.context
                        .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                        .map_err(hr("Map"))?;
                    let pitch = mapped.RowPitch;
                    let len = (pitch * height * 3 / 2) as usize;
                    let nv12 = std::slice::from_raw_parts(mapped.pData as *const u8, len).to_vec();
                    self.context.Unmap(&staging, 0);
                    Picture::Cpu {
                        width,
                        height,
                        pitch,
                        nv12,
                    }
                }
            } else {
                let contiguous = sample
                    .ConvertToContiguousBuffer()
                    .map_err(hr("ConvertToContiguousBuffer"))?;
                let mut ptr = null_mut();
                let mut len = 0u32;
                contiguous
                    .Lock(&mut ptr, None, Some(&mut len))
                    .map_err(hr("Lock"))?;
                let nv12 = std::slice::from_raw_parts(ptr, len as usize).to_vec();
                let _ = contiguous.Unlock();
                let pitch = self.stride.max(width);
                if nv12.len() < (pitch * height * 3 / 2) as usize {
                    return Err("short software NV12 buffer".into());
                }
                Picture::Cpu {
                    width,
                    height,
                    pitch,
                    nv12,
                }
            }
        };
        let fence_value = match &picture {
            Picture::Shared { fence_value, .. } => *fence_value,
            Picture::Cpu { .. } => 0,
        };
        self.mailbox.publish(Decoded {
            picture,
            meta: FrameMeta {
                decoded: Instant::now(),
                fence_value,
                ..meta
            },
        });
        Ok(())
    }

    fn staging_texture(&mut self, width: u32, height: u32) -> Result<ID3D11Texture2D, String> {
        if let Some((t, w, h)) = self.staging.as_ref()
            && *w == width
            && *h == height
        {
            return Ok(t.clone());
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut texture = None;
        // SAFETY: texture creation with a valid descriptor.
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut texture)) }
            .map_err(hr("staging texture"))?;
        let texture: ID3D11Texture2D = texture.ok_or("no staging texture")?;
        self.staging = Some((texture.clone(), width, height));
        Ok(texture)
    }

    pub fn zero_copy(&self) -> bool {
        self.shared_nv12
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        // SAFETY: handles created by this decoder, closed exactly once.
        unsafe {
            for slot in self.slots.drain(..).chain(self.retired.drain(..)) {
                let _ = CloseHandle(slot.handle);
            }
            let _ = CloseHandle(self.fence_handle);
        }
    }
}

/// D3D12 side of the shared ring: textures imported into wgpu and the fence the queue waits on.
pub struct ImportedRing {
    pub generation: u32,
    pub width: u32,
    pub height: u32,
    pub textures: Vec<wgpu::Texture>,
    fence: ID3D12Fence,
}

// SAFETY: ID3D12Fence is free-threaded; the ring lives on the render thread.
unsafe impl Send for ImportedRing {}

impl ImportedRing {
    /// Open the decoder's NT handles through the wgpu D3D12 device (lumina-video's
    /// `import_d3d11_shared_handle`, extended to NV12 planes and a shared fence).
    pub fn import(device: &wgpu::Device, set: &SharedSet) -> Result<Self, String> {
        // SAFETY: the handles are valid NT handles from CreateSharedHandle (the decoder keeps them
        // open until the next announce); D3D12 takes its own references.
        unsafe {
            let hal = device
                .as_hal::<wgpu::hal::api::Dx12>()
                .ok_or("the wgpu device is not DX12")?;
            let raw: &ID3D12Device = hal.raw_device();
            let mut fence: Option<ID3D12Fence> = None;
            raw.OpenSharedHandle(set.fence.0, &mut fence)
                .map_err(hr("OpenSharedHandle(fence)"))?;
            let fence = fence.ok_or("no fence")?;
            let mut resources = Vec::new();
            for handle in &set.textures {
                let mut resource: Option<ID3D12Resource> = None;
                raw.OpenSharedHandle(handle.0, &mut resource)
                    .map_err(hr("OpenSharedHandle(texture)"))?;
                resources.push(resource.ok_or("no resource")?);
            }
            drop(hal);
            let size = wgpu::Extent3d {
                width: set.width,
                height: set.height,
                depth_or_array_layers: 1,
            };
            let textures = resources
                .into_iter()
                .map(|resource| {
                    let hal_texture = wgpu::hal::dx12::Device::texture_from_raw(
                        resource,
                        wgpu::TextureFormat::NV12,
                        wgpu::TextureDimension::D2,
                        size,
                        1,
                        1,
                    );
                    device.create_texture_from_hal::<wgpu::hal::api::Dx12>(
                        hal_texture,
                        &wgpu::TextureDescriptor {
                            label: Some("decoded NV12"),
                            size,
                            mip_level_count: 1,
                            sample_count: 1,
                            dimension: wgpu::TextureDimension::D2,
                            format: wgpu::TextureFormat::NV12,
                            usage: wgpu::TextureUsages::TEXTURE_BINDING,
                            view_formats: &[],
                        },
                        // Shared resources sit in COMMON; sampling promotes them implicitly and they
                        // decay back to COMMON after each submission, which D3D11 requires.
                        wgpu::TextureUses::RESOURCE,
                    )
                })
                .collect();
            Ok(Self {
                generation: set.generation,
                width: set.width,
                height: set.height,
                textures,
                fence,
            })
        }
    }

    /// Make the wgpu queue wait (on the GPU) until the decoder's copy for `value` landed.
    pub fn gpu_wait(&self, queue: &wgpu::Queue, value: u64) -> Result<(), String> {
        // SAFETY: the queue is borrowed only for the Wait call; the fence outlives it.
        unsafe {
            let hal = queue
                .as_hal::<wgpu::hal::api::Dx12>()
                .ok_or("the wgpu queue is not DX12")?;
            hal.as_raw()
                .Wait(&self.fence, value)
                .map_err(hr("ID3D12CommandQueue::Wait"))
        }
    }

    /// Fence value the decoder's copies reached (for latency statistics).
    pub fn completed(&self) -> u64 {
        // SAFETY: plain query on a live fence.
        unsafe { self.fence.GetCompletedValue() }
    }
}

type GpuDone = Box<dyn FnOnce(Instant) + Send>;

struct FenceRef(ID3D12Fence);
// SAFETY: ID3D12Fence is free-threaded.
unsafe impl Send for FenceRef {}

/// Precise GPU-completion timestamps for wgpu submissions: a D3D12 fence signalled on the wgpu
/// queue right after each submit, waited on by a watcher thread.
pub struct GpuClock {
    fence: FenceRef,
    value: u64,
    tx: std::sync::mpsc::Sender<(u64, GpuDone)>,
}

impl GpuClock {
    pub fn new(device: &wgpu::Device) -> Result<Self, String> {
        use windows::Win32::{
            Graphics::Direct3D12::D3D12_FENCE_FLAG_NONE,
            System::Threading::{CreateEventW, WaitForSingleObject},
        };
        // SAFETY: fence creation on the live wgpu D3D12 device.
        let fence: ID3D12Fence = unsafe {
            let hal = device
                .as_hal::<wgpu::hal::api::Dx12>()
                .ok_or("the wgpu device is not DX12")?;
            hal.raw_device()
                .CreateFence(0, D3D12_FENCE_FLAG_NONE)
                .map_err(hr("CreateFence"))?
        };
        let (tx, rx) = std::sync::mpsc::channel::<(u64, GpuDone)>();
        let watched = FenceRef(fence.clone());
        std::thread::Builder::new()
            .name("gpu-clock".into())
            .spawn(move || {
                let watched = watched;
                // SAFETY: an auto-reset event owned by this thread.
                let Ok(event) = (unsafe { CreateEventW(None, false, false, None) }) else {
                    return;
                };
                for (value, done) in rx {
                    // SAFETY: waiting on our fence with our event.
                    unsafe {
                        if watched.0.GetCompletedValue() < value
                            && watched.0.SetEventOnCompletion(value, event).is_ok()
                        {
                            WaitForSingleObject(event, 2000);
                        }
                    }
                    done(Instant::now());
                }
                // SAFETY: closing the event created above.
                unsafe {
                    let _ = CloseHandle(event);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            fence: FenceRef(fence),
            value: 0,
            tx,
        })
    }

    /// Signal after the last `queue.submit`; `done` runs once the GPU passed that point.
    pub fn signal(&mut self, queue: &wgpu::Queue, done: impl FnOnce(Instant) + Send + 'static) {
        self.value += 1;
        // SAFETY: Signal on the wgpu queue is ordered after its prior ExecuteCommandLists.
        let ok = unsafe {
            queue
                .as_hal::<wgpu::hal::api::Dx12>()
                .is_some_and(|hal| hal.as_raw().Signal(&self.fence.0, self.value).is_ok())
        };
        if ok {
            let _ = self.tx.send((self.value, Box::new(done)));
        } else {
            done(Instant::now());
        }
    }
}
