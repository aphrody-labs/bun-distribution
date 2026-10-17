// SPDX-License-Identifier: Apache-2.0
//! Process-wide GPU hub.
//!
//! One wgpu instance, adapter and device per process, created on first use and shared by every
//! host living in that process: Bun through the `yolo_gpu_*` C ABI, Obscura and Tauri through
//! this crate. When the `cuda` feature is enabled the hub also owns the CUDA side (see
//! [`crate::cuda`]), so a single process reports and schedules both APIs.
//!
//! Adapter policy: an NVIDIA discrete GPU first, then any discrete GPU, then wgpu's
//! high-performance choice (which may be a software adapter such as llvmpipe). Callers can see
//! which one was picked in [`GpuReport::selected`].
//!
//! Errors never panic the process: the device's uncaptured-error handler records the message
//! and every job runs inside validation and out-of-memory error scopes.

use std::fmt;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

use crate::{DeviceLimits, DeviceRequest, GpuDevice, create_instance, request_device};

/// PCI vendor identifier of NVIDIA.
pub const NVIDIA_VENDOR_ID: u32 = 0x10de;
/// Largest storage buffer a single compute job may read and write.
pub const MAX_JOB_BYTES: usize = 64 * 1024 * 1024;

/// Error returned by hub operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HubError {
    /// No adapter could be created on this machine.
    NoAdapter(String),
    /// The adapter refused to create a device.
    Device(String),
    /// The job description is invalid.
    InvalidJob(String),
    /// The GPU reported a validation or out-of-memory error while running the job.
    Gpu(String),
    /// CUDA is not available or failed.
    Cuda(String),
}

impl fmt::Display for HubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoAdapter(m) => write!(f, "no GPU adapter: {m}"),
            Self::Device(m) => write!(f, "GPU device creation failed: {m}"),
            Self::InvalidJob(m) => write!(f, "invalid GPU job: {m}"),
            Self::Gpu(m) => write!(f, "GPU error: {m}"),
            Self::Cuda(m) => write!(f, "CUDA error: {m}"),
        }
    }
}

impl std::error::Error for HubError {}

/// Description of one adapter, as reported by its driver.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReport {
    pub name: String,
    pub vendor: u32,
    pub device: u32,
    pub device_type: String,
    pub backend: String,
    pub driver: String,
    pub driver_info: String,
    pub nvidia: bool,
}

impl AdapterReport {
    fn new(info: &wgpu::AdapterInfo) -> Self {
        Self {
            name: info.name.clone(),
            vendor: info.vendor,
            device: info.device,
            device_type: format!("{:?}", info.device_type),
            backend: format!("{:?}", info.backend),
            driver: info.driver.clone(),
            driver_info: info.driver_info.clone(),
            nvidia: info.vendor == NVIDIA_VENDOR_ID,
        }
    }
}

/// Limits of the selected device that matter to compute callers.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeLimits {
    pub max_storage_buffer_binding_size: u64,
    pub max_compute_workgroups_per_dimension: u32,
    pub max_compute_invocations_per_workgroup: u32,
    pub max_buffer_size: u64,
}

/// State of the hub, serialized for every host.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuReport {
    /// Every adapter wgpu can see, in enumeration order.
    pub adapters: Vec<AdapterReport>,
    /// The adapter the shared device was created on.
    pub selected: Option<AdapterReport>,
    pub limits: Option<ComputeLimits>,
    /// Why the shared device is unavailable, if it is.
    pub error: Option<String>,
    /// CUDA status, `None` when the crate was built without the `cuda` feature.
    pub cuda: Option<crate::cuda_report::CudaReport>,
}

/// The shared wgpu device and the adapter it was created on.
pub struct WgpuContext {
    pub adapter: wgpu::Adapter,
    pub gpu: GpuDevice,
    uncaptured: Arc<Mutex<Option<String>>>,
    /// wgpu keeps one error-scope stack per device in this build, so hosts that push scopes on
    /// the shared device must hold this lock from the push to the matching pop.
    scope_lock: Mutex<()>,
}

