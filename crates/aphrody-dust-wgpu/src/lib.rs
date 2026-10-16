#![feature(portable_simd)]

//! Shared Dust GPU renderers using the IECODE workspace's wgpu version.

#[path = "../2d/src/lib.rs"]
pub mod render_2d;
#[path = "../3d/src/lib.rs"]
pub mod render_3d;

pub use aphrody_gpu_backend as backend;
pub use aphrody_gpu_backend::wgpu;

pub use aphrody_gpu_backend::{
    DeviceLimits, DeviceRequest, GpuDevice, SurfaceFormat, SurfaceRequest, create_instance,
    enumerate_adapters, request_adapter, request_device, surface_configuration,
};
