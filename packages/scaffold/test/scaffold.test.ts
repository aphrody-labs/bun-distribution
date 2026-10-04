// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  appFiles,
  crateName,
  EXAMPLE_NAME,
  exampleFiles,
  isUsableAppIcon,
  npmName,
  parseHexColor,
  pngInfo,
  renderTemplate,
  scaffold,
  ScaffoldError,
  slug,
  solidIconPng,
  TAURI_3,
  tauriIdentifier,
  tauriShell,
  TEMPLATES,
  webFiles,
  writeFiles,
} from "../src/index.ts";

const root = resolve(import.meta.dir, "../../../..");
const text = (value: string | Uint8Array | undefined): string =>
  typeof value === "string" ? value : new TextDecoder().decode(value);

function cargoVersion(manifest: string, name: string): string | undefined {
  const line = manifest.split("\n").find((entry) => entry.startsWith(`${name} =`));
  return (
    /version\s*=\s*"=?([^"]+)"/.exec(line ?? "")?.[1] ?? /=\s*"=?([^"]+)"/.exec(line ?? "")?.[1]
  );
}

describe("pins", () => {
  it("stay on the Tauri line pinned by the root workspace", async () => {
    const manifest = await Bun.file(join(root, "Cargo.toml")).text();
    expect(cargoVersion(manifest, "tauri")).toBe(TAURI_3.tauri);
    expect(cargoVersion(manifest, "tauri-runtime-wry")).toBe(TAURI_3.runtimeWry);
    expect(cargoVersion(manifest, "tauri-build")).toBe(TAURI_3.build);
    expect(cargoVersion(manifest, "tauri-plugin-opener")).toBe(TAURI_3.pluginOpener);
    const config = JSON.parse(await Bun.file(join(root, "config/tauri-upstream.json")).text());
    expect(config.js.cli.version).toBe(TAURI_3.jsCli);
    const catalog = JSON.parse(await Bun.file(join(root, "package.json")).text()).workspaces
      .catalog;
    expect(catalog["@tauri-apps/api"]).toBe(TAURI_3.jsApi);
    expect(catalog["@tauri-apps/plugin-opener"]).toBe(TAURI_3.jsPluginOpener);
  });

  it("are mirrored once: tauri-sync tracks this file and no other scaffolder", async () => {
    const config = JSON.parse(await Bun.file(join(root, "config/tauri-upstream.json")).text());
    expect(config.mirrors.map((mirror: { file: string }) => mirror.file)).toEqual([
      "packages/scaffold/src/pins.ts",
    ]);
  });
});

