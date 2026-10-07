// SPDX-License-Identifier: Apache-2.0
//! CUDA status types, present in every hub build so hosts parse one report shape.

use serde::Serialize;

/// One CUDA device as reported by the driver.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CudaDeviceReport {
    pub ordinal: usize,
    pub name: String,
    pub compute_capability: String,
    pub total_memory: u64,
    pub multiprocessors: u32,
}

/// CUDA driver, NVRTC and device status.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CudaReport {
    /// `libcuda` from the NVIDIA driver could be loaded.
    pub driver_loaded: bool,
    /// `libnvrtc` could be loaded, so CUDA C kernels can be compiled at run time.
    pub nvrtc_loaded: bool,
    /// Highest CUDA version the driver supports, such as `13.0`.
    pub driver_version: Option<String>,
    pub devices: Vec<CudaDeviceReport>,
    pub error: Option<String>,
}

/// CUDA status, or `None` when the crate was built without the `cuda` feature.
#[must_use]
pub fn report() -> Option<CudaReport> {
    #[cfg(feature = "cuda")]
    {
        Some(crate::cuda::report())
    }
    #[cfg(not(feature = "cuda"))]
    {
        None
    }
}
