import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProject, loadStack, toIdent } from "../src/create";

const rootDir = resolve(import.meta.dir, "../../../docs/aphrody");
// Needs the Bun fork submodule, which the CI checkout cannot fetch (private).
const haveBunFork = existsSync(join(rootDir, "vendor/bun/LATEST"));
const sandbox = mkdtempSync(join(tmpdir(), "yolo-stack-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

const bunTypes = (file: string): string =>
  readFileSync(join(rootDir, "vendor/bun/packages/bun-types", file), "utf8");

// Workspace gates use the installed toolchain binaries, not removed root npm dependencies.
const toolVersion = (tool: string): string => {
  const result = Bun.spawnSync([tool, "--version"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  const value = result.stdout.toString().match(/\b\d+\.\d+\.\d+\b/)?.[0];
  expect(value).toBeDefined();
  return value!;
};

const options = (name: string, features: string[]) => ({
  rootDir,
  target: join(sandbox, name),
  name,
  features,
  yoloPath: rootDir,
});

const read = (path: string) => JSON.parse(readFileSync(join(rootDir, path), "utf8"));

describe("stack manifest", () => {
  it("points every template and layer path to files that exist", async () => {
    const stack = await loadStack(rootDir);
    for (const template of Object.values(stack.template)) {
      expect(existsSync(join(rootDir, template.path))).toBe(true);
    }
    for (const layer of Object.values(stack.layer)) {
      for (const path of (layer["paths"] as string[] | undefined) ?? []) {
        expect(existsSync(join(rootDir, path))).toBe(true);
      }
    }
  });

  it.skipIf(!haveBunFork)("uses only Bun APIs declared by the Bun fork's own types", async () => {
    const stack = await loadStack(rootDir);
    const serve = bunTypes("serve.d.ts");
    const sqlite = bunTypes("sqlite.d.ts");
    const apis = new Set(
      Object.values(stack.layer).flatMap((l) => (l["bun_apis"] as string[] | undefined) ?? []),
    );
    expect(apis).toEqual(new Set(["Bun.serve", "Database", "HTMLBundle"]));
    expect(serve).toContain("function serve<");
    expect(serve).toContain("HTMLBundle");
    expect(sqlite).toContain("export class Database");
  });

  it.skipIf(!haveBunFork)("pins the toolchain versions of the repository", async () => {
    const stack = await loadStack(rootDir);
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
    const catalog = pkg.workspaces?.catalog ?? {};
    const ts =
      pkg.devDependencies.typescript === "catalog:"
        ? catalog.typescript
        : pkg.devDependencies.typescript;
    const oxlint = toolVersion("oxlint");
    const oxfmt = toolVersion("oxfmt");
    expect(stack.meta["typescript"]).toBe(ts);
    expect(stack.meta["oxlint"]).toBe(oxlint);
    expect(stack.meta["oxfmt"]).toBe(oxfmt);
    expect(readFileSync(join(rootDir, "vendor/bun/LATEST"), "utf8").trim()).toBe(
      stack.meta["bun"] as string,
    );
  });

  it("only offers framework variants that are in the curated Rust-Bun list", async () => {
    const stack = await loadStack(rootDir);
    const curated = JSON.parse(
      readFileSync(join(rootDir, "tools/config/yolo/awesome.curated.json"), "utf8"),
    ) as {
      github?: string;
    }[];
    const repos = new Set(curated.map((e) => e.github));
    for (const template of Object.values(stack.template)) {
      if (template.curated !== undefined) expect(repos.has(template.curated)).toBe(true);
    }
  });
});

describe("yolo create", () => {
  it("scaffolds the base project with substituted names and no leftover tokens", async () => {
    const files = await createProject(options("demo-app", []));
    expect(files).toContain("src/server.ts");
    expect(files).toContain(".gitignore");
    expect(files).not.toContain("gitignore");
    for (const file of files) {
      const text = readFileSync(join(sandbox, "demo-app", file));
      if (!file.endsWith(".png") && !file.endsWith(".ico") && !file.endsWith(".icns")) {
        expect(text.toString("utf8")).not.toMatch(/__(NAME|IDENT|YOLO)__/);
      }
    }
    const pkg = JSON.parse(readFileSync(join(sandbox, "demo-app/package.json"), "utf8"));
    expect(pkg.name).toBe("demo-app");
    expect(pkg.dependencies["@aphrody/runtime-sdk"]).toBe("npm:@aphrody/bun-runtime-sdk@1.4.4");
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toBe("bun check --noEmit");
    expect(pkg.scripts.lint).toBe("bun lint src scripts test");
  });

  it("applies features in order: web replaces home.ts, desktop adds Tauri and icons", async () => {
    const files = await createProject(options("full-app", ["web", "desktop"]));
    expect(readFileSync(join(sandbox, "full-app/src/home.ts"), "utf8")).toContain("index.html");
    expect(files).toContain("src-tauri/Cargo.toml");
    expect(files.some((f) => f.startsWith("src-tauri/icons/"))).toBe(true);
    const cargo = readFileSync(join(sandbox, "full-app/src-tauri/Cargo.toml"), "utf8");
    expect(cargo).toContain('package = "aphrody-tauri"');
    expect(cargo).toContain("full_app_desktop_lib");
    expect(readFileSync(join(sandbox, "full-app/src-tauri/tauri.conf.json"), "utf8")).toContain(
      "dev.aphrody.full_app",
    );
  });

  it("adds the framework dependency with its pinned version", async () => {
    await createProject(options("hono-app", ["hono"]));
    const pkg = JSON.parse(readFileSync(join(sandbox, "hono-app/package.json"), "utf8"));
    expect(pkg.dependencies.hono).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(sandbox, "hono-app/src/alt/hono.ts"))).toBe(true);
  });

  it("scaffolds the react frontend: pinned dependencies, a jsx tsconfig and the page", async () => {
    const files = await createProject(options("react-app", ["react"]));
    for (const file of ["src/web/App.tsx", "src/web/m3.ts", "src/web/styles.css", "REACT.md"]) {
      expect(files).toContain(file);
    }
    expect(readFileSync(join(sandbox, "react-app/src/home.ts"), "utf8")).toContain("index.html");
    expect(readFileSync(join(sandbox, "react-app/src/web/index.html"), "utf8")).toContain(
      "<title>react-app</title>",
    );
    const pkg = JSON.parse(readFileSync(join(sandbox, "react-app/package.json"), "utf8"));
    const pinned = /^\d+\.\d+\.\d+$/;
    for (const name of ["@aphrody/material-web", "@lit/react", "lit", "react", "react-dom"]) {
      expect(pkg.dependencies[name]).toMatch(pinned);
    }
    for (const name of ["@types/react", "@types/react-dom"]) {
      expect(pkg.devDependencies[name]).toMatch(pinned);
    }
    // the dev dependencies of the base template survive the merge, and the tsconfig compiles TSX
    expect(pkg.devDependencies["@types/bun"]).toBeDefined();
    expect(pkg.dependencies["@aphrody/runtime-sdk"]).toBe("npm:@aphrody/bun-runtime-sdk@1.4.4");
    const tsconfig = JSON.parse(readFileSync(join(sandbox, "react-app/tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
  });

  it("keeps the react tsconfig equal to the base one plus the jsx option", () => {
    const base = read("m3/templates/base/tsconfig.json");
    expect(read("m3/templates/react/tsconfig.json")).toEqual({
      ...base,
      compilerOptions: { ...base.compilerOptions, jsx: "react-jsx" },
    });
  });

  it("builds the deployable for production, so React's development build is never embedded", () => {
    // Without this define the HTML bundle embedded by `bun build --compile` carries react-dom's
    // development build (557 KB instead of 345 KB for the react template, plus console warnings).
    const script = readFileSync(join(rootDir, "m3/templates/base/scripts/build-bin.ts"), "utf8");
    expect(script).toContain(`define: { "process.env.NODE_ENV": JSON.stringify("production") }`);
  });

  it("refuses unknown features, conflicting variants and non-empty targets", async () => {
    await expect(createProject(options("bad-1", ["nope"]))).rejects.toThrow(/Unknown template/);
    await expect(createProject(options("bad-2", ["hono", "elysia"]))).rejects.toThrow(
      /one framework/,
    );
    await expect(createProject(options("bad-3", ["web", "react"]))).rejects.toThrow(/one frontend/);
    await createProject(options("taken", []));
    await expect(createProject(options("taken", []))).rejects.toThrow(/not empty/);
  });

  it("derives a valid Rust identifier from the project name", () => {
    expect(toIdent("My-App.2")).toBe("my_app_2");
    expect(toIdent("2fast")).toBe("app_2fast");
  });
});

describe("distribution", () => {
  it("keeps VERSION, the stack manifest and the installers consistent", async () => {
    const version = readFileSync(join(rootDir, "packages/engine/yolo/VERSION"), "utf8").trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const installer = readFileSync(join(rootDir, "packages/engine/yolo/install.sh"), "utf8");
    for (const variable of [
      "YOLO_VERSION",
      "YOLO_HOME",
      "YOLO_REPO",
      "YOLO_RELEASE_DIR",
      "GITHUB_TOKEN",
    ]) {
      expect(installer).toContain(variable);
    }
    expect(installer).toContain("SHA256SUMS");
    expect(readFileSync(join(rootDir, "packages/engine/yolo/install.ps1"), "utf8")).toContain(
      "Get-FileHash",
    );
    // Every SDK target is selectable by the actual release installers. Factory release
    // orchestration owns builds; the retired release.yml is not the packaging contract.
    const { SUPPORTED_TARGETS } = await import("../../runtime/src/artifact");
    const windowsInstaller = readFileSync(
      join(rootDir, "packages/engine/yolo/install.ps1"),
      "utf8",
    );
    const systems = [...installer.matchAll(/\) os_part=([a-z-]+) ;;/g)].map((match) => match[1]!);
    const architectures = [...installer.matchAll(/\) arch_part=([a-z0-9_]+) ;;/g)].map(
      (match) => match[1]!,
    );
    const targets = architectures.flatMap((arch) => systems.map((system) => `${arch}-${system}`));
    const windowsTarget = windowsInstaller.match(/\$Target = "([^"]+)"/)?.[1];
    expect(windowsTarget).toBeDefined();
    targets.push(windowsTarget!);
    expect(targets.toSorted()).toEqual(Object.values(SUPPORTED_TARGETS).toSorted());
  });

  it("installs from a local release directory into an isolated home (when a release was built)", async () => {
    const version = readFileSync(join(rootDir, "packages/engine/yolo/VERSION"), "utf8").trim();
    const release = join(rootDir, "dist/release", version);
    if (!existsSync(join(release, "SHA256SUMS"))) return; // built by `bun run scripts/release/release.ts`
    const home = join(sandbox, "install-home");
    const proc = Bun.spawn(["sh", join(rootDir, "packages/engine/yolo/install.sh")], {
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        YOLO_RELEASE_DIR: release,
        YOLO_NO_MODIFY_PATH: "1",
        YOLO_NO_CRATES: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(output).toContain(`yolo ${version}`);
    const doctor = Bun.spawn([join(home, ".yolo/bin/yolo"), "doctor"], {
      windowsHide: true,
      env: { ...process.env, HOME: home, YOLO_HOME: join(home, ".yolo") },
      stdout: "pipe",
    });
    expect(await new Response(doctor.stdout).text()).toContain("verified and loadable");
    expect(await doctor.exited).toBe(0);
  });
});
