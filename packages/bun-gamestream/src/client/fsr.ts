/**
 * WGSL port of AMD FidelityFX Super Resolution 1.0 (EASU upscaling + RCAS sharpening).
 *
 * Ported from ffx_fsr1.h of the AMD FidelityFX SDK:
 *
 *   Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *   THE SOFTWARE.
 *
 * Differences from the HLSL/GLSL reference: the 12 EASU taps use textureLoad on the external
 * (decoded video) texture instead of four textureGather calls, the approximate reciprocals are
 * exact WGSL divisions with zero guards, and both passes are full-screen fragment shaders.
 */

const fullscreen = /* wgsl */ `
struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(xy.x, 1.0 - xy.y);
  return out;
}
`;

/** EASU: external video texture (input size) -> intermediate target (output size). */
export const easuWgsl = /* wgsl */ `
${fullscreen}
struct Params { outSize: vec2f, sharpness: f32, pad: f32 };
@group(0) @binding(0) var src: texture_external;
@group(0) @binding(1) var<uniform> params: Params;

fn tap(p: vec2i, size: vec2i) -> vec3f {
  return textureLoad(src, vec2u(clamp(p, vec2i(0), size - 1))).rgb;
}

fn luma(c: vec3f) -> f32 { return c.b + 0.5 * (c.r + c.g); }

fn rcp(x: f32) -> f32 { return 1.0 / max(x, 1.0 / 32768.0); }

// FsrEasuSetF: accumulates direction and length from one bilinear quadrant.
fn easuSet(dir: ptr<function, vec2f>, len: ptr<function, f32>, w: f32,
           lA: f32, lB: f32, lC: f32, lD: f32, lE: f32) {
  let dc = lD - lC;
  let cb = lC - lB;
  var lenX = rcp(max(abs(dc), abs(cb)));
  let dirX = lD - lB;
  lenX = saturate(abs(dirX) * lenX);
  lenX *= lenX;
  let ec = lE - lC;
  let ca = lC - lA;
  var lenY = rcp(max(abs(ec), abs(ca)));
  let dirY = lE - lA;
  lenY = saturate(abs(dirY) * lenY);
  lenY *= lenY;
  *dir += vec2f(dirX, dirY) * w;
  *len += (lenX + lenY) * w;
}

// FsrEasuTapF: one lanczos-like weighted tap along the edge direction.
fn easuTap(aC: ptr<function, vec3f>, aW: ptr<function, f32>, off: vec2f, dir: vec2f,
           len: vec2f, lob: f32, clp: f32, c: vec3f) {
  var v = vec2f(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x);
  v *= len;
  let d2 = min(v.x * v.x + v.y * v.y, clp);
  var wB = (2.0 / 5.0) * d2 - 1.0;
  var wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = (25.0 / 16.0) * wB - (25.0 / 16.0 - 1.0);
  let w = wB * wA;
  *aC += c * w;
  *aW += w;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(src));
  let inSize = vec2f(size);
  let scale = inSize / params.outSize;
  let ip = floor(in.pos.xy);
  var pp = ip * scale + (0.5 * scale - 0.5);
  let fp = floor(pp);
  pp -= fp;
  let f0 = vec2i(fp);

  //    b c
  //  e f g h
  //  i j k l
  //    n o
  let b = tap(f0 + vec2i(0, -1), size);
  let c = tap(f0 + vec2i(1, -1), size);
  let e = tap(f0 + vec2i(-1, 0), size);
  let f = tap(f0, size);
  let g = tap(f0 + vec2i(1, 0), size);
  let h = tap(f0 + vec2i(2, 0), size);
  let i = tap(f0 + vec2i(-1, 1), size);
  let j = tap(f0 + vec2i(0, 1), size);
  let k = tap(f0 + vec2i(1, 1), size);
  let l = tap(f0 + vec2i(2, 1), size);
  let n = tap(f0 + vec2i(0, 2), size);
  let o = tap(f0 + vec2i(1, 2), size);

  let bL = luma(b); let cL = luma(c); let eL = luma(e); let fL = luma(f);
  let gL = luma(g); let hL = luma(h); let iL = luma(i); let jL = luma(j);
  let kL = luma(k); let lL = luma(l); let nL = luma(n); let oL = luma(o);

  var dir = vec2f(0.0);
  var len = 0.0;
  easuSet(&dir, &len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  easuSet(&dir, &len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  easuSet(&dir, &len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  easuSet(&dir, &len, pp.x * pp.y, gL, jL, kL, lL, oL);

  let dir2 = dir * dir;
  var dirR = dir2.x + dir2.y;
  let zro = dirR < 1.0 / 32768.0;
  dirR = select(inverseSqrt(dirR), 1.0, zro);
  dir.x = select(dir.x, 1.0, zro);
  dir *= dirR;
  len = len * 0.5;
  len *= len;
  let stretch = (dir.x * dir.x + dir.y * dir.y) / max(max(abs(dir.x), abs(dir.y)), 1.0 / 32768.0);
  let len2 = vec2f(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  let lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  let clp = 1.0 / lob;

  let min4 = min(min(f, g), min(j, k));
  let max4 = max(max(f, g), max(j, k));

  var aC = vec3f(0.0);
  var aW = 0.0;
  easuTap(&aC, &aW, vec2f(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  easuTap(&aC, &aW, vec2f(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  easuTap(&aC, &aW, vec2f(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  easuTap(&aC, &aW, vec2f(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  easuTap(&aC, &aW, vec2f(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  easuTap(&aC, &aW, vec2f(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  easuTap(&aC, &aW, vec2f(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  easuTap(&aC, &aW, vec2f(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  easuTap(&aC, &aW, vec2f(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  easuTap(&aC, &aW, vec2f(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  easuTap(&aC, &aW, vec2f(1.0, 2.0) - pp, dir, len2, lob, clp, o);
  easuTap(&aC, &aW, vec2f(0.0, 2.0) - pp, dir, len2, lob, clp, n);

  return vec4f(min(max4, max(min4, aC / aW)), 1.0);
}
`;

