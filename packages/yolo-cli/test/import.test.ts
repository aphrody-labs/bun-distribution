import { describe, expect, it } from "bun:test";
import {
  serializeToml,
  transformManifest,
  type CrateInfo,
  type TransformContext,
} from "../src/import";

const mk = (
  source: string,
  srcDir: string,
  name: string,
  version: string,
): CrateInfo => ({
  source,
  srcDir,
  name,
  newName: `aphrody-${name}`,
  version,
  newDir: `crates/aphrody-${name}`,
});

const tauri = mk("tauri", "crates/tauri", "tauri", "3.0.0-alpha.4");
const plugin = mk("plugins", "plugins/fs", "tauri-plugin-fs", "3.0.0-alpha.2");
const cli = mk("tauri", "crates/tauri-cli", "tauri-cli", "3.0.0-alpha.4");
const restart = mk("tauri", "crates/tests/restart", "restart", "0.1.0");
const all = [tauri, plugin, cli, restart];

function context(crate: CrateInfo, files: string[] = []): TransformContext {
  return {
    crate,
    cfg: {
      prefix: "aphrody-",
      repository: "https://github.com/aphrody-labs/yolo",
    },
    byName: new Map(all.map((c) => [c.name, c])),
    byDir: new Map(all.map((c) => [`${c.source}:${c.srcDir}`, c])),
    wsPackage: {
      edition: "2024",
      license: "MIT OR Apache-2.0",
      authors: ["Tauri"],
      "rust-version": "1.95",
    },
    wsDeps: {
      serde: { version: "1", features: ["derive"] },
      tauri: { version: "3.0.0-alpha.2", "default-features": false },
      log: "0.4.21",
    },
    wsLints: { clippy: { collapsible_if: "allow" } },
    wsRootDir: ".",
    hasFile: (p) => files.includes(p),
  };
}

const parse = (text: string) => Bun.TOML.parse(text) as any;

describe("serializeToml", () => {
  it("serializes inline tables, arrays and scalars", () => {
    expect(
      serializeToml({ version: "1", features: ["a", "b"], optional: true }),
    ).toBe('{ version = "1", features = ["a", "b"], optional = true }');
  });
});

