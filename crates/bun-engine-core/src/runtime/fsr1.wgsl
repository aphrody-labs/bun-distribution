// AMD FidelityFX Super Resolution 1.0 (EASU + RCAS), ported to WGSL for Bun Engine: NV12 (BT.709)
// decoding fused into the EASU taps for the stream client, or an sRGB RGB(A) texture for the
// reusable post-process (`RGB_SOURCE`).
//
// Port of ffx_fsr1.h from https://github.com/GPUOpen-Effects/FidelityFX-FSR:
//
// Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

struct Params {
    // Stream (input) size in pixels.
    in_size: vec2<f32>,
    // Upscaled (output viewport) size in pixels.
    out_size: vec2<f32>,
    // Top-left of the letterboxed viewport inside the swap chain.
    origin: vec2<f32>,
    // RCAS sharpness as a linear value: exp2(-stops).
    sharpness: f32,
    // 1.0 for full-range YUV, 0.0 for limited (studio) range.
    full_range: f32,
};

@group(0) @binding(0) var<uniform> P: Params;

// The EASU source is one sRGB RGB(A) texture bound as `luma_tex` instead of NV12 planes.
override RGB_SOURCE: bool = false;
// The RCAS / HUD target has an sRGB format: output linear values so the hardware re-encodes them.
override SRGB_TARGET: bool = false;

fn srgb_encode(c: vec3<f32>) -> vec3<f32> {
    return select(1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3<f32>(0.0031308));
}

fn srgb_decode(c: vec3<f32>) -> vec3<f32> {
    return select(pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}

fn target_color(c: vec3<f32>) -> vec3<f32> {
    if (SRGB_TARGET) {
        return srgb_decode(c);
    }
    return c;
}

struct VsOut { @builtin(position) pos: vec4<f32> };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    let x = f32((i << 1u) & 2u);
    let y = f32(i & 2u);
    var o: VsOut;
    o.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return o;
}

// ---- EASU: edge-adaptive spatial upsampling from the NV12 planes -------------------------------

@group(1) @binding(0) var luma_tex: texture_2d<f32>;
@group(1) @binding(1) var chroma_tex: texture_2d<f32>;
@group(1) @binding(2) var chroma_smp: sampler;

