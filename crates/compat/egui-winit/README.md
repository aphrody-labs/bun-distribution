# aphrody-egui-winit

Standalone Aphrody fork of egui-winit 0.36.2. The `egui_winit` library identity is preserved. See [UPSTREAM.md](UPSTREAM.md) for the bounded WASM fix, provenance and original licences.

[![Latest version](https://img.shields.io/crates/v/aphrody-egui-winit.svg)](https://crates.io/crates/aphrody-egui-winit)
[![Documentation](https://docs.rs/aphrody-egui-winit/badge.svg)](https://docs.rs/aphrody-egui-winit)
![MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Apache](https://img.shields.io/badge/license-Apache-blue.svg)

This crates provides bindings between [`egui`](https://github.com/emilk/egui) and [`winit`](https://crates.io/crates/winit).

The library translates winit events to egui, handled copy/paste, updates the cursor, open links clicked in egui, etc.