describe("transformManifest", () => {
  it("renames the package, materializes workspace fields and aligns dependencies", () => {
    const text = `[package]
name = "tauri-plugin-fs"
version = "3.0.0-alpha.2"
authors = { workspace = true }
edition = { workspace = true }
license.workspace = true
repository = { workspace = true }
links = "tauri-plugin-fs"

[dependencies]
serde = { workspace = true, features = ["rc"] }
tauri = { workspace = true }
log = { workspace = true, optional = true }
anyhow = "1"

[workspace]
members = []
`;
    const { text: out } = transformManifest(
      text,
      context(plugin, ["plugins/fs/src/lib.rs"]),
    );
    const m = parse(out);
    expect(m.package.name).toBe("aphrody-tauri-plugin-fs");
    expect(m.package.links).toBe("tauri-plugin-fs");
    expect(m.package.edition).toBe("2024");
    expect(m.package.license).toBe("MIT OR Apache-2.0");
    expect(m.package.repository).toBe("https://github.com/aphrody-labs/yolo");
    expect(m.workspace).toBeUndefined();
    expect(m.dependencies.serde).toEqual({
      version: "1",
      features: ["derive", "rc"],
    });
    expect(m.dependencies.tauri).toEqual({
      version: "3.0.0-alpha.4",
      path: "../aphrody-tauri",
      package: "aphrody-tauri",
      "default-features": false,
    });
    expect(m.dependencies.log).toEqual({ version: "0.4.21", optional: true });
    expect(m.dependencies.anyhow).toBe("1");
    expect(m.lib).toEqual({ name: "tauri_plugin_fs" });
  });

  it("keeps the version operator and handles path dependencies and self dev-dependencies", () => {
    const text = `[package]
name = "tauri"
version = "3.0.0-alpha.4"

[dependencies]
tauri-cli = { version = "~3.0.0-alpha.1", path = "../tauri-cli", default-features = false }

[dev-dependencies]
tauri = { path = ".", features = ["test"] }
`;
    const { text: out } = transformManifest(
      text,
      context(tauri, ["crates/tauri/src/lib.rs"]),
    );
    const m = parse(out);
    expect(m.dependencies["tauri-cli"]).toEqual({
      version: "~3.0.0-alpha.4",
      path: "../aphrody-tauri-cli",
      package: "aphrody-tauri-cli",
      "default-features": false,
    });
    expect(m["dev-dependencies"].tauri).toEqual({
      path: ".",
      package: "aphrody-tauri",
      features: ["test"],
    });
  });

  it("keeps binary names and adds an explicit [[bin]] for an implicit main.rs", () => {
    const text = `[package]
name = "restart"
version = "0.1.0"

[dependencies]
serde = "1"
`;
    const { text: out } = transformManifest(
      text,
      context(restart, ["crates/tests/restart/src/main.rs"]),
    );
    const m = parse(out);
    expect(m.bin).toEqual([{ name: "restart", path: "src/main.rs" }]);
    expect(m.lib).toBeUndefined();
  });

  it("does not duplicate an explicit [[bin]] covering src/main.rs and names an existing [lib]", () => {
    const text = `[package]
name = "tauri-cli"
version = "3.0.0-alpha.4"

[lib]
crate-type = ["rlib"]

[[bin]]
name = "cargo-tauri"
path = "src/main.rs"
`;
    const { text: out } = transformManifest(
      text,
      context(cli, [
        "crates/tauri-cli/src/lib.rs",
        "crates/tauri-cli/src/main.rs",
      ]),
    );
    const m = parse(out);
    expect(m.bin).toEqual([{ name: "cargo-tauri", path: "src/main.rs" }]);
    expect(m.lib.name).toBe("tauri_cli");
    expect(m.lib["crate-type"]).toEqual(["rlib"]);
  });

  it("rewrites detailed dependency tables", () => {
    const text = `[package]\nname = "tauri-cli"\n\n[dependencies.tauri]\npath = "../tauri"\nfeatures = ["x"]\n\n[dependencies.serde]\nversion = "1"\n`;
    const { text: out } = transformManifest(text, context(cli));
    const m = parse(out);
    expect(m.dependencies.tauri).toEqual({
      path: "../aphrody-tauri",
      package: "aphrody-tauri",
      features: ["x"],
    });
    expect(m.dependencies.serde).toEqual({ version: "1" });
  });

  it("drops a top-level `workspace = {}` key", () => {
    const { text: out } = transformManifest(
      `workspace = {}\n\n[package]\nname = "tauri-cli"\n`,
      context(cli),
    );
    expect(parse(out).workspace).toBeUndefined();
    expect(parse(out).package.name).toBe("aphrody-tauri-cli");
  });

  it("materializes workspace lints and drops profiles", () => {
    const text = `[package]
name = "tauri-cli"
version = "1.0.0"

[lints]
workspace = true

[profile.release]
panic = "abort"
`;
    const { text: out } = transformManifest(text, context(cli));
    const m = parse(out);
    expect(m.lints).toEqual({ clippy: { collapsible_if: "allow" } });
    expect(m.profile).toBeUndefined();
  });

  it("fails loudly on unknown workspace fields and dependencies", () => {
    expect(() =>
      transformManifest(
        `[package]\nname = "tauri-cli"\nrust-version.workspace = true\nfoo.workspace = true\n`,
        context(cli),
      ),
    ).toThrow(/workspace.package.foo/);
    expect(() =>
      transformManifest(
        `[package]\nname = "tauri-cli"\n[dependencies]\nnope = { workspace = true }\n`,
        context(cli),
      ),
    ).toThrow(/nope/);
  });
});
