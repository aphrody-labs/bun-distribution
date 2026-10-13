#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri_runtime_cef::cef_entry_point]
fn main() {
    if let Err(error) = tauri::Builder::default()
        .runtime(tauri_runtime_cef::Cef::default())
        .plugin(tauri_plugin_aphrody::init())
        .run(tauri::generate_context!())
    {
        eprintln!("Aphrody: {error}");
        std::process::exit(1);
    }
}