fn rgb_at(p: vec2<i32>) -> vec3<f32> {
    let size = vec2<i32>(P.in_size);
    let q = clamp(p, vec2<i32>(0, 0), size - vec2<i32>(1, 1));
    if (RGB_SOURCE) {
        // Sampled from an sRGB view, so the texel is linear; FSR works on gamma-encoded values.
        return srgb_encode(clamp(textureLoad(luma_tex, q, 0).rgb, vec3<f32>(0.0), vec3<f32>(1.0)));
    }
    let y8 = textureLoad(luma_tex, q, 0).r;
    let c8 = textureSampleLevel(chroma_tex, chroma_smp, (vec2<f32>(q) + vec2<f32>(0.5, 0.5)) / P.in_size, 0.0).rg;
    var y = y8;
    var cb = c8.r - 0.5;
    var cr = c8.g - 0.5;
    if (P.full_range < 0.5) {
        y = (y8 - 16.0 / 255.0) * (255.0 / 219.0);
        cb = (c8.r - 128.0 / 255.0) * (255.0 / 224.0);
        cr = (c8.g - 128.0 / 255.0) * (255.0 / 224.0);
    }
    // BT.709
    let rgb = vec3<f32>(y + 1.5748 * cr, y - 0.1873 * cb - 0.4681 * cr, y + 1.8556 * cb);
    return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Luma times 2, as in FsrEasuF.
fn luma2(c: vec3<f32>) -> f32 {
    return c.b * 0.5 + (c.r * 0.5 + c.g);
}

// FsrEasuSetF: accumulate direction and length for one bilinear quadrant.
fn easu_set(dir: ptr<function, vec2<f32>>, len: ptr<function, f32>, w: f32,
            la: f32, lb: f32, lc: f32, ld: f32, le: f32) {
    // Direction is the '+' diff.
    let dc = ld - lc;
    let cb = lc - lb;
    var lenx = max(abs(dc), abs(cb));
    lenx = 1.0 / max(lenx, 1.0e-8);
    let dirx = ld - lb;
    (*dir).x = (*dir).x + dirx * w;
    lenx = clamp(abs(dirx) * lenx, 0.0, 1.0);
    lenx = lenx * lenx;
    *len = *len + lenx * w;
    // Repeat for the y axis.
    let ec = le - lc;
    let ca = lc - la;
    var leny = max(abs(ec), abs(ca));
    leny = 1.0 / max(leny, 1.0e-8);
    let diry = le - la;
    (*dir).y = (*dir).y + diry * w;
    leny = clamp(abs(diry) * leny, 0.0, 1.0);
    leny = leny * leny;
    *len = *len + leny * w;
}

// FsrEasuTapF: one filtered tap of the approximated, rotated and stretched Lanczos-2 kernel.
fn easu_tap(ac: ptr<function, vec3<f32>>, aw: ptr<function, f32>, off: vec2<f32>, dir: vec2<f32>,
            len: vec2<f32>, lob: f32, clp: f32, c: vec3<f32>) {
    var v = vec2<f32>(off.x * dir.x + off.y * dir.y, off.x * (-dir.y) + off.y * dir.x);
    v = v * len;
    let d2 = min(v.x * v.x + v.y * v.y, clp);
    //  (25/16 * (2/5 * x^2 - 1)^2 - (25/16 - 1)) * (1/4 * x^2 - 1)^2
    var wb = (2.0 / 5.0) * d2 - 1.0;
    var wa = lob * d2 - 1.0;
    wb = wb * wb;
    wa = wa * wa;
    wb = (25.0 / 16.0) * wb - (25.0 / 16.0 - 1.0);
    let w = wb * wa;
    *ac = *ac + c * w;
    *aw = *aw + w;
}

@fragment fn easu(v: VsOut) -> @location(0) vec4<f32> {
    let ip = floor(v.pos.xy);
    // con0: output pixel to input pixel position, centered.
    var pp = (ip + vec2<f32>(0.5, 0.5)) * (P.in_size / P.out_size) - vec2<f32>(0.5, 0.5);
    let fp = floor(pp);
    pp = pp - fp;
    let f0 = vec2<i32>(fp);
    // 12-tap kernel.
    //    b c
    //  e f g h
    //  i j k l
    //    n o
    let b = rgb_at(f0 + vec2<i32>(0, -1));
    let c = rgb_at(f0 + vec2<i32>(1, -1));
    let e = rgb_at(f0 + vec2<i32>(-1, 0));
    let f = rgb_at(f0);
    let g = rgb_at(f0 + vec2<i32>(1, 0));
    let h = rgb_at(f0 + vec2<i32>(2, 0));
    let i = rgb_at(f0 + vec2<i32>(-1, 1));
    let j = rgb_at(f0 + vec2<i32>(0, 1));
    let k = rgb_at(f0 + vec2<i32>(1, 1));
    let l = rgb_at(f0 + vec2<i32>(2, 1));
    let n = rgb_at(f0 + vec2<i32>(0, 2));
    let o = rgb_at(f0 + vec2<i32>(1, 2));
    let bl = luma2(b);
    let cl = luma2(c);
    let el = luma2(e);
    let fl = luma2(f);
    let gl = luma2(g);
    let hl = luma2(h);
    let il = luma2(i);
    let jl = luma2(j);
    let kl = luma2(k);
    let ll = luma2(l);
    let nl = luma2(n);
    let ol = luma2(o);
    var dir = vec2<f32>(0.0, 0.0);
    var len = 0.0;
    easu_set(&dir, &len, (1.0 - pp.x) * (1.0 - pp.y), bl, el, fl, gl, jl);
    easu_set(&dir, &len, pp.x * (1.0 - pp.y), cl, fl, gl, hl, kl);
    easu_set(&dir, &len, (1.0 - pp.x) * pp.y, fl, il, jl, kl, nl);
    easu_set(&dir, &len, pp.x * pp.y, gl, jl, kl, ll, ol);
    // Normalize with approximation, and cleanup close to zero.
    let dir2 = dir * dir;
    var dirr = dir2.x + dir2.y;
    let zro = dirr < (1.0 / 32768.0);
    dirr = inverseSqrt(max(dirr, 1.0e-12));
    dirr = select(dirr, 1.0, zro);
    dir.x = select(dir.x, 1.0, zro);
    dir = dir * dirr;
    // Transform from {0 to 2} to {0 to 1} range, and shape with square.
    len = len * 0.5;
    len = len * len;
    // Stretch kernel {1.0 vert|horz, to sqrt(2.0) on diagonal}.
    let stretch = (dir.x * dir.x + dir.y * dir.y) / max(max(abs(dir.x), abs(dir.y)), 1.0e-8);
    // Anisotropic length after rotation.
    let len2 = vec2<f32>(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    // Based on the amount of 'edge', the window shifts from +/-{sqrt(2.0) to slightly beyond 2.0}.
    let lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
    // Set distance^2 clipping point to the end of the adjustable window.
    let clp = 1.0 / lob;
    // Accumulation mixed with min/max of 4 nearest.
    let min4 = min(min(f, g), min(j, k));
    let max4 = max(max(f, g), max(j, k));
    var ac = vec3<f32>(0.0);
    var aw = 0.0;
    easu_tap(&ac, &aw, vec2<f32>(0.0, -1.0) - pp, dir, len2, lob, clp, b);
    easu_tap(&ac, &aw, vec2<f32>(1.0, -1.0) - pp, dir, len2, lob, clp, c);
    easu_tap(&ac, &aw, vec2<f32>(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
    easu_tap(&ac, &aw, vec2<f32>(0.0, 1.0) - pp, dir, len2, lob, clp, j);
    easu_tap(&ac, &aw, vec2<f32>(0.0, 0.0) - pp, dir, len2, lob, clp, f);
    easu_tap(&ac, &aw, vec2<f32>(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
    easu_tap(&ac, &aw, vec2<f32>(1.0, 1.0) - pp, dir, len2, lob, clp, k);
    easu_tap(&ac, &aw, vec2<f32>(2.0, 1.0) - pp, dir, len2, lob, clp, l);
    easu_tap(&ac, &aw, vec2<f32>(2.0, 0.0) - pp, dir, len2, lob, clp, h);
    easu_tap(&ac, &aw, vec2<f32>(1.0, 0.0) - pp, dir, len2, lob, clp, g);
    easu_tap(&ac, &aw, vec2<f32>(1.0, 2.0) - pp, dir, len2, lob, clp, o);
    easu_tap(&ac, &aw, vec2<f32>(0.0, 2.0) - pp, dir, len2, lob, clp, n);
    // Normalize and dering.
    let pix = min(max4, max(min4, ac / aw));
    return vec4<f32>(pix, 1.0);
}

// ---- RCAS: robust contrast-adaptive sharpening into the swap chain -----------------------------

@group(2) @binding(0) var upscaled: texture_2d<f32>;

const RCAS_LIMIT: f32 = 0.25 - (1.0 / 16.0);

fn up_at(p: vec2<i32>) -> vec3<f32> {
    let size = vec2<i32>(P.out_size);
    return textureLoad(upscaled, clamp(p, vec2<i32>(0, 0), size - vec2<i32>(1, 1)), 0).rgb;
}

@fragment fn rcas(v: VsOut) -> @location(0) vec4<f32> {
    let sp = vec2<i32>(floor(v.pos.xy - P.origin));
    // Algorithm uses minimal 3x3 pixel neighborhood.
    //    b
    //  d e f
    //    h
    let b = up_at(sp + vec2<i32>(0, -1));
    let d = up_at(sp + vec2<i32>(-1, 0));
    let e = up_at(sp);
    let f = up_at(sp + vec2<i32>(1, 0));
    let h = up_at(sp + vec2<i32>(0, 1));
    // Luma times 2.
    let bl = luma2(b);
    let dl = luma2(d);
    let el = luma2(e);
    let fl = luma2(f);
    let hl = luma2(h);
    // Noise detection.
    var nz = 0.25 * bl + 0.25 * dl + 0.25 * fl + 0.25 * hl - el;
    let range = max(max(max(bl, dl), max(el, fl)), hl) - min(min(min(bl, dl), min(el, fl)), hl);
    nz = clamp(abs(nz) / max(range, 1.0e-8), 0.0, 1.0);
    nz = -0.5 * nz + 1.0;
    // Min and max of ring.
    let mn4 = min(min(b, d), min(f, h));
    let mx4 = max(max(b, d), max(f, h));
    // Immediate constants for peak range.
    let peak = vec2<f32>(1.0, -1.0 * 4.0);
    // Limiters.
    let hit_min = min(mn4, e) / max(4.0 * mx4, vec3<f32>(1.0e-8));
    let hit_max = (peak.x - max(mx4, e)) / min(4.0 * mn4 + peak.y, vec3<f32>(-1.0e-8));
    let lobe3 = max(-hit_min, hit_max);
    var lobe = max(-RCAS_LIMIT, min(max(lobe3.r, max(lobe3.g, lobe3.b)), 0.0)) * P.sharpness;
    // Noise removal (FSR_RCAS_DENOISE): compressed video carries block and ringing noise.
    lobe = lobe * nz;
    // Resolve.
    let rcp_l = 1.0 / (4.0 * lobe + 1.0);
    let pix = (lobe * b + lobe * d + lobe * h + lobe * f + e) * rcp_l;
    return vec4<f32>(target_color(pix), 1.0);
}

// ---- HUD overlay (premultiplied text bitmap) ----------------------------------------------------

@group(3) @binding(0) var hud_tex: texture_2d<f32>;

@fragment fn hud(v: VsOut) -> @location(0) vec4<f32> {
    let size = vec2<i32>(textureDimensions(hud_tex));
    let p = vec2<i32>(floor(v.pos.xy)) - vec2<i32>(8, 8);
    if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) {
        discard;
    }
    let c = textureLoad(hud_tex, p, 0);
    if (SRGB_TARGET && c.a > 0.0) {
        return vec4<f32>(srgb_decode(c.rgb / c.a) * c.a, c.a);
    }
    return c;
}
