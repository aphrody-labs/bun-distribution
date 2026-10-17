// SPDX-License-Identifier: MIT
// Ambient `*.nes`, `*.gba`... module types for the console loader.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../types/roms.d.ts" />
export { loadersPlugin, registerLoaders } from "./plugin.ts";
export { buildCSharp, describeCSharp, invokeCSharp, type CSharpAssembly } from "./dotnet.ts";
export { describePowerShell, runPowerShell, type PowerShellScript } from "./pwsh.ts";
export { inspectPe, type PeInfo } from "./pe.ts";
export { inspectApk, readZip, decodeAxml, type ApkInfo } from "./apk.ts";
export { inspectRom, romExports, romExtensions, setupRomLoader, type RomInfo } from "./rom.ts";
export { inspectScene, type SceneInfo } from "./scene.ts";
export { inspectMedia } from "./media.ts";
