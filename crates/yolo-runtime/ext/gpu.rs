// SPDX-License-Identifier: Apache-2.0
//! Optional GPU provider (ABI 1.5). Every host in the process (Bun through this ABI, Obscura
//! and Tauri through `aphrody-gpu-backend`) shares the one device of the process-wide hub.
//! Jobs run on bounded runtime workers; only JSON, caller-owned input bytes (copied before the
//! call returns) and library-owned buffers cross the C ABI.

use super::*;
use std::time::Instant;

use aphrody_gpu_backend::hub::{self, HubError, WgslJob};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::json;

const MAX_COMMAND_BYTES: usize = 1024 * 1024;
/// Data a single call may pass in and get back. The result is base64 inside the JSON result.
pub const MAX_GPU_DATA_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum GpuCommand {
  /// Adapters, selected device, limits and CUDA status. A struct variant so that
  /// `deny_unknown_fields` also rejects extra keys on `{"op":"info"}`.
  Info {},
  /// WGSL compute over one read-write storage buffer initialised with the call's data.
  #[serde(rename_all = "camelCase")]
  Wgsl {
    shader: String,
    #[serde(default = "default_entry_point")]
    entry_point: String,
    workgroups: [u32; 3],
  },
  /// CUDA C kernel `extern "C" __global__ void k(float *data, unsigned int n)` over the call's
  /// data read as little-endian `f32`.
  #[serde(rename_all = "camelCase")]
  Cuda {
    source: String,
    kernel: String,
    #[serde(default)]
    block_size: u32,
  },
}

fn default_entry_point() -> String {
  "main".to_string()
}

fn status_of(error: &HubError) -> YoloStatus {
  match error {
    HubError::InvalidJob(_) => YoloStatus::InvalidArgument,
    _ => YoloStatus::Internal,
  }
}

fn data_result(bytes: &[u8], started: Instant) -> OpResult {
  OpResult::Done(
    json!({
      "bytes": bytes.len(),
      "data": STANDARD.encode(bytes),
      "elapsedMs": started.elapsed().as_secs_f64() * 1000.0,
    })
    .to_string(),
  )
}

fn execute(command: GpuCommand, data: Vec<u8>) -> OpResult {
  let started = Instant::now();
  let failed = |error: HubError| OpResult::Failed(error.to_string());
  match command {
    GpuCommand::Info {} => match serde_json::to_string(&hub::report()) {
      Ok(report) => OpResult::Done(report),
      Err(error) => OpResult::Failed(error.to_string()),
    },
    GpuCommand::Wgsl {
      shader,
      entry_point,
      workgroups,
    } => match hub::run_wgsl(WgslJob {
      shader: &shader,
      entry_point: &entry_point,
      workgroups,
      data: &data,
    }) {
      Ok(bytes) => data_result(&bytes, started),
      Err(error) => failed(error),
    },
    GpuCommand::Cuda {
      source,
      kernel,
      block_size,
    } => run_cuda(&source, &kernel, block_size, &data, started),
  }
}

#[cfg(feature = "cuda")]
fn run_cuda(source: &str, kernel: &str, block_size: u32, data: &[u8], started: Instant) -> OpResult {
  use aphrody_gpu_backend::cuda::{CudaJob, run_cuda};

  let (chunks, rest) = data.as_chunks::<4>();
  if !rest.is_empty() {
    return OpResult::Failed("CUDA data must be a whole number of f32 values".to_string());
  }
  let floats: Vec<f32> = chunks.iter().map(|chunk| f32::from_le_bytes(*chunk)).collect();
  match run_cuda(CudaJob {
    source,
    kernel,
    data: &floats,
    block_size,
  }) {
    Ok(values) => {
      let bytes: Vec<u8> = values.iter().flat_map(|value| value.to_le_bytes()).collect();
      data_result(&bytes, started)
    }
    Err(error) => OpResult::Failed(error.to_string()),
  }
}

