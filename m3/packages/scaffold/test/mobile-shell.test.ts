// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { tauriShell } from "../src/tauri";

describe("Tauri host library entry point", () => {
  test("mobile targets and the desktop binary share run and the pinned host", () => {
    const files = tauriShell({
      name: "Aphrody M3 Showcase",
      identifier: "com.aphrody.m3showcase",
      mobile: true,
      build: { frontendDist: "../dist" },
      window: { mode: "config", title: "Showcase", width: 1200, height: 800 },
    });
    expect(files["src-tauri/Cargo.toml"]).toContain('crate-type = ["staticlib", "cdylib", "rlib"]');
    expect(files["src-tauri/src/lib.rs"]).toContain(
      "#[cfg_attr(mobile, tauri::mobile_entry_point)]",
    );
    expect(files["src-tauri/src/lib.rs"]).toContain("pub fn run()");
    expect(files["src-tauri/src/lib.rs"]).toContain(".runtime(Wry::default())");
    expect(files["src-tauri/src/lib.rs"]).not.toContain("windows_subsystem");
    expect(files["src-tauri/src/lib.rs"]).not.toContain("\\n");
    expect(files["src-tauri/src/main.rs"]).toContain("aphrody_m3_showcase_lib::run()");
  });
  test("the CEF desktop engine cannot be silently used as a mobile host", () => {
    expect(() =>
      tauriShell({
        name: "demo",
        identifier: "com.aphrody.demo",
        mobile: true,
        engine: "cef",
        build: { frontendDist: "../dist" },
      }),
    ).toThrow("wry host");
  });
});
