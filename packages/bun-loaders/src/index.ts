// SPDX-License-Identifier: MIT
export { loadersPlugin, registerLoaders } from "./plugin.ts";
export {
  buildCSharp,
  describeCSharp,
  invokeCSharp,
  type CSharpAssembly,
} from "./dotnet.ts";
export {
  describePowerShell,
  runPowerShell,
  type PowerShellScript,
} from "./pwsh.ts";
export { inspectPe, type PeInfo } from "./pe.ts";
export { inspectApk, readZip, decodeAxml, type ApkInfo } from "./apk.ts";
export { inspectRom, type RomInfo } from "./rom.ts";
export { inspectScene, type SceneInfo } from "./scene.ts";
export { inspectMedia } from "./media.ts";
