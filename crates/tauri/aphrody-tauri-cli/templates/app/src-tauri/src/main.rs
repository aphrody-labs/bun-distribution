// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// CEF runs the renderer, GPU and utility processes from this same executable: the entry point
// hands those processes to Chromium before the application starts.
#[tauri_runtime_cef::cef_entry_point]
fn main() {
  app_lib::run();
}