#[cfg(not(feature = "cuda"))]
fn run_cuda(_: &str, _: &str, _: u32, _: &[u8], _: Instant) -> OpResult {
  OpResult::Failed("this runtime was built without the gpu.cuda capability".to_string())
}

/// Validates what can be checked without the GPU so bad calls fail synchronously.
fn validate(command: &GpuCommand, data_len: usize) -> Result<(), HubError> {
  match command {
    GpuCommand::Info {} if data_len != 0 => {
      Err(HubError::InvalidJob("info takes no data".to_string()))
    }
    GpuCommand::Wgsl { workgroups, .. } if workgroups.contains(&0) => {
      Err(HubError::InvalidJob("workgroup counts must be at least 1".to_string()))
    }
    GpuCommand::Wgsl { .. } | GpuCommand::Cuda { .. } if data_len == 0 => {
      Err(HubError::InvalidJob("compute jobs need data".to_string()))
    }
    _ => Ok(()),
  }
}

/// Starts one GPU call (`gpu.info`, `gpu.wgsl`, `gpu.cuda`) on a bounded runtime worker.
/// `input` is a UTF-8 JSON command of `input_len` bytes; `data`/`data_len` is the job buffer and
/// may be null with length zero. Both are copied before this function returns. The operation
/// yields the JSON report for `info`, or `{"bytes", "data" (base64), "elapsedMs"}` for jobs.
///
/// # Safety
/// `input` must point to `input_len` readable bytes, `data` to `data_len` readable bytes (or be
/// null with `data_len == 0`), and `out_operation` to writable handle storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_gpu_call_start(
  runtime: YoloHandle,
  input: *const u8,
  input_len: usize,
  data: *const u8,
  data_len: usize,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out_operation.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null GPU operation output handle");
    }
    if input.is_null() || input_len == 0 || input_len > MAX_COMMAND_BYTES {
      return set_error(
        YoloStatus::InvalidArgument,
        "GPU JSON command must contain 1 byte..1 MiB",
      );
    }
    if data_len > MAX_GPU_DATA_BYTES || (data.is_null() && data_len != 0) {
      return set_error(
        YoloStatus::InvalidArgument,
        "GPU data must be 0..16 MiB from a non-null pointer",
      );
    }
    // SAFETY: input points to input_len readable bytes by the caller's contract.
    let command_bytes = unsafe { std::slice::from_raw_parts(input, input_len) };
    let command: GpuCommand = match serde_json::from_slice(command_bytes) {
      Ok(command) => command,
      Err(error) => {
        return set_error(
          YoloStatus::InvalidArgument,
          format!("invalid GPU command: {error}"),
        );
      }
    };
    if let Err(error) = validate(&command, data_len) {
      return set_error(status_of(&error), error.to_string());
    }
    let owned = if data_len == 0 {
      Vec::new()
    } else {
      // SAFETY: data points to data_len readable bytes by the caller's contract.
      unsafe { std::slice::from_raw_parts(data, data_len) }.to_vec()
    };
    // GPU work cannot be interrupted midway; cancellation is observed before it starts.
    match start_operation(runtime, "gpu", true, move |cancel| {
      if cancel.load(Ordering::Relaxed) {
        OpResult::Cancelled
      } else {
        execute(command, owned)
      }
    }) {
      Ok(operation) => {
        // SAFETY: out_operation is non-null and writable by the caller's contract.
        unsafe { out_operation.write(operation) };
        YoloStatus::Ok
      }
      Err(status) => status,
    }
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::ptr;

  fn runtime() -> YoloHandle {
    let info = YoloCreateInfo {
      struct_size: std::mem::size_of::<YoloCreateInfo>() as u32,
      abi_major: ABI_MAJOR,
      abi_minor: ABI_MINOR,
      max_operations: 4,
    };
    let mut handle = 0;
    assert_eq!(unsafe { yolo_runtime_create(&info, &mut handle) }, YoloStatus::Ok);
    handle
  }

  fn call(runtime: YoloHandle, command: &str, data: &[u8]) -> Result<serde_json::Value, YoloStatus> {
    let mut operation = 0;
    let status = unsafe {
      yolo_gpu_call_start(
        runtime,
        command.as_ptr(),
        command.len(),
        if data.is_empty() { ptr::null() } else { data.as_ptr() },
        data.len(),
        &mut operation,
      )
    };
    if status != YoloStatus::Ok {
      return Err(status);
    }
    let mut out = YoloBuffer {
      data: ptr::null_mut(),
      len: 0,
      cap: 0,
    };
    let status = unsafe { yolo_operation_wait(operation, 60_000, &mut out) };
    let value = if status == YoloStatus::Ok {
      // SAFETY: the library returned `len` readable bytes.
      let bytes = unsafe { std::slice::from_raw_parts(out.data, out.len) };
      Ok(serde_json::from_slice(bytes).unwrap())
    } else {
      Err(status)
    };
    unsafe { yolo_buffer_free(&mut out) };
    assert_eq!(yolo_operation_release(operation), YoloStatus::Ok);
    value
  }

  #[test]
  fn info_and_wgsl_share_the_process_device() {
    let rt = runtime();
    let info = call(rt, r#"{"op":"info"}"#, &[]).unwrap();
    assert!(info["adapters"].is_array());
    if info["selected"].is_null() {
      eprintln!("skipping WGSL: no GPU adapter");
    } else {
      let shader = "@group(0) @binding(0) var<storage, read_write> d: array<f32>;\
        @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) i: vec3<u32>) { d[i.x] = d[i.x] + 0.5; }";
      let command = json!({"op": "wgsl", "shader": shader, "workgroups": [1, 1, 1]}).to_string();
      let data: Vec<u8> = [1.0_f32, 2.0, 3.0, 4.0].iter().flat_map(|v| v.to_le_bytes()).collect();
      let result = call(rt, &command, &data).unwrap();
      let bytes = STANDARD.decode(result["data"].as_str().unwrap()).unwrap();
      let (chunks, _) = bytes.as_chunks::<4>();
      let values: Vec<f32> = chunks.iter().map(|c| f32::from_le_bytes(*c)).collect();
      assert_eq!(values, vec![1.5, 2.5, 3.5, 4.5]);
    }
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
  }

  #[test]
  fn invalid_calls_fail_synchronously() {
    let rt = runtime();
    assert_eq!(call(rt, "not json", &[]), Err(YoloStatus::InvalidArgument));
    assert_eq!(call(rt, r#"{"op":"info","x":1}"#, &[]), Err(YoloStatus::InvalidArgument));
    assert_eq!(call(rt, r#"{"op":"info"}"#, &[1]), Err(YoloStatus::InvalidArgument));
    assert_eq!(
      call(rt, r#"{"op":"wgsl","shader":"","workgroups":[0,1,1]}"#, &[0; 4]),
      Err(YoloStatus::InvalidArgument)
    );
    assert_eq!(
      call(rt, r#"{"op":"wgsl","shader":"","workgroups":[1,1,1]}"#, &[]),
      Err(YoloStatus::InvalidArgument)
    );
    let mut operation = 0;
    let status = unsafe { yolo_gpu_call_start(rt, ptr::null(), 0, ptr::null(), 0, &mut operation) };
    assert_eq!(status, YoloStatus::InvalidArgument);
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
  }

  #[test]
  fn gpu_failures_become_failed_operations() {
    let rt = runtime();
    if call(rt, r#"{"op":"info"}"#, &[]).unwrap()["selected"].is_null() {
      return;
    }
    let command = json!({"op": "wgsl", "shader": "broken", "workgroups": [1, 1, 1]}).to_string();
    assert_eq!(call(rt, &command, &[0; 4]), Err(YoloStatus::Internal));
    let cuda = json!({"op": "cuda", "source": "", "kernel": "k"}).to_string();
    // Without an NVIDIA driver (or without the cuda feature) the operation fails cleanly.
    if !cfg!(feature = "cuda") {
      assert_eq!(call(rt, &cuda, &[0; 4]), Err(YoloStatus::Internal));
    }
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
  }
}
