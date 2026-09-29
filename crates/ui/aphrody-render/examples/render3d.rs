// SPDX-License-Identifier: Apache-2.0
//! Render a 3D scene to PNG with every available backend and report timings.
//!
//! ```sh
//! cargo run -p aphrody-render --release --example render3d -- [scene.json] [out-dir]
//! cargo run -p aphrody-render --release --features gpu --example render3d
//! ```
//!
//! Without a scene file the M3 showcase fixture (1280x800) is rendered.

use std::{path::PathBuf, time::Instant};

use aphrody_render::{
    fixtures::showcase_scene3d, raster::encode_png, raster3d::render_prepared, scene3d::Scene3d,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let scene: Scene3d = match args.next().filter(|a| a != "-") {
        Some(path) => serde_json::from_str(&std::fs::read_to_string(path)?)?,
        None => showcase_scene3d(1280, 800),
    };
    let out_dir = PathBuf::from(args.next().unwrap_or_else(|| ".".into()));
    std::fs::create_dir_all(&out_dir)?;
    // The exact scene, for the browser lane (`md-3d-scene src=...`).
    std::fs::write(out_dir.join("render3d-scene.json"), serde_json::to_vec_pretty(&scene)?)?;

    let start = Instant::now();
    let prepared = scene.prepare()?;
    let prepare_ms = start.elapsed().as_secs_f64() * 1e3;
    println!(
        "prepared {}x{} x{} in {prepare_ms:.2} ms: {} instances, {} batches, {} meshes, {} \
         triangles, {} culled",
        prepared.width,
        prepared.height,
        prepared.samples,
        prepared.instances.len(),
        prepared.batches.len(),
        prepared.meshes.len(),
        prepared.triangle_count(),
        prepared.culled
    );

    let start = Instant::now();
    let cpu = render_prepared(&prepared);
    println!("cpu: {:.2} ms", start.elapsed().as_secs_f64() * 1e3);
    let cpu_path = out_dir.join("render3d-cpu.png");
    std::fs::write(&cpu_path, encode_png(cpu.width, cpu.height, &cpu.pixels)?)?;
    println!("wrote {}", cpu_path.display());

    #[cfg(feature = "gpu")]
    {
        use aphrody_render::gpu3d::Renderer3d;
        match Renderer3d::new() {
            Ok(mut renderer) => {
                let first = Instant::now();
                let frame = renderer.render(&scene)?;
                let first_ms = first.elapsed().as_secs_f64() * 1e3;
                let warm = Instant::now();
                let frames = 10;
                for _ in 0..frames {
                    renderer.render(&scene)?;
                }
                let warm_ms = warm.elapsed().as_secs_f64() * 1e3 / f64::from(frames);
                println!(
                    "gpu ({} / {}): first {first_ms:.2} ms, warm {warm_ms:.2} ms/frame",
                    frame.adapter.name, frame.adapter.backend
                );
                let gpu_path = out_dir.join("render3d-gpu.png");
                std::fs::write(&gpu_path, encode_png(frame.width, frame.height, &frame.rgba)?)?;
                println!("wrote {}", gpu_path.display());
            },
            Err(err) => println!("gpu: skipped ({err})"),
        }
    }
    Ok(())
}
