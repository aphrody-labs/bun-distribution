// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// CEF runs its helper processes from this same executable (see `cef_entry_point`).
#[tauri_runtime_cef::cef_entry_point]
fn main() {
  tauri_app_lib::run();
}
