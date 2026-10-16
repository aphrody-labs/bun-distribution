// SPDX-License-Identifier: Apache-2.0
// Analytic M3 shape math, mirroring `src/geometry.rs` exactly so the CPU and
// GPU backends stay within the documented per-pixel tolerance.

struct Globals {
    canvas_size: vec2<f32>,
    _pad: vec2<f32>,
}

struct Shape {
    // xy = center in pixels, zw = half-extent in pixels.
    center_half_extent: vec4<f32>,
    // corner radii: top-left, top-right, bottom-right, bottom-left.
    corners: vec4<f32>,
    color: vec4<f32>,
    // x = kind (0 = fill, 1 = shadow, 2 = stroke), y = stroke width or sigma,
    // z = shadow y-offset, w unused.
    params: vec4<f32>,
}

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> shape: Shape;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
}

@vertex
fn vs_shape(@builtin(vertex_index) idx: u32) -> VertexOut {
    // Full-canvas triangle strip; the fragment shader evaluates the SDF, so
    // there is no benefit to a tight per-instance quad for correctness.
    var positions = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
    );
    let uv = positions[idx];
    let pixel = uv * globals.canvas_size;
    var out: VertexOut;
    out.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.local = pixel;
    return out;
}

fn sd_rounded_box(p: vec2<f32>, half_extent: vec2<f32>, corners: vec4<f32>) -> f32 {
    let rx = select(-1.0, 1.0, p.x > 0.0);
    let ry = select(-1.0, 1.0, p.y > 0.0);
    var radius: f32;
    if (rx > 0.0 && ry > 0.0) {
        radius = corners.z; // bottom-right
    } else if (rx > 0.0 && ry <= 0.0) {
        radius = corners.y; // top-right
    } else if (rx <= 0.0 && ry > 0.0) {
        radius = corners.w; // bottom-left
    } else {
        radius = corners.x; // top-left
    }
    let q = abs(p) - half_extent + vec2<f32>(radius, radius);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - radius;
}

fn shadow_alpha(d: f32, sigma: f32) -> f32 {
    if (sigma <= 0.0) {
        return select(0.0, 1.0, d <= 0.0);
    }
    let x = -d / sigma;
    return 1.0 / (1.0 + exp(-x * 1.702));
}

@fragment
fn fs_shape(in: VertexOut) -> @location(0) vec4<f32> {
    let center = shape.center_half_extent.xy;
    let half_extent = shape.center_half_extent.zw;
    var p = in.local - center;
    let kind = shape.params.x;
    if (kind == 1.0) {
        p.y -= shape.params.z;
    }
    let d = sd_rounded_box(p, half_extent, shape.corners);
    var coverage: f32;
    if (kind == 1.0) {
        coverage = shadow_alpha(d, shape.params.y);
    } else if (kind == 2.0) {
        coverage = clamp(0.5 - (abs(d) - shape.params.y * 0.5), 0.0, 1.0);
    } else {
        coverage = clamp(0.5 - d, 0.0, 1.0);
    }
    if (coverage <= 0.0) {
        discard;
    }
    return vec4<f32>(shape.color.rgb, shape.color.a * coverage);
}

// --- Textured coverage pass (text, icons, images baked to RGBA on the CPU) ---

struct TexParams {
    // xy = destination origin in pixels, zw = destination size in pixels.
    dest: vec4<f32>,
    tint: vec4<f32>,
    // x = 1.0 for single-channel coverage tinted by `tint`, 0.0 for a
    // pre-composited RGBA source (images).
    mode: vec4<f32>,
}

@group(0) @binding(2) var<uniform> tex_params: TexParams;
@group(0) @binding(3) var tex_sampler: sampler;
@group(0) @binding(4) var tex: texture_2d<f32>;

@vertex
fn vs_tex(@builtin(vertex_index) idx: u32) -> VertexOut {
    var positions = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
    );
    let uv = positions[idx];
    let pixel = tex_params.dest.xy + uv * tex_params.dest.zw;
    var out: VertexOut;
    out.position = vec4<f32>(
        pixel.x / globals.canvas_size.x * 2.0 - 1.0,
        1.0 - pixel.y / globals.canvas_size.y * 2.0,
        0.0,
        1.0,
    );
    out.local = uv;
    return out;
}

@fragment
fn fs_tex(in: VertexOut) -> @location(0) vec4<f32> {
    let sample = textureSample(tex, tex_sampler, in.local);
    if (tex_params.mode.x > 0.5) {
        let a = sample.r * tex_params.tint.a;
        if (a <= 0.0) {
            discard;
        }
        return vec4<f32>(tex_params.tint.rgb, a);
    }
    if (sample.a <= 0.0) {
        discard;
    }
    return sample;
}