impl WgpuContext {
    /// Serializes error-scope sections on the shared device. Hold the guard from
    /// `push_error_scope` until the matching `pop`; GPU execution itself need not be held.
    pub fn error_scope_lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.scope_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Takes the last error the device reported outside of an error scope, if any.
    pub fn take_uncaptured_error(&self) -> Option<String> {
        self.uncaptured.lock().ok().and_then(|mut slot| slot.take())
    }
}

struct Hub {
    adapters: Vec<AdapterReport>,
    context: Result<WgpuContext, HubError>,
}

fn hub() -> &'static Hub {
    static HUB: OnceLock<Hub> = OnceLock::new();
    HUB.get_or_init(Hub::create)
}

impl Hub {
    fn create() -> Self {
        let instance = create_instance(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapters =
            pollster::block_on(crate::enumerate_adapters(&instance, wgpu::Backends::all()));
        let reports = adapters
            .iter()
            .map(|adapter| AdapterReport::new(&adapter.get_info()))
            .collect();
        let context = Self::select(&instance, adapters).and_then(Self::open);
        Self {
            adapters: reports,
            context,
        }
    }

    fn select(
        instance: &wgpu::Instance,
        adapters: Vec<wgpu::Adapter>,
    ) -> Result<wgpu::Adapter, HubError> {
        let rank = |adapter: &wgpu::Adapter| {
            let info = adapter.get_info();
            let discrete = info.device_type == wgpu::DeviceType::DiscreteGpu;
            let nvidia = info.vendor == NVIDIA_VENDOR_ID;
            let device_rank = match (discrete, nvidia) {
                (true, true) => 0,
                (true, false) => 1,
                _ => 2,
            };
            let backend_rank =
                u8::from(cfg!(target_os = "windows") && info.backend != wgpu::Backend::Dx12);
            (device_rank, backend_rank)
        };
        if let Some(best) = adapters
            .into_iter()
            .min_by_key(rank)
            .filter(|a| rank(a).0 < 2)
        {
            return Ok(best);
        }
        let options = wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        };
        pollster::block_on(crate::request_adapter(instance, &options))
            .map_err(|error| HubError::NoAdapter(error.to_string()))
    }

    fn open(adapter: wgpu::Adapter) -> Result<WgpuContext, HubError> {
        let request = DeviceRequest::new(Some("aphrody-gpu-hub"), DeviceLimits::Adapter);
        let gpu = pollster::block_on(request_device(&adapter, request))
            .map_err(|error| HubError::Device(error.to_string()))?;
        let uncaptured = Arc::new(Mutex::new(None));
        let slot = Arc::clone(&uncaptured);
        gpu.device
            .on_uncaptured_error(Arc::new(move |error: wgpu::Error| {
                if let Ok(mut slot) = slot.lock() {
                    *slot = Some(error.to_string());
                }
            }));
        Ok(WgpuContext {
            adapter,
            gpu,
            uncaptured,
            scope_lock: Mutex::new(()),
        })
    }
}

/// Returns the shared wgpu context, creating it on first use.
pub fn wgpu_context() -> Result<&'static WgpuContext, HubError> {
    hub().context.as_ref().map_err(Clone::clone)
}

/// Reports adapters, the selected device, its limits and the CUDA status.
#[must_use]
pub fn report() -> GpuReport {
    let hub = hub();
    let (selected, limits, error) = match &hub.context {
        Ok(context) => {
            let limits = context.gpu.device.limits();
            (
                Some(AdapterReport::new(&context.adapter.get_info())),
                Some(ComputeLimits {
                    max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
                    max_compute_workgroups_per_dimension: limits
                        .max_compute_workgroups_per_dimension,
                    max_compute_invocations_per_workgroup: limits
                        .max_compute_invocations_per_workgroup,
                    max_buffer_size: limits.max_buffer_size,
                }),
                None,
            )
        }
        Err(error) => (None, None, Some(error.to_string())),
    };
    GpuReport {
        adapters: hub.adapters.clone(),
        selected,
        limits,
        error,
        cuda: crate::cuda_report::report(),
    }
}

