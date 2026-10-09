# Upstream provenance

Aphrody standalone fork of egui-winit 0.36.2, from emilk/egui revision 49682f8baa058bf49e011035cfbd6e825f88a5ef.
Source: https://crates.io/crates/egui-winit/0.36.2
Original authors, egui_winit library target and MIT/Apache-2.0 notices are preserved.

The bounded fix restricts native filesystem dropped-file support to non-WASM targets, matching upstream module guards at https://github.com/emilk/egui/blob/main/crates/egui-winit/src/lib.rs observed 2026-10-09. Winit web cannot emit native filesystem dropped-file events; that event remains explicitly unconsumed and does not request repaint.
The egui dependency remains registry version 0.36.2 to preserve consumer type identity.

Standalone strict-Clippy compatibility removes redundant wildcard fields and a lint expectation requiring upstream-only Clippy configuration; runtime behavior is unchanged.
