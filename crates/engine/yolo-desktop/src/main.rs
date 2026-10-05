// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  if std::env::args().any(|arg| arg == "--host-info") {
    println!(
      "{}",
      serde_json::json!({
        "name": "yolo-desktop", "version": env!("CARGO_PKG_VERSION"),
        "protocol": "yolo.desktop/1", "target": env!("YOLO_DESKTOP_TARGET"),
        "git_rev": env!("YOLO_DESKTOP_GIT_REV"), "rustc": env!("YOLO_DESKTOP_RUSTC"),
        "panic_recovery": cfg!(panic = "unwind"), "engine": "system-webview"
      })
    );
    return;
  }
  // Wayland & WSL low-level display pipeline tuning:
  // Ensures hardware composition doesn't crash on DMA-BUF protocols or NVIDIA/WSL drivers
  #[cfg(target_os = "linux")]
  {
    // In Rust 2024 / modern std, set_var is unsafe due to multi-threaded environment safety.
    // We set these at the very beginning of main() before spawning threads or initializing WebKitGTK.
    unsafe {
      if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
      }
      if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
      }
    }
  }

  if std::env::args().any(|arg| arg == "--runtime-host") {
    match yolo_desktop_lib::runtime_host::run() {
      Ok(code) => std::process::exit(code),
      Err(error) => {
        eprintln!("yolo-desktop: {error}");
        std::process::exit(1);
      }
    }
  } else {
    yolo_desktop_lib::run()
  }
}