/// A WGSL compute job over one read-write storage buffer.
///
/// The shader must declare `@group(0) @binding(0) var<storage, read_write> data: array<...>;`.
/// The buffer starts with `data` and its final contents are returned.
#[derive(Clone, Copy, Debug)]
pub struct WgslJob<'a> {
    pub shader: &'a str,
    pub entry_point: &'a str,
    pub workgroups: [u32; 3],
    pub data: &'a [u8],
}

/// Runs a WGSL compute job on the shared device and returns the storage buffer afterwards.
pub fn run_wgsl(job: WgslJob<'_>) -> Result<Vec<u8>, HubError> {
    let context = wgpu_context()?;
    let device = &context.gpu.device;
    let limits = device.limits();

    let size = job.data.len();
    if size == 0 || !size.is_multiple_of(4) {
        return Err(HubError::InvalidJob(
            "data must be a non-empty multiple of 4 bytes".into(),
        ));
    }
    // The job allocates both a storage and a readback buffer. Check the binding
    // limit and whole-buffer limit before creating either resource so low-limit
    // adapters receive a stable API error rather than an uncaptured validation error.
    let binding_limit =
        usize::try_from(limits.max_storage_buffer_binding_size).unwrap_or(usize::MAX);
    let buffer_limit = usize::try_from(limits.max_buffer_size).unwrap_or(usize::MAX);
    let job_limit = MAX_JOB_BYTES.min(binding_limit).min(buffer_limit);
    if size > job_limit {
        return Err(HubError::InvalidJob(format!(
            "data is {size} bytes, the limit is {job_limit}"
        )));
    }
    let max_groups = limits.max_compute_workgroups_per_dimension;
    if job.workgroups.iter().any(|&n| n == 0 || n > max_groups) {
        return Err(HubError::InvalidJob(format!(
            "each workgroup count must be 1..={max_groups}"
        )));
    }
    if job.entry_point.is_empty() {
        return Err(HubError::InvalidJob("entry point is empty".into()));
    }

    let scopes = context.error_scope_lock();
    let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let out_of_memory = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);

    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("aphrody-gpu-hub job"),
        source: wgpu::ShaderSource::Wgsl(job.shader.into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("aphrody-gpu-hub job"),
        layout: None,
        module: &module,
        entry_point: Some(job.entry_point),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    let size64 = size as u64;
    let storage = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("aphrody-gpu-hub storage"),
        size: size64,
        usage: wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::COPY_SRC
            | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("aphrody-gpu-hub readback"),
        size: size64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    context.gpu.queue.write_buffer(&storage, 0, job.data);
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("aphrody-gpu-hub job"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: storage.as_entire_binding(),
        }],
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("aphrody-gpu-hub job"),
    });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("aphrody-gpu-hub job"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        let [x, y, z] = job.workgroups;
        pass.dispatch_workgroups(x, y, z);
    }
    encoder.copy_buffer_to_buffer(&storage, 0, &readback, 0, size64);

    let oom = pollster::block_on(out_of_memory.pop());
    let invalid = pollster::block_on(validation.pop());
    drop(scopes);
    if let Some(error) = invalid.or(oom) {
        return Err(HubError::Gpu(error.to_string()));
    }

    let submission = context.gpu.queue.submit([encoder.finish()]);
    let (sender, receiver) = std::sync::mpsc::channel();
    readback.map_async(wgpu::MapMode::Read, .., move |result| {
        let _ = sender.send(result);
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: Some(submission),
            timeout: None,
        })
        .map_err(|error| HubError::Gpu(error.to_string()))?;
    receiver
        .recv()
        .map_err(|_| HubError::Gpu("buffer mapping was dropped".into()))?
        .map_err(|error| HubError::Gpu(error.to_string()))?;
    let bytes = readback
        .get_mapped_range(..)
        .map_err(|error| HubError::Gpu(error.to_string()))?
        .to_vec();
    readback.unmap();
    if let Some(error) = context.take_uncaptured_error() {
        return Err(HubError::Gpu(error));
    }
    Ok(bytes)
}
