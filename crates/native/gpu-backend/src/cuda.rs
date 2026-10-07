// SPDX-License-Identifier: Apache-2.0
//! NVIDIA CUDA through the official driver.
//!
//! `cudarc` loads `libcuda` (shipped by the NVIDIA driver, not the toolkit) and NVRTC at run time,
//! so this module builds everywhere and reports CUDA as unavailable when the driver is missing.
//! The library-presence probes run before any other call because `cudarc` panics when a library
//! it was asked to use cannot be loaded.

use std::sync::{Arc, OnceLock};

use cudarc::driver::{CudaContext, LaunchConfig, PushKernelArg, sys};
use cudarc::nvrtc;

use crate::cuda_report::{CudaDeviceReport, CudaReport};
use crate::hub::{HubError, MAX_JOB_BYTES};

/// Largest number of `f32` values a single CUDA job may process.
pub const MAX_JOB_ELEMENTS: usize = MAX_JOB_BYTES / 4;

fn driver_present() -> bool {
    // SAFETY: only probes whether the library can be opened; no symbol is called.
    unsafe { sys::is_culib_present() }
}

fn nvrtc_present() -> bool {
    // SAFETY: only probes whether the library can be opened; no symbol is called.
    unsafe { nvrtc::sys::is_culib_present() }
}

fn driver_version() -> Result<i32, HubError> {
    let mut version = 0;
    // SAFETY: the driver library is present (checked by callers) and `version` is a valid pointer.
    let status = unsafe { sys::cuDriverGetVersion(&raw mut version) };
    if status == sys::CUresult::CUDA_SUCCESS {
        Ok(version)
    } else {
        Err(HubError::Cuda(format!("cuDriverGetVersion: {status:?}")))
    }
}

fn format_version(version: i32) -> String {
    format!("{}.{}", version / 1000, (version % 1000) / 10)
}

/// Context of device 0, created on first use and shared by the whole process.
fn context() -> Result<Arc<CudaContext>, HubError> {
    static CONTEXT: OnceLock<Result<Arc<CudaContext>, HubError>> = OnceLock::new();
    CONTEXT
        .get_or_init(|| {
            if !driver_present() {
                return Err(HubError::Cuda(
                    "the NVIDIA driver library (libcuda) is not installed".into(),
                ));
            }
            CudaContext::new(0).map_err(|error| HubError::Cuda(error.to_string()))
        })
        .clone()
}

fn device_report(ordinal: usize) -> Result<CudaDeviceReport, HubError> {
    let ctx = CudaContext::new(ordinal).map_err(|error| HubError::Cuda(error.to_string()))?;
    let cuda = |error: cudarc::driver::DriverError| HubError::Cuda(error.to_string());
    let (major, minor) = ctx.compute_capability().map_err(cuda)?;
    Ok(CudaDeviceReport {
        ordinal,
        name: ctx.name().map_err(cuda)?,
        compute_capability: format!("{major}.{minor}"),
        total_memory: ctx.total_mem().map_err(cuda)? as u64,
        multiprocessors: ctx
            .attribute(sys::CUdevice_attribute::CU_DEVICE_ATTRIBUTE_MULTIPROCESSOR_COUNT)
            .map_err(cuda)? as u32,
    })
}

/// Reports the CUDA driver, NVRTC and devices visible to this process.
#[must_use]
pub fn report() -> CudaReport {
    let mut report = CudaReport {
        driver_loaded: driver_present(),
        nvrtc_loaded: nvrtc_present(),
        driver_version: None,
        devices: Vec::new(),
        error: None,
    };
    if !report.driver_loaded {
        report.error = Some("the NVIDIA driver library (libcuda) is not installed".into());
        return report;
    }
    let result = (|| -> Result<(), HubError> {
        cudarc::driver::result::init().map_err(|error| HubError::Cuda(error.to_string()))?;
        report.driver_version = Some(format_version(driver_version()?));
        let count =
            CudaContext::device_count().map_err(|error| HubError::Cuda(error.to_string()))?;
        for ordinal in 0..usize::try_from(count).unwrap_or(0) {
            report.devices.push(device_report(ordinal)?);
        }
        Ok(())
    })();
    if let Err(error) = result {
        report.error = Some(error.to_string());
    }
    report
}

/// A CUDA C kernel compiled with NVRTC and launched over one `f32` array.
///
/// The kernel must have the signature `extern "C" __global__ void name(float *data, unsigned int n)`.
#[derive(Clone, Copy, Debug)]
pub struct CudaJob<'a> {
    pub source: &'a str,
    pub kernel: &'a str,
    pub data: &'a [f32],
    /// Threads per block, `0` selects 256.
    pub block_size: u32,
}

/// Compiles and runs a CUDA job on device 0 and returns the array afterwards.
pub fn run_cuda(job: CudaJob<'_>) -> Result<Vec<f32>, HubError> {
    if job.data.is_empty() || job.data.len() > MAX_JOB_ELEMENTS {
        return Err(HubError::InvalidJob(format!("data must hold 1..={MAX_JOB_ELEMENTS} floats")));
    }
    let n = u32::try_from(job.data.len())
        .map_err(|_| HubError::InvalidJob("data is too large".into()))?;
    let block = if job.block_size == 0 { 256 } else { job.block_size };
    if !(1..=1024).contains(&block) {
        return Err(HubError::InvalidJob("blockSize must be 1..=1024".into()));
    }
    if job.kernel.is_empty() || !job.kernel.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(HubError::InvalidJob("kernel must be a C identifier".into()));
    }
    let ctx = context()?;
    if !nvrtc_present() {
        return Err(HubError::Cuda("NVRTC (libnvrtc) is not installed".into()));
    }
    let cuda = |error: cudarc::driver::DriverError| HubError::Cuda(error.to_string());
    let ptx = nvrtc::compile_ptx(job.source)
        .map_err(|error| HubError::InvalidJob(format!("NVRTC: {error}")))?;
    let module = ctx.load_module(ptx).map_err(cuda)?;
    let function = module.load_function(job.kernel).map_err(cuda)?;
    let stream = ctx.default_stream();
    let mut buffer = stream.clone_htod(job.data).map_err(cuda)?;
    let config = LaunchConfig {
        grid_dim: (n.div_ceil(block), 1, 1),
        block_dim: (block, 1, 1),
        shared_mem_bytes: 0,
    };
    let mut launch = stream.launch_builder(&function);
    launch.arg(&mut buffer).arg(&n);
    // SAFETY: the arguments match the signature `CudaJob` documents (`float *`, `unsigned int`)
    // and `buffer` holds exactly `n` floats. The kernel is caller-supplied device code: a kernel
    // that ignores that contract can only fault inside device memory, which the driver reports as
    // an error on the next stream operation.
    unsafe { launch.launch(config) }.map_err(cuda)?;
    stream.clone_dtoh(&buffer).map_err(cuda)
}
