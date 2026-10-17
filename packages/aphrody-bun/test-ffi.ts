// SPDX-License-Identifier: Apache-2.0
import {
  version,
  add,
  countChar,
  findBytes,
  hctToArgb,
  argbToHct,
  hctTones,
  deriveScheme,
  compileSass,
  validateSpec,
  svg,
} from "./src/index.ts";

console.log("=== Bun-RS FFI JS/TS Test ===");
if (version() !== "1.0.0-canary") throw new Error("unexpected aphrody-bun ABI version");
if (add(10, 20) !== 30) throw new Error("FFI addition contract failed");
if (add(2_147_483_647, 1) !== -2_147_483_648) throw new Error("FFI wrapping addition contract failed");
if (countChar("hello world", "o") !== 2) throw new Error("FFI byte count contract failed");
if (findBytes("supercalifragilistic", "fragil") !== 9) throw new Error("FFI substring contract failed");
if (findBytes("", "") !== 0) throw new Error("FFI empty substring contract failed");

const seed = 0xff6750a4;
const hct = argbToHct(seed);
const reconstructed = hctToArgb(hct.hue, hct.chroma, hct.tone);
const channelDelta = (a: number, b: number) =>
  Math.max(...[0, 8, 16].map(shift => Math.abs(((a >>> shift) & 0xff) - ((b >>> shift) & 0xff))));
if (channelDelta(reconstructed, seed) > 2) throw new Error("HCT round-trip contract failed");
const tones = hctTones(hct.hue, hct.chroma, hct.tone);
if (tones.length !== 13 || tones[0] !== 0xff000000 || tones[12] !== 0xffffffff)
  throw new Error("HCT tones contract failed");
if (Object.keys(deriveScheme(hct.hue, hct.chroma, false)).length !== 49) throw new Error("M3 scheme contract failed");

const sass = `
$primary: #6750A4;
a {
  color: $primary;
  &:hover {
    color: lighten($primary, 10%);
  }
}
`;
console.log("Compile SCSS via Grass Rust FFI:\n", compileSass(sass));

const testCode = `
  const style = "transition: transform 300ms cubic-bezier(0.42, 1.67, 0.21, 0.9);";
  const icon = <md-icon>check</md-icon>;
  const button = <md-icon-button aria-label="A11y Label"></md-icon-button>;

  // Violations
  const bad_color = "color: #ff0077;";
  const bad_role = "--md-sys-color-invalid-role-name";
  const bad_icon = <md-icon>wrong_name_here</md-icon>;
  const bad_curve = "transition: opacity 150ms cubic-bezier(0.1, 0.2, 0.3, 0.4);";
  const bad_btn = <md-icon-button></md-icon-button>;
`;
console.log("Validate Spec results:", JSON.stringify(validateSpec(testCode), null, 2));
const sanitizedSvg = svg({
  op: "sanitize",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" onload="alert(1)"><rect width="4" height="4"/></svg>',
}) as { svg: string };
if (typeof sanitizedSvg.svg !== "string" || sanitizedSvg.svg.includes("onload"))
  throw new Error("SVG FFI sanitization contract failed");

import { m3Render3d, type Scene3d } from "./src/index.ts";
const scene3d: Scene3d = {
  width: 48,
  height: 32,
  seed_argb: 0xff6750a4,
  background: { kind: "role", value: "surface" },
  lights: [
    {
      light: "hemisphere",
      sky: { kind: "role", value: "surface-bright" },
      ground: { kind: "role", value: "surface-dim" },
      intensity: 0.5,
    },
    {
      light: "directional",
      direction: [-1, -1, -1],
      color: { kind: "fixed", value: { r: 255, g: 255, b: 255, a: 255 } },
    },
  ],
  nodes: [
    {
      node: "group",
      transform: { rotation_deg: [15, 30, 0] },
      children: [
        {
          node: "mesh",
          geometry: {
            shape: "rounded_box",
            size: [2.4, 1.6, 0.2],
            radius: 0.1,
          },
          material: { base: { kind: "role", value: "surface-container-high" } },
        },
        {
          node: "mesh",
          transform: { translation: [0, 0, 0.5] },
          geometry: { shape: "sphere", radius: 0.5 },
          material: {
            base: { kind: "role", value: "primary" },
            roughness: 0.3,
          },
        },
      ],
    },
  ],
};
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const cpuA = m3Render3d(scene3d);
const cpuB = m3Render3d(scene3d, "cpu");
if (!pngSignature.every((b, i) => cpuA[i] === b)) throw new Error("m3Render3d PNG contract failed");
if (Buffer.compare(Buffer.from(cpuA), Buffer.from(cpuB)) !== 0)
  throw new Error("m3Render3d CPU determinism contract failed");
const auto = m3Render3d(scene3d, "auto");
if (!pngSignature.every((b, i) => auto[i] === b)) throw new Error("m3Render3d auto contract failed");
let rejected = false;
try {
  m3Render3d({ ...scene3d, samples: 2 as 4 });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("m3Render3d must reject invalid scenes");
console.log(`m3Render3d: cpu ${cpuA.length} B, auto ${auto.length} B`);

import { getAphrodyVersion, getAphrodyAbiVersion, runAphrodyCaptured, runAphrody } from "./src/index.ts";
import { webExtractTitle, webStripTags, webParseHtml, close as closeAphrodyFfi } from "./src/web.ts";
if (getAphrodyAbiVersion() !== 1) throw new Error("unsupported aphrody-ffi ABI version");
console.log("aphrody-ffi CLI version:", getAphrodyVersion());
const r = runAphrodyCaptured(["version", "--json"]);
if (r.code !== 0) throw new Error(`version command failed: ${r.stderr}`);
const parsed = JSON.parse(r.stdout);
if (typeof parsed.version !== "string") throw new Error("version JSON contract failed");
if (runAphrody(["version"]) !== 0) throw new Error("inherited-stdio CLI contract failed");
const invalid = runAphrodyCaptured(["__aphrody_ffi_invalid_command__"]);
if (invalid.code === 0 || invalid.stderr.length === 0) throw new Error("captured CLI error/status contract failed");
let rejectedNul = false;
try {
  runAphrodyCaptured(["bad\0argument"]);
} catch (error) {
  rejectedNul = error instanceof TypeError;
}
if (!rejectedNul) throw new Error("CLI argument NUL validation contract failed");
if (webExtractTitle("<title>FFI</title>") !== "FFI") throw new Error("Web title FFI contract failed");
if (webStripTags("<p>safe</p>") !== "safe") throw new Error("Web tag stripping FFI contract failed");
const dom = webParseHtml("<main><p class='entry'>native DOM</p></main>");
try {
  if (dom.querySelector("p.entry") !== '<p class="entry">native DOM</p>')
    throw new Error("Web DOM query FFI contract failed");
  let blockedClose = false;
  try {
    closeAphrodyFfi();
  } catch {
    blockedClose = true;
  }
  if (!blockedClose) throw new Error("FFI close must reject live native DOM handles");
} finally {
  dom.close();
}

console.log("aphrody-bun FFI contracts passed.");
