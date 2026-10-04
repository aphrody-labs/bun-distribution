// SPDX-License-Identifier: Apache-2.0

use tauri_runtime_wry::Wry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .runtime(Wry::default())
        .plugin(aphrody_tauri_wrap::init(include_str!("../wrap.json")));
    builder.run(tauri::generate_context!()).expect("error while running tauri application");
}
