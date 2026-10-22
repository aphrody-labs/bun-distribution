// Display filters for the machine picture (Bun Engine). Written for Bun Engine; no third-party
// shader code. One fullscreen-quad material over the `MachineScreen` image.
import bevy_sprite_render::mesh2d::vertex_output::VertexOutput;

// x: mode (0 plain, 1 scanlines, 2 crt, 3 lcd, 4 sharp bilinear), y: output pixels per source
// pixel, z: strength 0..1, w: unused.
@group(constants::MATERIAL_BIND_GROUP) @binding(0) var<uniform> params: vec4<f32>;
// xy: source size in pixels.
@group(constants::MATERIAL_BIND_GROUP) @binding(1) var<uniform> source_size: vec4<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(2) var screen: texture_2d<f32>;

fn texel(p: vec2<i32>) -> vec3<f32> {
    let size = vec2<i32>(source_size.xy);
    return textureLoad(screen, clamp(p, vec2<i32>(0), size - vec2<i32>(1)), 0).rgb;
}

// Nearest sample at a position in source pixels.
fn nearest(pos: vec2<f32>) -> vec3<f32> {
    return texel(vec2<i32>(floor(pos)));
}

// Bilinear sample whose blend is confined to the texel borders (crisp at integer scales).
fn sharp_bilinear(pos: vec2<f32>, scale: f32) -> vec3<f32> {
    let u = pos - vec2<f32>(0.5);
    let base = floor(u);
    let f = clamp((u - base - vec2<f32>(0.5)) * max(scale, 1.0) + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(1.0));
    let i = vec2<i32>(base);
    let top = mix(texel(i), texel(i + vec2<i32>(1, 0)), f.x);
    let bottom = mix(texel(i + vec2<i32>(0, 1)), texel(i + vec2<i32>(1, 1)), f.x);
    return mix(top, bottom, f.y);
}

fn scanline(pos: vec2<f32>, strength: f32) -> f32 {
    let d = abs(fract(pos.y) - 0.5) * 2.0;
    return (1.0 - strength * d * d) * (1.0 + strength * 0.3);
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let mode = u32(params.x + 0.5);
    let scale = params.y;
    let strength = clamp(params.z, 0.0, 1.0);
    var uv = in.uv;
    let pos = uv * source_size.xy;
    var rgb = nearest(pos);

    if mode == 1u {
        rgb = nearest(pos) * scanline(pos, strength);
    } else if mode == 2u {
        // Barrel curvature, soft horizontal sampling, scanlines, phosphor triads, vignette.
        let c = uv * 2.0 - vec2<f32>(1.0);
        let w = c * (vec2<f32>(1.0) + 0.04 * strength * vec2<f32>(c.y * c.y, c.x * c.x));
        let warped = (w * 0.5 + vec2<f32>(0.5)) * source_size.xy;
        if any(abs(w) > vec2<f32>(1.0)) {
            return vec4<f32>(0.0, 0.0, 0.0, 1.0);
        }
        var col = sharp_bilinear(warped, scale) * scanline(warped, strength);
        let column = u32(in.position.x) % 3u;
        var mask = vec3<f32>(1.0 - 0.45 * strength);
        mask[column] = 1.0 + 0.15 * strength;
        col = col * mask;
        let vig = 1.0 - 0.25 * strength * dot(w, w);
        rgb = col * vig;
    } else if mode == 3u {
        // LCD grid: each source pixel is a cell with a dark border.
        let f = fract(pos);
        let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        let cell = mix(1.0 - 0.6 * strength, 1.0, smoothstep(0.0, 0.18, edge));
        rgb = nearest(pos) * cell * (1.0 + 0.15 * strength);
    } else if mode == 4u {
        rgb = sharp_bilinear(pos, scale);
    }
    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
