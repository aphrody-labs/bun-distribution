// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

mod event_loop;
mod monitor;
mod taskbar;
mod utils;
aphrody_web_source::module!("crates/tauri/aphrody-tauri-runtime-cef/src/platform/linux/webview.rs", mod webview);
mod window;

pub(crate) use window::CefX11Host;