/** RCAS: intermediate target -> canvas, contrast-adaptive sharpening with noise removal. */
export const rcasWgsl = /* wgsl */ `
${fullscreen}
struct Params { outSize: vec2f, sharpness: f32, pad: f32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

const RCAS_LIMIT: f32 = 0.25 - (1.0 / 16.0);

fn tap(p: vec2i, size: vec2i) -> vec3f {
  return textureLoad(src, clamp(p, vec2i(0), size - 1), 0).rgb;
}

fn luma2(c: vec3f) -> f32 { return c.b * 0.5 + (c.r * 0.5 + c.g); }

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(src));
  let ip = vec2i(floor(in.pos.xy));
  //    b
  //  d e f
  //    h
  let b = tap(ip + vec2i(0, -1), size);
  let d = tap(ip + vec2i(-1, 0), size);
  let e = tap(ip, size);
  let f = tap(ip + vec2i(1, 0), size);
  let h = tap(ip + vec2i(0, 1), size);

  let bL = luma2(b); let dL = luma2(d); let eL = luma2(e); let fL = luma2(f); let hL = luma2(h);
  var nz = 0.25 * (bL + dL + fL + hL) - eL;
  let range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
  nz = saturate(abs(nz) / max(range, 1.0 / 32768.0));
  nz = -0.5 * nz + 1.0;

  let mn4 = min(min(b, d), min(f, h));
  let mx4 = max(max(b, d), max(f, h));
  let hitMin = min(mn4, e) / max(4.0 * mx4, vec3f(1.0 / 32768.0));
  let hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, vec3f(-1.0 / 32768.0));
  let lobeRGB = max(-hitMin, hitMax);
  var lobe = max(-RCAS_LIMIT, min(max(max(lobeRGB.r, lobeRGB.g), lobeRGB.b), 0.0));
  lobe *= exp2(-params.sharpness) * nz;
  let rcpL = 1.0 / (4.0 * lobe + 1.0);
  return vec4f((lobe * (b + d + f + h) + e) * rcpL, 1.0);
}
`;

/** Plain bilinear path (comparison and same-size presentation). */
export const bilinearWgsl = /* wgsl */ `
${fullscreen}
@group(0) @binding(0) var src: texture_external;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  return vec4f(textureSampleBaseClampToEdge(src, samp, in.uv).rgb, 1.0);
}
`;
