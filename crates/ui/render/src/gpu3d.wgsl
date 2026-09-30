// SPDX-License-Identifier: Apache-2.0
// Instanced M3 PBR mesh pipeline. Mirrors `src/raster3d.rs` (`shade`) line by
// line so the CPU reference and this GPU backend stay within the documented
// per-pixel tolerance.

const PI: f32 = 3.14159265358979323846;
const MAX_LIGHTS: u32 = 16u;

struct Light {
    // xyz = unit direction towards the light (w = 0) or position (w = 1).
    vector_kind: vec4<f32>,
    // rgb = linear radiance, a = range (0 = unbounded).
    radiance_range: vec4<f32>,
}

const NO_SHADOW: u32 = 0xffffffffu;

// Set by the host for sRGB colour targets: the hardware encodes, so the
// shader outputs linear light (see `Renderer3d::render_to_view`).
override OUTPUT_LINEAR: bool = false;

struct Globals {
    view_proj: mat4x4<f32>,
    // Orthographic light projection * view of the shadow-casting light.
    light_vp: mat4x4<f32>,
    eye: vec4<f32>,
    // rgb = ambient radiance seen by upward (sky) and downward (ground)
    // normals.
    sky: vec4<f32>,
    ground: vec4<f32>,
    // x = normal offset (world), y = depth bias, z = shadow-map resolution.
    shadow: vec4<f32>,
    // x = light count, y = shadow light index (NO_SHADOW when disabled).
    counts: vec4<u32>,
    lights: array<Light, 16>,
}

@group(0) @binding(0) var<uniform> g: Globals;
@group(1) @binding(0) var shadow_map: texture_depth_2d;

struct VertexIn {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) m0: vec4<f32>,
    @location(3) m1: vec4<f32>,
    @location(4) m2: vec4<f32>,
    @location(5) m3: vec4<f32>,
    @location(6) n0: vec4<f32>,
    @location(7) n1: vec4<f32>,
    @location(8) n2: vec4<f32>,
    // rgb = linear base colour, a = alpha.
    @location(9) base: vec4<f32>,
    // rgb = linear emissive, a = unlit flag.
    @location(10) emissive: vec4<f32>,
    // x = metallic, y = roughness.
    @location(11) params: vec4<f32>,
}

struct VertexOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) @interpolate(flat) base: vec4<f32>,
    @location(3) @interpolate(flat) emissive: vec4<f32>,
    @location(4) @interpolate(flat) params: vec4<f32>,
}

@vertex
fn vs_main(v: VertexIn) -> VertexOut {
    let model = mat4x4<f32>(v.m0, v.m1, v.m2, v.m3);
    let normal_matrix = mat3x3<f32>(v.n0.xyz, v.n1.xyz, v.n2.xyz);
    // Same association as the CPU: (view_proj * model) * position.
    let mvp = g.view_proj * model;
    var out: VertexOut;
    out.clip = mvp * vec4<f32>(v.position, 1.0);
    out.world = (model * vec4<f32>(v.position, 1.0)).xyz;
    out.normal = normal_matrix * v.normal;
    out.base = v.base;
    out.emissive = v.emissive;
    out.params = v.params;
    return out;
}

fn linear_to_srgb(c: f32) -> f32 {
    let x = clamp(c, 0.0, 1.0);
    return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, x * 12.92, x <= 0.0031308);
}

fn normalize_or(v: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
    let len = length(v);
    return select(fallback, v / len, len > 1e-12);
}

fn lerp3(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> {
    return a + (b - a) * t;
}

// Mirrors `raster3d::shadow_visibility`: 3x3 PCF over exact texel loads.
fn shadow_visibility(world: vec3<f32>, n: vec3<f32>) -> f32 {
    let p = world + n * g.shadow.x;
    let c = g.light_vp * vec4<f32>(p, 1.0);
    let u = c.x / c.w * 0.5 + 0.5;
    let v = 0.5 - c.y / c.w * 0.5;
    let z = c.z / c.w;
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
        return 1.0;
    }
    // Receivers beyond the casters' far plane are still behind them.
    let reference = min(z, 1.0) - g.shadow.y;
    let res = i32(g.shadow.z);
    let tx = i32(floor(u * f32(res)));
    let ty = i32(floor(v * f32(res)));
    var lit = 0u;
    for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
            let x = clamp(tx + dx, 0, res - 1);
            let y = clamp(ty + dy, 0, res - 1);
            if (reference <= textureLoad(shadow_map, vec2<i32>(x, y), 0)) {
                lit = lit + 1u;
            }
        }
    }
    return f32(lit) / 9.0;
}

