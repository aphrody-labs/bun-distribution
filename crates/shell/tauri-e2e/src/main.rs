// SPDX-License-Identifier: Apache-2.0
//! Real-webview end-to-end host. `frontend/` is assembled by `scripts/build/shell/tauri-e2e.sh`;
//! the page reports its result through `report`, which prints it and exits.

#[tauri::command]
fn report(text: String) {
    println!("E2E_RESULT:{text}");
    std::process::exit(0);
}

fn main() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(aphrody_shell_tauri::init())
        .on_page_load(|_, payload| eprintln!("page {:?} {}", payload.event(), payload.url()))
        .invoke_handler(tauri::generate_handler![report])
        .run(tauri::generate_context!())
        .expect("run shell e2e app");
}
