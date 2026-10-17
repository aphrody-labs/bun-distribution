use std::time::Instant;
fn main() {
    let t: usize = std::env::args()
        .nth(1)
        .map(|s| s.parse().unwrap())
        .unwrap_or(512);
    let threads: usize = std::env::args()
        .nth(2)
        .map(|s| s.parse().unwrap())
        .unwrap_or(1);
    let (inp, out) = (384usize, 1536usize);
    let x: Vec<f32> = (0..t * inp)
        .map(|i| ((i * 7919) % 1000) as f32 / 1000.0 - 0.5)
        .collect();
    let w: Vec<f32> = (0..out * inp)
        .map(|i| ((i * 104729) % 1000) as f32 / 1000.0 - 0.5)
        .collect();
    let mut y = vec![0f32; t * out];
    let par = if threads > 1 {
        gemm::Parallelism::Rayon(threads)
    } else {
        gemm::Parallelism::None
    };
    for _ in 0..3 {
        unsafe {
            gemm::gemm(
                t,
                out,
                inp,
                y.as_mut_ptr(),
                1,
                out as isize,
                false,
                x.as_ptr(),
                1,
                inp as isize,
                w.as_ptr(),
                inp as isize,
                1,
                0.0,
                1.0,
                false,
                false,
                false,
                par,
            );
        }
    }
    let iters = 30;
    let s = Instant::now();
    for _ in 0..iters {
        unsafe {
            gemm::gemm(
                t,
                out,
                inp,
                y.as_mut_ptr(),
                1,
                out as isize,
                false,
                x.as_ptr(),
                1,
                inp as isize,
                w.as_ptr(),
                inp as isize,
                1,
                0.0,
                1.0,
                false,
                false,
                false,
                par,
            );
        }
    }
    let dt = s.elapsed().as_secs_f64() / iters as f64;
    let muladds = (t * inp * out) as f64;
    println!(
        "T={t} threads={threads}: {:.2} ms/call, {:.1} G mul-adds/s",
        dt * 1e3,
        muladds / dt / 1e9
    );
    let naive: f32 = (0..out)
        .map(|o| (0..inp).map(|i| x[i] * w[o * inp + i]).sum::<f32>() - y[o])
        .map(f32::abs)
        .sum();
    println!("check err {naive}");
}
