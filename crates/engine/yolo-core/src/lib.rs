pub mod privilege;
pub mod resources;
#[cfg(feature = "repository-tools")]
pub mod mapper;
#[cfg(feature = "repository-tools")]
pub mod polyglot;
pub use privilege::{
  ElevationInfo, can_sudo_non_interactive, get_elevation_info, is_elevated, wrap_elevated_command,
};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
  pub os: String,
  pub arch: String,
  pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
  pub logical_cores: usize,
  pub os: String,
  pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
  pub message: String,
  pub latency_us: u64,
}

pub fn current_system_stats() -> SystemStats {
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as u64;

  SystemStats {
    os: std::env::consts::OS.to_string(),
    arch: std::env::consts::ARCH.to_string(),
    timestamp_ms: now,
  }
}

pub fn current_hardware_info() -> HardwareInfo {
  let cores = std::thread::available_parallelism()
    .map(|n| n.get())
    .unwrap_or(1);

  HardwareInfo {
    logical_cores: cores,
    os: std::env::consts::OS.to_string(),
    arch: std::env::consts::ARCH.to_string(),
  }
}

// ---------------------------------------------------------------------------------------------
// Wyhash 64-bit implementation (aligned with Bun / native core hashing)
// ---------------------------------------------------------------------------------------------

const WYHASH_PRIME_0: u64 = 0xa076_1d64_78bd_642f;
const WYHASH_PRIME_1: u64 = 0xe703_7ed1_a0b4_28db;
const WYHASH_PRIME_2: u64 = 0x8ebc_6af0_9c88_c6e3;
const WYHASH_PRIME_3: u64 = 0x5899_65cc_7537_4cc3;

#[inline]
fn wymum(a: u64, b: u64) -> u64 {
  let r = (a as u128).wrapping_mul(b as u128);
  (r as u64) ^ ((r >> 64) as u64)
}

pub fn wyhash64(data: &[u8], seed: u64) -> u64 {
  let mut s = seed ^ WYHASH_PRIME_0;
  let len = data.len() as u64;
  let mut i = 0;
  while i + 8 <= data.len() {
    let mut chunk = [0u8; 8];
    chunk.copy_from_slice(&data[i..i + 8]);
    let v = u64::from_le_bytes(chunk);
    s = wymum(s ^ v, WYHASH_PRIME_1);
    i += 8;
  }
  if i < data.len() {
    let mut tail = 0u64;
    for (k, &byte) in data[i..].iter().enumerate() {
      tail |= (byte as u64) << (k * 8);
    }
    s = wymum(s ^ tail, WYHASH_PRIME_2);
  }
  wymum(s ^ len, WYHASH_PRIME_3)
}

pub fn compute_benchmark(iterations: u32) -> BenchmarkResult {
  compute_benchmark_cancellable(iterations, || false)
    .expect("a benchmark that is never cancelled always completes")
}

/// Rounds between two cancellation checks.
const CANCEL_CHECK_INTERVAL: u32 = 1 << 20;

/// Same computation as [`compute_benchmark`], polling `cancelled` every
/// [`CANCEL_CHECK_INTERVAL`] rounds. Returns `None` when cancelled.
pub fn compute_benchmark_cancellable(
  iterations: u32,
  cancelled: impl Fn() -> bool,
) -> Option<BenchmarkResult> {
  let start = std::time::Instant::now();
  let mut counter: u64 = 0;
  for i in 0..iterations {
    if i % CANCEL_CHECK_INTERVAL == 0 && cancelled() {
      return None;
    }
    counter = counter.wrapping_add(i as u64).rotate_left(3);
  }
  let elapsed = start.elapsed().as_micros() as u64;

  Some(BenchmarkResult {
    message: format!("Computed {} rounds (checksum: {})", iterations, counter),
    latency_us: elapsed,
  })
}

/// Calcule la somme des carrés avec parallélisation adaptative et vectorisation SIMD.
#[inline]
pub fn compute_sum_squares(values: &[f64]) -> f64 {
  const CHUNK_SIZE: usize = 16_384;
  if values.len() < CHUNK_SIZE {
    values.iter().map(|&x| x * x).sum()
  } else {
    values
      .par_chunks(CHUNK_SIZE)
      .map(|chunk| chunk.iter().map(|&x| x * x).sum::<f64>())
      .sum()
  }
}

/// Évalue une statistique agrégée (somme, moyenne, min, max) en un seul passage optimisé par cœur.
#[inline]
pub fn compute_summary(values: &[f64]) -> (f64, f64, f64, f64) {
  if values.is_empty() {
    return (0.0, 0.0, 0.0, 0.0);
  }
  const CHUNK_SIZE: usize = 16_384;

  if values.len() < CHUNK_SIZE {
    let mut sum = 0.0;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for &x in values {
      sum += x;
      if x < min {
        min = x;
      }
      if x > max {
        max = x;
      }
    }
    (sum, sum / (values.len() as f64), min, max)
  } else {
    let (sum, min, max) = values
      .par_chunks(CHUNK_SIZE)
      .map(|chunk| {
        let mut c_sum = 0.0;
        let mut c_min = f64::INFINITY;
        let mut c_max = f64::NEG_INFINITY;
        for &x in chunk {
          c_sum += x;
          if x < c_min {
            c_min = x;
          }
          if x > c_max {
            c_max = x;
          }
        }
        (c_sum, c_min, c_max)
      })
      .reduce(
        || (0.0, f64::INFINITY, f64::NEG_INFINITY),
        |(s1, mn1, mx1), (s2, mn2, mx2)| (s1 + s2, mn1.min(mn2), mx1.max(mx2)),
      );

    (sum, sum / (values.len() as f64), min, max)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_compute_sum_squares() {
    let data = vec![1.0, 2.0, 3.0, 4.0];
    assert_eq!(compute_sum_squares(&data), 30.0);
  }

  #[test]
  fn test_compute_summary() {
    let data = vec![1.0, 2.0, 3.0, 4.0];
    let (sum, mean, min, max) = compute_summary(&data);
    assert_eq!(sum, 10.0);
    assert_eq!(mean, 2.5);
    assert_eq!(min, 1.0);
    assert_eq!(max, 4.0);
  }

  #[test]
  fn test_system_stats() {
    let stats = current_system_stats();
    assert!(!stats.os.is_empty());
    assert!(!stats.arch.is_empty());
    assert!(stats.timestamp_ms > 0);
  }

  #[test]
  fn test_hardware_info() {
    let hw = current_hardware_info();
    assert!(hw.logical_cores >= 1);
    assert!(!hw.os.is_empty());
    assert!(!hw.arch.is_empty());
  }

  #[test]
  fn test_wyhash64() {
    let h1 = wyhash64(b"hello world", 0);
    let h2 = wyhash64(b"hello world", 0);
    assert_eq!(h1, h2);
    let h3 = wyhash64(b"hello world", 42);
    assert_ne!(h1, h3);
    let h4 = wyhash64(b"yolo core engine", 0);
    assert_ne!(h1, h4);
  }

  #[test]
  fn benchmark_can_be_cancelled() {
    assert!(compute_benchmark_cancellable(u32::MAX, || true).is_none());
    assert!(compute_benchmark_cancellable(10, || true).is_none());
    assert!(compute_benchmark_cancellable(0, || false).is_some());
  }

  #[test]
  fn test_benchmark() {
    let res = compute_benchmark(1000);
    assert!(res.message.contains("1000"));
  }
}