fn shade(base: vec3<f32>, emissive: vec3<f32>, metallic: f32, roughness: f32, world: vec3<f32>, n: vec3<f32>, shadow: f32) -> vec3<f32> {
    let v = normalize_or(g.eye.xyz - world, n);
    let rough = max(roughness, 0.045);
    let a = rough * rough;
    let a2 = a * a;
    let f0 = lerp3(vec3<f32>(0.04), base, metallic);
    let ndv = max(dot(n, v), 1e-4);

    // Hemisphere ambient + environment specular (see `raster3d::shade`).
    let irradiance = lerp3(g.ground.rgb, g.sky.rgb, n.y * 0.5 + 0.5);
    let r = n * (2.0 * dot(n, v)) - v;
    let reflected = lerp3(g.ground.rgb, g.sky.rgb, r.y * 0.5 + 0.5);
    let env = lerp3(reflected, irradiance, rough);
    let xv = 1.0 - ndv;
    let xv5 = xv * xv * xv * xv * xv;
    let f_max = max(vec3<f32>(1.0 - rough), f0);
    let f_env = f0 + (f_max - f0) * xv5;
    var out = irradiance * base * (vec3<f32>(1.0) - f_env) * (1.0 - metallic) + env * f_env;

    let k = (rough + 1.0) * (rough + 1.0) / 8.0;
    let gv = ndv / (ndv * (1.0 - k) + k);
    let count = min(g.counts.x, MAX_LIGHTS);
    for (var i = 0u; i < count; i = i + 1u) {
        let light = g.lights[i];
        var l: vec3<f32>;
        var radiance = light.radiance_range.rgb;
        if (light.vector_kind.w < 0.5) {
            l = light.vector_kind.xyz;
        } else {
            let d = light.vector_kind.xyz - world;
            let dist2 = max(dot(d, d), 1e-8);
            let dist = sqrt(dist2);
            var att = 1.0 / max(dist2, 1e-4);
            let range = light.radiance_range.a;
            if (range > 0.0) {
                let x = dist / range;
                let x4 = x * x * x * x;
                let f = clamp(1.0 - x4, 0.0, 1.0);
                att = att * f * f;
            }
            l = d * (1.0 / dist);
            radiance = radiance * att;
        }
        if (i == g.counts.y) {
            radiance = radiance * shadow;
        }
        let ndl = dot(n, l);
        if (ndl <= 0.0) {
            continue;
        }
        let h = normalize_or(v + l, n);
        let ndh = max(dot(n, h), 0.0);
        let vdh = max(dot(v, h), 0.0);
        let dd = ndh * ndh * (a2 - 1.0) + 1.0;
        let d_term = a2 / (PI * dd * dd);
        let gg = gv * (ndl / (ndl * (1.0 - k) + k));
        let x = 1.0 - vdh;
        let x5 = x * x * x * x * x;
        let f = f0 + (vec3<f32>(1.0) - f0) * x5;
        let spec = f * (d_term * gg / (4.0 * ndv * ndl + 1e-4));
        let kd = (vec3<f32>(1.0) - f) * (1.0 - metallic);
        let diffuse = kd * base * (1.0 / PI);
        out = out + (diffuse + spec) * radiance * ndl;
    }
    return out + emissive;
}

@fragment
fn fs_main(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    var rgb: vec3<f32>;
    if (in.emissive.a > 0.5) {
        rgb = in.base.rgb;
    } else {
        var n = normalize_or(in.normal, vec3<f32>(0.0, 1.0, 0.0));
        if (!front) {
            n = -n;
        }
        var visibility = 1.0;
        if (g.counts.y != NO_SHADOW) {
            visibility = shadow_visibility(in.world, n);
        }
        rgb = shade(in.base.rgb, in.emissive.rgb, in.params.x, in.params.y, in.world, n, visibility);
    }
    if (OUTPUT_LINEAR) {
        return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), in.base.a);
    }
    return vec4<f32>(linear_to_srgb(rgb.r), linear_to_srgb(rgb.g), linear_to_srgb(rgb.b), in.base.a);
}

// Depth-only shadow pass from the shadow-casting light.
@vertex
fn vs_shadow(v: VertexIn) -> @builtin(position) vec4<f32> {
    let model = mat4x4<f32>(v.m0, v.m1, v.m2, v.m3);
    let mvp = g.light_vp * model;
    return mvp * vec4<f32>(v.position, 1.0);
}
