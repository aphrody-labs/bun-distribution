// SPDX-License-Identifier: Apache-2.0
//! Frame-time benchmarks for both render lanes. Run with:
//!
//! ```sh
//! cargo bench -p aphrody-render --bench frame                 # CPU only
//! cargo bench -p aphrody-render --bench frame --features gpu  # CPU + GPU
//! ```
//!
//! - 2D: a dashboard-like scene of ~500 M3 elements at 1080p.
//! - 3D: the M3 showcase (shadows, MSAA 4x, transparency) at 1080p, and a 1024-instance grid
//!   exercising instanced batching.
//!
//! GPU timings are skipped (not registered) when no adapter is available.

use aphrody_render::{
    fixtures::{dashboard_scene, instanced_grid_scene3d, showcase_scene3d},
    raster::render_scene,
    raster3d::render_prepared,
};
use criterion::{Criterion, criterion_group, criterion_main};

fn bench_cpu_1080p_dashboard(c: &mut Criterion) {
    let scene = dashboard_scene(1920, 1080, 500);
    c.bench_function("cpu_render_1080p_dashboard_500", |b| {
        b.iter(|| render_scene(std::hint::black_box(&scene)));
    });
}

fn bench_cpu_3d(c: &mut Criterion) {
    let showcase = showcase_scene3d(1920, 1080);
    let prepared = showcase.prepare().expect("valid showcase");
    c.bench_function("cpu3d_prepare_showcase", |b| {
        b.iter(|| std::hint::black_box(&showcase).prepare().expect("valid"));
    });
    c.bench_function("cpu3d_render_1080p_showcase_msaa4", |b| {
        b.iter(|| render_prepared(std::hint::black_box(&prepared)));
    });
    let grid = instanced_grid_scene3d(1920, 1080, 1024).prepare().expect("valid grid");
    c.bench_function("cpu3d_render_1080p_grid_1024", |b| {
        b.iter(|| render_prepared(std::hint::black_box(&grid)));
    });
}

#[cfg(feature = "gpu")]
fn bench_gpu(c: &mut Criterion) {
    use aphrody_render::{gpu::render_scene_gpu, gpu3d::Renderer3d};

    let scene = dashboard_scene(1920, 1080, 500);
    match render_scene_gpu(&scene) {
        Ok(frame) => {
            eprintln!("gpu adapter: {} ({})", frame.adapter.name, frame.adapter.backend);
            c.bench_function("gpu_render_1080p_dashboard_500", |b| {
                b.iter(|| render_scene_gpu(std::hint::black_box(&scene)).expect("gpu render"));
            });
        },
        Err(err) => eprintln!("skipping 2D gpu benchmark: {err}"),
    }

    let mut renderer = match Renderer3d::new() {
        Ok(renderer) => renderer,
        Err(err) => {
            eprintln!("skipping 3D gpu benchmarks: {err}");
            return;
        },
    };
    let showcase = showcase_scene3d(1920, 1080);
    let prepared = showcase.prepare().expect("valid showcase");
    c.bench_function("gpu3d_render_1080p_showcase_msaa4", |b| {
        b.iter(|| renderer.render_prepared(std::hint::black_box(&prepared)).expect("render"));
    });
    let grid = instanced_grid_scene3d(1920, 1080, 1024).prepare().expect("valid grid");
    c.bench_function("gpu3d_render_1080p_grid_1024", |b| {
        b.iter(|| renderer.render_prepared(std::hint::black_box(&grid)).expect("render"));
    });
}

#[cfg(feature = "gpu")]
criterion_group!(benches, bench_cpu_1080p_dashboard, bench_cpu_3d, bench_gpu);
#[cfg(not(feature = "gpu"))]
criterion_group!(benches, bench_cpu_1080p_dashboard, bench_cpu_3d);
criterion_main!(benches);