describe("app template", () => {
  it("generates a Tauri 3 project with an explicit wry runtime", () => {
    const files = appFiles({ name: "Demo App", target: "tauri" });
    const pkg = JSON.parse(text(files["package.json"]));
    expect(pkg.dependencies["@tauri-apps/api"]).toBe(TAURI_3.jsApi);
    expect(pkg.dependencies["@tauri-apps/plugin-opener"]).toBe(TAURI_3.jsPluginOpener);
    expect(pkg.devDependencies["@tauri-apps/cli"]).toBe(TAURI_3.jsCli);
    expect(pkg.dependencies["@tauri-apps/plugin-shell"]).toBeUndefined();

    const cargo = text(files["src-tauri/Cargo.toml"]);
    expect(cargoVersion(cargo, "tauri")).toBe(TAURI_3.tauri);
    expect(cargoVersion(cargo, "tauri-runtime-wry")).toBe(TAURI_3.runtimeWry);
    expect(cargoVersion(cargo, "tauri-build")).toBe(TAURI_3.build);
    expect(cargoVersion(cargo, "tauri-plugin-opener")).toBe(TAURI_3.pluginOpener);
    expect(cargo).toContain('name = "demo-app"');
    expect(cargo).not.toMatch(/version = "2\./);

    const main = text(files["src-tauri/src/main.rs"]);
    expect(main).toContain(".runtime(Wry::default())");
    expect(main).toContain("tauri_plugin_opener::init()");

    const conf = JSON.parse(text(files["src-tauri/tauri.conf.json"]));
    expect(conf.$schema).toContain(`tauri-v${TAURI_3.tauri}`);
    expect(conf.identifier).toBe("com.aphrody.demoapp");
    expect(conf.app.withGlobalTauri).toBe(true);
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.bundle.icon).toEqual(["icons/icon.png"]);
    const capability = JSON.parse(text(files["src-tauri/capabilities/default.json"]));
    expect(capability.permissions).toEqual(["core:default", "opener:default"]);
  });

  it("writes an RGBA icon that tauri::generate_context! accepts", () => {
    const icon = appFiles({ name: "demo" })["src-tauri/icons/icon.png"] as Uint8Array;
    expect(Array.from(icon.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(icon[25]).toBe(6);
    expect(isUsableAppIcon(icon)).toBe(true);
  });

  it("adds no Tauri file for the vite target", () => {
    const files = appFiles({ name: "demo", target: "vite" });
    expect(Object.keys(files).some((path) => path.startsWith("src-tauri/"))).toBe(false);
    expect(JSON.parse(text(files["package.json"])).scripts.preview).toBe("vite preview");
  });

  it("takes the M3 packages and a replacement App.tsx", () => {
    const files = appFiles({
      name: "demo",
      modernizeM3: true,
      appTsx: "export default () => null;",
    });
    expect(JSON.parse(text(files["package.json"])).dependencies["@aphrody/m3-theme"]).toBe(
      "workspace:*",
    );
    expect(text(files["src/main.tsx"])).toContain("@aphrody/m3-theme/m3.css");
    expect(text(files["src/App.tsx"])).toBe("export default () => null;");
  });
});

describe("web template", () => {
  it("is the m3 new project", () => {
    const files = webFiles({ name: "my-app", m3Version: "3.3.3" });
    expect(Object.keys(files).toSorted()).toEqual([
      ".gitignore",
      "bunfig.toml",
      "index.html",
      "m3.config.ts",
      "package.json",
      "src/main.ts",
    ]);
    expect(JSON.parse(text(files["package.json"]))).toMatchObject({
      name: "my-app",
      dependencies: { "@aphrody/m3": "^3.3.3" },
    });
  });
});

describe("example", () => {
  it("is the single canonical example: the app template with Tauri 3, M3 and a README", () => {
    const files = exampleFiles();
    expect(text(files["README.md"])).toContain(EXAMPLE_NAME);
    expect(files["src-tauri/Cargo.toml"]).toBeDefined();
    expect(JSON.parse(text(files["package.json"])).dependencies["@aphrody/m3-primitives"]).toBe(
      "workspace:*",
    );
    expect(renderTemplate({ template: "example" })).toEqual(files);
    expect(TEMPLATES.map((template) => template.name)).toEqual(["web", "app", "example"]);
  });
});

describe("tauriShell", () => {
  const base = {
    name: "Wrapped",
    identifier: "io.aphrody.wrapped.site",
    build: { frontendDist: "../dist" },
  } as const;

  it("writes a runtime-plugin shell without a configured window or permission", () => {
    const files = tauriShell({
      ...base,
      window: { mode: "runtime" },
      permissions: [],
      runtimePlugin: {
        crate: "aphrody-tauri-wrap",
        path: "../../crates/ui/tauri-wrap",
        init: 'aphrody_tauri_wrap::init(include_str!("../wrap.json"))',
      },
      debugBridge: true,
      externalBin: ["binaries/server"],
    });
    expect(JSON.parse(text(files["src-tauri/tauri.conf.json"])).app.windows).toEqual([]);
    expect(JSON.parse(text(files["src-tauri/tauri.conf.json"])).bundle.externalBin).toEqual([
      "binaries/server",
    ]);
    expect(JSON.parse(text(files["src-tauri/capabilities/default.json"])).permissions).toEqual([]);
    const cargo = text(files["src-tauri/Cargo.toml"]);
    // Crate defaults (the bundle server) and a debug-bridge feature that only forwards to the crate.
    expect(cargo).toContain('aphrody-tauri-wrap = { path = "../../crates/ui/tauri-wrap" }');
    expect(cargo).toContain('debug-bridge = ["aphrody-tauri-wrap/debug-bridge"]');
    expect(cargo).not.toContain("aphrody-tauri-debug");
    const main = text(files["src-tauri/src/main.rs"]);
    expect(main).toContain('.plugin(aphrody_tauri_wrap::init(include_str!("../wrap.json")))');
    expect(main).toContain('#[cfg(feature = "debug-bridge")]');
    expect(main).toContain("builder.plugin(aphrody_tauri_wrap::debug::init())");
    expect(main).not.toContain("tauri_plugin_opener");
  });

  it("drops the crate's default features when the runtime plugin asks for a subset", () => {
    const plugin = {
      crate: "aphrody-tauri-wrap",
      path: "../../crates/ui/tauri-wrap",
      init: 'aphrody_tauri_wrap::init(include_str!("../wrap.json"))',
    };
    const none = text(
      tauriShell({ ...base, runtimePlugin: { ...plugin, features: [] } })["src-tauri/Cargo.toml"],
    );
    expect(none).toContain(
      'aphrody-tauri-wrap = { path = "../../crates/ui/tauri-wrap", default-features = false }',
    );
    const some = text(
      tauriShell({ ...base, runtimePlugin: { ...plugin, features: ["bundle"] } })[
        "src-tauri/Cargo.toml"
      ],
    );
    expect(some).toContain(
      'aphrody-tauri-wrap = { path = "../../crates/ui/tauri-wrap", default-features = false, features = ["bundle"] }',
    );
    expect(some).not.toContain("[features]");
  });

  it("adds the wrap crate as an optional dependency for a debug bridge without runtime plugin", () => {
    const files = tauriShell({ ...base, debugBridge: { path: "../../crates/ui/tauri-wrap" } });
    const cargo = text(files["src-tauri/Cargo.toml"]);
    expect(cargo).toContain(
      'debug-bridge = ["dep:aphrody-tauri-wrap", "aphrody-tauri-wrap/debug-bridge"]',
    );
    expect(cargo).toContain(
      'aphrody-tauri-wrap = { path = "../../crates/ui/tauri-wrap", default-features = false, optional = true }',
    );
    expect(text(files["src-tauri/src/main.rs"])).toContain("aphrody_tauri_wrap::debug::init()");
    expect(() => tauriShell({ ...base, debugBridge: true })).toThrow("runtime plugin");
  });

  it("selects the CEF runtime without the wry-only debug bridge", () => {
    const files = tauriShell({ ...base, engine: "cef", debugBridge: { path: "x" } });
    expect(text(files["src-tauri/Cargo.toml"])).toContain("tauri-runtime-cef");
    expect(text(files["src-tauri/Cargo.toml"])).not.toContain("tauri-runtime-wry");
    expect(text(files["src-tauri/Cargo.toml"])).not.toContain("debug-bridge");
    expect(text(files["src-tauri/src/main.rs"])).toContain("#[tauri_runtime_cef::cef_entry_point]");
  });

  it("builds a plain wry app chain", () => {
    const main = text(tauriShell(base)["src-tauri/src/main.rs"]);
    expect(main).toContain(
      "let builder = tauri::Builder::default()\n        .runtime(Wry::default());",
    );
  });
});

describe("writeFiles", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const fresh = async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaffold-"));
    dirs.push(dir);
    return dir;
  };

  it("`new` needs an absent directory, `empty` an empty one", async () => {
    const dir = await fresh();
    await expect(writeFiles(dir, { "a.txt": "a" }, "new")).rejects.toBeInstanceOf(ScaffoldError);
    await writeFiles(dir, { "a.txt": "a" }, "empty");
    await expect(writeFiles(dir, { "b.txt": "b" }, "empty")).rejects.toThrow("not empty");
    await writeFiles(join(dir, "child"), { "deep/x.txt": "x" }, "new");
    expect(await Bun.file(join(dir, "child/deep/x.txt")).text()).toBe("x");
  });

  it("`merge` never overwrites and writes nothing when one file clashes", async () => {
    const dir = await fresh();
    await writeFile(join(dir, "keep.txt"), "mine");
    await expect(
      writeFiles(dir, { "other.txt": "o", "keep.txt": "theirs" }, "merge"),
    ).rejects.toThrow("refusing to overwrite");
    expect(await Bun.file(join(dir, "keep.txt")).text()).toBe("mine");
    expect(await Bun.file(join(dir, "other.txt")).exists()).toBe(false);
  });

  it("`overwrite` refreshes in place", async () => {
    const dir = await fresh();
    await writeFiles(dir, { "a.txt": "1" }, "overwrite");
    await writeFiles(dir, { "a.txt": "2" }, "overwrite");
    expect(await Bun.file(join(dir, "a.txt")).text()).toBe("2");
  });

  it("rejects paths that leave the directory", async () => {
    const dir = await fresh();
    await expect(writeFiles(dir, { "../escape.txt": "x" })).rejects.toThrow("unsafe path");
    await expect(writeFiles(dir, { "/abs.txt": "x" })).rejects.toThrow("unsafe path");
  });

  it("scaffold writes a rendered template", async () => {
    const dir = join(await fresh(), "proj");
    await mkdir(join(dir, ".."), { recursive: true });
    const written = await scaffold(
      dir,
      { template: "web", name: "proj", m3Version: "1.0.0" },
      "new",
    );
    expect(written.length).toBe(6);
  });
});

