// Tauri 3 Native IPC backend for YOLO Desktop
pub mod runtime_host;
use yolo_core::{BenchmarkResult, SystemStats, compute_benchmark, current_system_stats};

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {}! You've been greeted from Rust (Tauri 3)!", name)
}

#[tauri::command]
fn get_system_stats() -> SystemStats {
  current_system_stats()
}

#[tauri::command]
fn run_benchmark(iterations: u32) -> BenchmarkResult {
  compute_benchmark(iterations)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      greet,
      get_system_stats,
      run_benchmark
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
