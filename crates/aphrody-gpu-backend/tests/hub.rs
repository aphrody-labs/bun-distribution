// SPDX-License-Identifier: Apache-2.0
//! Hub behaviour on whatever adapter the machine offers (llvmpipe/lavapipe in CI). Tests that
//! need a device skip with a message when the machine has none.
#![cfg(feature = "hub")]

use aphrody_gpu_backend::hub::{self, HubError, WgslJob};

const DOUBLE: &str = "
@group(0) @binding(0) var<storage, read_write> data: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < arrayLength(&data)) {
        data[id.x] = data[id.x] * 2u + 1u;
    }
}
";

fn has_device() -> bool {
    let report = hub::report();
    if report.selected.is_none() {
        eprintln!("skipping: no GPU adapter ({:?})", report.error);
        return false;
    }
    true
}

fn words(bytes: &[u8]) -> Vec<u32> {
    let (chunks, rest) = bytes.as_chunks::<4>();
    assert!(rest.is_empty());
    chunks
        .iter()
        .map(|chunk| u32::from_le_bytes(*chunk))
        .collect()
}

#[test]
fn report_lists_the_selected_adapter() {
    let report = hub::report();
    let json = serde_json::to_value(&report).unwrap();
    assert!(
        json.get("adapters")
            .is_some_and(serde_json::Value::is_array)
    );
    if let Some(selected) = &report.selected {
        assert!(report.adapters.iter().any(|a| a.name == selected.name));
        assert!(report.limits.is_some());
        assert!(report.error.is_none());
    }
}

#[test]
fn wgsl_job_runs_on_the_shared_device() {
    if !has_device() {
        return;
    }
    let input: Vec<u32> = (0..1000).collect();
    let bytes: Vec<u8> = input.iter().flat_map(|v| v.to_le_bytes()).collect();
    let output = hub::run_wgsl(WgslJob {
        shader: DOUBLE,
        entry_point: "main",
        workgroups: [1000_u32.div_ceil(64), 1, 1],
        data: &bytes,
    })
    .unwrap();
    let expected: Vec<u32> = input.iter().map(|v| v * 2 + 1).collect();
    assert_eq!(words(&output), expected);

    // The device is shared: a second job reuses it.
    let again = hub::run_wgsl(WgslJob {
        shader: DOUBLE,
        entry_point: "main",
        workgroups: [1, 1, 1],
        data: &output[..16],
    })
    .unwrap();
    assert_eq!(words(&again), vec![3, 7, 11, 15]);
}

#[test]
fn invalid_shader_is_an_error_not_a_panic() {
    if !has_device() {
        return;
    }
    let result = hub::run_wgsl(WgslJob {
        shader: "this is not wgsl",
        entry_point: "main",
        workgroups: [1, 1, 1],
        data: &[0; 4],
    });
    assert!(matches!(result, Err(HubError::Gpu(_))), "{result:?}");

    let missing_entry = hub::run_wgsl(WgslJob {
        shader: DOUBLE,
        entry_point: "nope",
        workgroups: [1, 1, 1],
        data: &[0; 4],
    });
    assert!(
        matches!(missing_entry, Err(HubError::Gpu(_))),
        "{missing_entry:?}"
    );

    // The device still works after both errors.
    let ok = hub::run_wgsl(WgslJob {
        shader: DOUBLE,
        entry_point: "main",
        workgroups: [1, 1, 1],
        data: &[1, 0, 0, 0],
    });
    assert_eq!(words(&ok.unwrap()), vec![3]);
}

#[test]
fn job_bounds_are_checked_before_touching_the_gpu() {
    if !has_device() {
        return;
    }
    let job = |data: &'static [u8], workgroups| WgslJob {
        shader: DOUBLE,
        entry_point: "main",
        workgroups,
        data,
    };
    assert!(matches!(
        hub::run_wgsl(job(&[], [1, 1, 1])),
        Err(HubError::InvalidJob(_))
    ));
    assert!(matches!(
        hub::run_wgsl(job(&[0, 0, 0], [1, 1, 1])),
        Err(HubError::InvalidJob(_))
    ));
    assert!(matches!(
        hub::run_wgsl(job(&[0; 4], [0, 1, 1])),
        Err(HubError::InvalidJob(_))
    ));
    assert!(matches!(
        hub::run_wgsl(job(&[0; 4], [u32::MAX, 1, 1])),
        Err(HubError::InvalidJob(_))
    ));
}

#[cfg(feature = "cuda")]
#[test]
fn cuda_reports_its_state_without_panicking() {
    use aphrody_gpu_backend::cuda::{self, CudaJob};

    let report = cuda::report();
    assert_eq!(
        hub::report().cuda.as_ref().map(|r| r.driver_loaded),
        Some(report.driver_loaded)
    );
    let job = CudaJob {
        source: r#"extern "C" __global__ void twice(float *data, unsigned int n) {
            unsigned int i = blockIdx.x * blockDim.x + threadIdx.x;
            if (i < n) data[i] = data[i] * 2.0f;
        }"#,
        kernel: "twice",
        data: &[1.0, 2.0, 3.5],
        block_size: 0,
    };
    if report.devices.is_empty() {
        assert!(report.error.is_some() || !report.driver_loaded);
        assert!(matches!(cuda::run_cuda(job), Err(HubError::Cuda(_))));
    } else {
        assert_eq!(cuda::run_cuda(job).unwrap(), vec![2.0, 4.0, 7.0]);
    }
    assert!(matches!(
        cuda::run_cuda(CudaJob {
            kernel: "bad name",
            ..job
        }),
        Err(HubError::InvalidJob(_))
    ));
}

#[test]
fn concurrent_hosts_share_the_device() {
    if !has_device() {
        return;
    }
    let workers: Vec<_> = (0..8_u32)
        .map(|seed| {
            std::thread::spawn(move || {
                let shader = if seed % 3 == 0 { "broken" } else { DOUBLE };
                let data: Vec<u8> = (seed..seed + 64).flat_map(u32::to_le_bytes).collect();
                let result = hub::run_wgsl(WgslJob {
                    shader,
                    entry_point: "main",
                    workgroups: [1, 1, 1],
                    data: &data,
                });
                (seed, result)
            })
        })
        .collect();
    for worker in workers {
        let (seed, result) = worker.join().expect("worker panicked");
        if seed % 3 == 0 {
            assert!(matches!(result, Err(HubError::Gpu(_))));
        } else {
            let expected: Vec<u32> = (seed..seed + 64).map(|v| v * 2 + 1).collect();
            assert_eq!(words(&result.unwrap()), expected);
        }
    }
}