describe("names and icons", () => {
  it("derives names", () => {
    expect(slug("Hello, Wörld!")).toBe("hello-world");
    expect(slug("***")).toBe("app");
    expect(crateName("3D Viewer")).toBe("app-3d-viewer");
    expect(npmName("My App_1")).toBe("my-app_1");
    expect(npmName("###")).toBeNull();
    expect(tauriIdentifier("123.example.com", "io.aphrody.wrapped")).toBe(
      "io.aphrody.wrapped.s123-example-com",
    );
  });

  it("encodes a valid solid PNG and rejects what Tauri would refuse", () => {
    const png = solidIconPng(256, [1, 2, 3, 255]);
    expect(pngInfo(png)).toEqual({ width: 256, height: 256, bitDepth: 8, colorType: 6 });
    expect(isUsableAppIcon(png)).toBe(true);
    expect(isUsableAppIcon(solidIconPng(32))).toBe(false);
    expect(isUsableAppIcon(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("parses hex colours only", () => {
    expect(parseHexColor("#336699")).toEqual([0x33, 0x66, 0x99, 255]);
    expect(parseHexColor("#f00")).toEqual([255, 0, 0, 255]);
    expect(parseHexColor("#f008")).toEqual([255, 0, 0, 0x88]);
    expect(parseHexColor("rebeccapurple")).toBeNull();
    expect(parseHexColor(null)).toBeNull();
  });
});
