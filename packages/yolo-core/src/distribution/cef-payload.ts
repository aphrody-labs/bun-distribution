/**
 * The CEF (Chromium Embedded Framework) files a desktop artifact ships next to its executable.
 *
 * The lists mirror the Tauri bundler's own (crates/tauri/aphrody-tauri-bundler: `bundle/linux/debian.rs`,
 * `bundle/linux/rpm.rs`, `bundle/windows/nsis/mod.rs`, which follow CEF's `README.redistrib.txt`), so the
 * artifact and the installers carry the same runtime. `en-US` is Chromium's fallback locale and always ships; the
 * French paks ship when the distribution has them (the Linux bundlers do the same), so Chromium's own strings follow
 * a French session. The runtime's `locale` stays unset: naming a locale without its paks leaves Chromium without
 * its own strings.
 *
 * macOS is not covered: a CEF framework bundle is made of symlinks, which the artifact format refuses by
 * design; macOS is shipped as the `.app` bundle of `aphrody tauri build`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["en-US.pak", "en-US_FEMININE.pak", "en-US_MASCULINE.pak", "en-US_NEUTER.pak"];
/** Shipped only when the CEF distribution has them. */
const OPTIONAL_LOCALES = ["fr.pak", "fr_FEMININE.pak", "fr_MASCULINE.pak", "fr_NEUTER.pak"];

const LINUX = [
  // required
  "libcef.so",
  "icudtl.dat",
  "v8_context_snapshot.bin",
  // resources
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "resources.pak",
  // ANGLE and SwANGLE (software GL), Vulkan loader
  "libEGL.so",
  "libGLESv2.so",
  "libvk_swiftshader.so",
  "vk_swiftshader_icd.json",
  "libvulkan.so.1",
  // Chromium's setuid sandbox helper: used only when installed root-owned with mode 4755,
  // otherwise Chromium falls back to user namespaces
  "chrome-sandbox",
];

const WINDOWS = [
  "libcef.dll",
  "chrome_elf.dll",
  "icudtl.dat",
  "v8_context_snapshot.bin",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "resources.pak",
  "d3dcompiler_47.dll",
  "dxil.dll",
  "dxcompiler.dll",
  "libEGL.dll",
  "libGLESv2.dll",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
  "bootstrap.exe",
  "bootstrapc.exe",
];

/** Libraries stripped of symbols before hashing (the bundler does the same: libcef.so is 1.4 GB unstripped). */
export function strippedInArtifact(target: string, name: string): boolean {
  return target.includes("linux") && name.endsWith(".so");
}

/** Artifact path to source file for the CEF payload of `target`, from a CEF distribution directory. */
export function cefPayload(target: string, cefDir: string): Record<string, string> {
  const files = target.includes("windows") ? WINDOWS : target.includes("linux") ? LINUX : undefined;
  if (files === undefined) {
    throw new Error(`No CEF desktop artifact for ${target}: macOS ships the .app bundle of \`aphrody tauri build\``);
  }
  const payload: Record<string, string> = {};
  for (const name of files) payload[name] = join(cefDir, name);
  for (const name of LOCALES) payload[`locales/${name}`] = join(cefDir, "locales", name);
  const optional = OPTIONAL_LOCALES.filter(name => existsSync(join(cefDir, "locales", name)));
  const missing = Object.entries(payload)
    .filter(([, source]) => !existsSync(source))
    .map(([name]) => name);
  for (const name of optional) payload[`locales/${name}`] = join(cefDir, "locales", name);
  if (missing.length > 0) {
    throw new Error(
      `CEF distribution ${cefDir} lacks ${missing.join(", ")}: build aphrody-app first (cef-dll-sys copies the distribution next to the executable) or pass --cef-dir`,
    );
  }
  return payload;
}

/** The Chromium third-party credits that ship with the CEF distribution, kept as a notice. */
export function cefNotice(cefDir: string): Record<string, string> {
  const credits = join(cefDir, "CREDITS.html");
  if (!existsSync(credits)) {
    throw new Error(`CEF distribution ${cefDir} lacks CREDITS.html (Chromium third-party notices)`);
  }
  return { "LICENSE-chromium-credits.html": credits };
}
