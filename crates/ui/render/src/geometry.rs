// SPDX-License-Identifier: Apache-2.0
//! Shared analytic geometry: the M3 rounded-rect signed distance field, an
//! analytic elevation-shadow falloff, and an SVG path flattener/rasterizer
//! for icon glyphs.
//!
//! [`sd_rounded_box`] and [`shadow_alpha`] are the *single* source of the
//! shape math: the CPU rasterizer evaluates them per pixel in Rust, and
//! `src/gpu.wgsl` re-implements the identical formulas in WGSL so both
//! backends paint the same shape within the documented pixel tolerance.

/// Signed distance from `(px, py)` to the boundary of a rounded box centred
/// at the origin with half-extents `(hw, hh)` and per-corner radii
/// `(top_left, top_right, bottom_right, bottom_left)`. Negative values are
/// inside the box; `0` is the boundary.
#[must_use]
pub fn sd_rounded_box(px: f32, py: f32, hw: f32, hh: f32, corners: (f32, f32, f32, f32)) -> f32 {
    let (tl, tr, br, bl) = corners;
    // Select the radius for the quadrant `(px, py)` falls in.
    let (rx, ry) = (if px > 0.0 { 1.0 } else { -1.0 }, if py > 0.0 { 1.0 } else { -1.0 });
    let radius = match (rx > 0.0, ry > 0.0) {
        (true, true) => br,
        (true, false) => tr,
        (false, true) => bl,
        (false, false) => tl,
    };
    let qx = px.abs() - hw + radius;
    let qy = py.abs() - hh + radius;
    qx.max(qy).min(0.0) + (qx.max(0.0).hypot(qy.max(0.0))) - radius
}

/// Analytic ambient+key shadow alpha at signed distance `d` (from
/// [`sd_rounded_box`], evaluated against the shadow's own offset box) for an
/// M3 elevation level. Approximates the M3 key+ambient shadow pair with a
/// single Gaussian falloff of blur radius `sigma`, which is smooth, cheap and
/// trivially reproducible in a fragment shader.
#[must_use]
pub fn shadow_alpha(d: f32, sigma: f32) -> f32 {
    if sigma <= 0.0 {
        return if d <= 0.0 { 1.0 } else { 0.0 };
    }
    // A logistic falloff approximates the integral of a Gaussian blur kernel
    // over a hard edge and stays numerically identical between `f32` Rust and
    // WGSL `f32` shader math (no `erf` intrinsic needed on either side).
    let x = -d / sigma;
    1.0 / (1.0 + (-x * 1.702).exp())
}

/// M3 elevation level (`0..=5`) mapped to a shadow offset (in pixels, applied
/// downward) and Gaussian blur sigma, both derived from
/// `aphrody_m3_tokens::elevation::dp` scaled by `scale` (physical pixels per
/// dp).
#[must_use]
pub fn shadow_params(level: u8, scale: f32) -> (f32, f32) {
    let dp = f32::from(aphrody_m3_tokens::facade::motion::dp(level as usize));
    let offset_y = (dp * 0.5).min(12.0) * scale;
    let sigma = (dp * 0.75 + 1.0) * scale;
    (offset_y, sigma)
}

/// A flattened, closed or open polyline in local path space.
pub type Polyline = Vec<(f32, f32)>;

/// Parse an SVG path `d` string into flattened polylines (cubic/quadratic
/// curves and elliptical arcs are subdivided into line segments). Unsupported
/// or malformed commands are skipped rather than causing a panic: icon
/// glyphs must never crash a render pass.
#[must_use]
pub fn parse_svg_path(d: &str) -> Vec<Polyline> {
    let tokens = tokenize(d);
    let mut i = 0;
    let mut subpaths = Vec::new();
    let mut current: Polyline = Vec::new();
    let mut cursor = (0.0_f32, 0.0_f32);
    let mut start = (0.0_f32, 0.0_f32);
    let mut last_cubic_ctrl: Option<(f32, f32)> = None;
    let mut last_quad_ctrl: Option<(f32, f32)> = None;
    let mut command = ' ';

    macro_rules! next_f {
        () => {{
            if i >= tokens.len() {
                break;
            }
            match tokens[i] {
                Token::Num(n) => {
                    i += 1;
                    n
                },
                Token::Cmd(_) => break,
            }
        }};
    }

    while i < tokens.len() {
        match tokens[i] {
            Token::Cmd(c) => {
                command = c;
                i += 1;
            },
            Token::Num(_) => {
                // Repeated arguments reuse the previous command letter,
                // except that a repeated M/m implicitly becomes L/l.
                if command == 'M' {
                    command = 'L';
                } else if command == 'm' {
                    command = 'l';
                }
            },
        }
        match command {
            'M' | 'm' => {
                let x = next_f!();
                let y = next_f!();
                if !current.is_empty() {
                    subpaths.push(std::mem::take(&mut current));
                }
                cursor = if command == 'm' { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                start = cursor;
                current.push(cursor);
                last_cubic_ctrl = None;
                last_quad_ctrl = None;
            },
            'L' | 'l' => {
                let x = next_f!();
                let y = next_f!();
                cursor = if command == 'l' { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                current.push(cursor);
                last_cubic_ctrl = None;
                last_quad_ctrl = None;
            },
            'H' | 'h' => {
                let x = next_f!();
                cursor.0 = if command == 'h' { cursor.0 + x } else { x };
                current.push(cursor);
                last_cubic_ctrl = None;
                last_quad_ctrl = None;
            },
            'V' | 'v' => {
                let y = next_f!();
                cursor.1 = if command == 'v' { cursor.1 + y } else { y };
                current.push(cursor);
                last_cubic_ctrl = None;
                last_quad_ctrl = None;
            },
            'C' | 'c' => {
                let (x1, y1) = (next_f!(), next_f!());
                let (x2, y2) = (next_f!(), next_f!());
                let (x, y) = (next_f!(), next_f!());
                let rel = command == 'c';
                let p1 = if rel { (cursor.0 + x1, cursor.1 + y1) } else { (x1, y1) };
                let p2 = if rel { (cursor.0 + x2, cursor.1 + y2) } else { (x2, y2) };
                let p3 = if rel { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                flatten_cubic(cursor, p1, p2, p3, &mut current);
                last_cubic_ctrl = Some(p2);
                last_quad_ctrl = None;
                cursor = p3;
            },
            'S' | 's' => {
                let (x2, y2) = (next_f!(), next_f!());
                let (x, y) = (next_f!(), next_f!());
                let rel = command == 's';
                let p1 = last_cubic_ctrl
                    .map(|(cx, cy)| (2.0 * cursor.0 - cx, 2.0 * cursor.1 - cy))
                    .unwrap_or(cursor);
                let p2 = if rel { (cursor.0 + x2, cursor.1 + y2) } else { (x2, y2) };
                let p3 = if rel { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                flatten_cubic(cursor, p1, p2, p3, &mut current);
                last_cubic_ctrl = Some(p2);
                last_quad_ctrl = None;
                cursor = p3;
            },
            'Q' | 'q' => {
                let (x1, y1) = (next_f!(), next_f!());
                let (x, y) = (next_f!(), next_f!());
                let rel = command == 'q';
                let p1 = if rel { (cursor.0 + x1, cursor.1 + y1) } else { (x1, y1) };
                let p3 = if rel { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                flatten_quad(cursor, p1, p3, &mut current);
                last_quad_ctrl = Some(p1);
                last_cubic_ctrl = None;
                cursor = p3;
            },
            'T' | 't' => {
                let (x, y) = (next_f!(), next_f!());
                let rel = command == 't';
                let p1 = last_quad_ctrl
                    .map(|(cx, cy)| (2.0 * cursor.0 - cx, 2.0 * cursor.1 - cy))
                    .unwrap_or(cursor);
                let p3 = if rel { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                flatten_quad(cursor, p1, p3, &mut current);
                last_quad_ctrl = Some(p1);
                last_cubic_ctrl = None;
                cursor = p3;
            },
            'A' | 'a' => {
                let rx = next_f!();
                let ry = next_f!();
                let rot = next_f!();
                let large_arc = next_f!() != 0.0;
                let sweep = next_f!() != 0.0;
                let x = next_f!();
                let y = next_f!();
                let rel = command == 'a';
                let end = if rel { (cursor.0 + x, cursor.1 + y) } else { (x, y) };
                flatten_arc(cursor, end, rx, ry, rot, large_arc, sweep, &mut current);
                cursor = end;
                last_cubic_ctrl = None;
                last_quad_ctrl = None;
            },
            'Z' | 'z' => {
                cursor = start;
                current.push(cursor);
                subpaths.push(std::mem::take(&mut current));
                last_cubic_ctrl = None;
                last_quad_ctrl = None;
            },
            _ => break,
        }
    }
    if !current.is_empty() {
        subpaths.push(current);
    }
    subpaths
}

enum Token {
    Cmd(char),
    Num(f32),
}

fn tokenize(d: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let bytes = d.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c.is_ascii_alphabetic() {
            out.push(Token::Cmd(c));
            i += 1;
        } else if c == ',' || c.is_whitespace() {
            i += 1;
        } else if c == '-' || c == '+' || c == '.' || c.is_ascii_digit() {
            let start = i;
            i += 1;
            let mut seen_dot = c == '.';
            while i < bytes.len() {
                let ch = bytes[i] as char;
                if ch.is_ascii_digit() {
                    i += 1;
                } else if ch == '.' && !seen_dot {
                    seen_dot = true;
                    i += 1;
                } else if (ch == 'e' || ch == 'E')
                    && i + 1 < bytes.len()
                    && (bytes[i + 1] as char == '-'
                        || bytes[i + 1] as char == '+'
                        || (bytes[i + 1] as char).is_ascii_digit())
                {
                    i += 2;
                } else if (ch == '-' || ch == '+') && start < i {
                    // A sign not directly after `e`/`E` starts a new number.
                    break;
                } else {
                    break;
                }
            }
            if let Ok(n) = d[start..i].parse::<f32>() {
                out.push(Token::Num(n));
            }
        } else {
            i += 1;
        }
    }
    out
}

fn flatten_cubic(
    p0: (f32, f32),
    p1: (f32, f32),
    p2: (f32, f32),
    p3: (f32, f32),
    out: &mut Polyline,
) {
    const STEPS: usize = 24;
    for step in 1..=STEPS {
        let t = step as f32 / STEPS as f32;
        let mt = 1.0 - t;
        let x = mt * mt * mt * p0.0
            + 3.0 * mt * mt * t * p1.0
            + 3.0 * mt * t * t * p2.0
            + t * t * t * p3.0;
        let y = mt * mt * mt * p0.1
            + 3.0 * mt * mt * t * p1.1
            + 3.0 * mt * t * t * p2.1
            + t * t * t * p3.1;
        out.push((x, y));
    }
}

fn flatten_quad(p0: (f32, f32), p1: (f32, f32), p2: (f32, f32), out: &mut Polyline) {
    const STEPS: usize = 16;
    for step in 1..=STEPS {
        let t = step as f32 / STEPS as f32;
        let mt = 1.0 - t;
        let x = mt * mt * p0.0 + 2.0 * mt * t * p1.0 + t * t * p2.0;
        let y = mt * mt * p0.1 + 2.0 * mt * t * p1.1 + t * t * p2.1;
        out.push((x, y));
    }
}

/// Endpoint-to-center elliptical arc flattening (SVG 1.1 appendix F.6),
/// subdivided into cubic Bezier segments.
#[allow(clippy::too_many_arguments)]
fn flatten_arc(
    p0: (f32, f32),
    p1: (f32, f32),
    mut rx: f32,
    mut ry: f32,
    rot_deg: f32,
    large_arc: bool,
    sweep: bool,
    out: &mut Polyline,
) {
    if rx.abs() < f32::EPSILON || ry.abs() < f32::EPSILON {
        out.push(p1);
        return;
    }
    rx = rx.abs();
    ry = ry.abs();
    let phi = rot_deg.to_radians();
    let (cos_phi, sin_phi) = (phi.cos(), phi.sin());
    let dx2 = (p0.0 - p1.0) / 2.0;
    let dy2 = (p0.1 - p1.1) / 2.0;
    let x1p = cos_phi * dx2 + sin_phi * dy2;
    let y1p = -sin_phi * dx2 + cos_phi * dy2;

    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let scale = lambda.sqrt();
        rx *= scale;
        ry *= scale;
    }

    let sign = if large_arc == sweep { -1.0 } else { 1.0 };
    let num = (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p).max(0.0);
    let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let coef = if den > 0.0 { sign * (num / den).sqrt() } else { 0.0 };
    let cxp = coef * (rx * y1p) / ry;
    let cyp = -coef * (ry * x1p) / rx;

    let cx = cos_phi * cxp - sin_phi * cyp + (p0.0 + p1.0) / 2.0;
    let cy = sin_phi * cxp + cos_phi * cyp + (p0.1 + p1.1) / 2.0;

    let angle = |ux: f32, uy: f32, vx: f32, vy: f32| -> f32 {
        let dot = ux * vx + uy * vy;
        let len = (ux * ux + uy * uy).sqrt() * (vx * vx + vy * vy).sqrt();
        let mut a = (dot / len).clamp(-1.0, 1.0).acos();
        if ux * vy - uy * vx < 0.0 {
            a = -a;
        }
        a
    };
    let theta1 = angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if !sweep && delta > 0.0 {
        delta -= std::f32::consts::TAU;
    } else if sweep && delta < 0.0 {
        delta += std::f32::consts::TAU;
    }

    const SEGMENTS: usize = 32;
    for step in 1..=SEGMENTS {
        let t = theta1 + delta * (step as f32 / SEGMENTS as f32);
        let ex = cx + rx * t.cos() * cos_phi - ry * t.sin() * sin_phi;
        let ey = cy + rx * t.cos() * sin_phi + ry * t.sin() * cos_phi;
        out.push((ex, ey));
    }
}

/// Rasterize one or more closed polylines (nonzero winding) into an alpha
/// coverage buffer of `width * height` bytes, supersampled `ss`x`ss` per
/// pixel for anti-aliasing.
#[must_use]
pub fn rasterize_polylines(polylines: &[Polyline], width: u32, height: u32, ss: u32) -> Vec<u8> {
    let ss = ss.max(1);
    let mut coverage = vec![0_u8; (width as usize) * (height as usize)];
    let max_samples = f32::from(u8::MAX) / (ss * ss) as f32;
    for py in 0..height {
        for px in 0..width {
            let mut hits = 0_u32;
            for sy in 0..ss {
                let y = py as f32 + (sy as f32 + 0.5) / ss as f32;
                for sx in 0..ss {
                    let x = px as f32 + (sx as f32 + 0.5) / ss as f32;
                    if winding_number(polylines, x, y) != 0 {
                        hits += 1;
                    }
                }
            }
            if hits > 0 {
                let idx = (py as usize) * (width as usize) + px as usize;
                coverage[idx] = (hits as f32 * max_samples).round().min(255.0) as u8;
            }
        }
    }
    coverage
}

fn winding_number(polylines: &[Polyline], x: f32, y: f32) -> i32 {
    let mut winding = 0;
    for line in polylines {
        if line.len() < 2 {
            continue;
        }
        for window in line.windows(2) {
            let (x0, y0) = window[0];
            let (x1, y1) = window[1];
            if y0 <= y {
                if y1 > y && crossing_is_left(x0, y0, x1, y1, x, y) > 0.0 {
                    winding += 1;
                }
            } else if y1 <= y && crossing_is_left(x0, y0, x1, y1, x, y) < 0.0 {
                winding -= 1;
            }
        }
    }
    winding
}

fn crossing_is_left(x0: f32, y0: f32, x1: f32, y1: f32, x: f32, y: f32) -> f32 {
    (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sd_rounded_box_center_is_negative() {
        let d = sd_rounded_box(0.0, 0.0, 10.0, 10.0, (2.0, 2.0, 2.0, 2.0));
        assert!(d < 0.0);
    }

    #[test]
    fn sd_rounded_box_far_outside_is_positive() {
        let d = sd_rounded_box(100.0, 100.0, 10.0, 10.0, (2.0, 2.0, 2.0, 2.0));
        assert!(d > 0.0);
    }

    #[test]
    fn shadow_alpha_decays_away_from_the_shape() {
        let near = shadow_alpha(-5.0, 4.0);
        let far = shadow_alpha(40.0, 4.0);
        assert!(near > far);
    }

    #[test]
    fn parses_a_simple_square_path() {
        let paths = parse_svg_path("M0 0 L10 0 L10 10 L0 10 Z");
        assert_eq!(paths.len(), 1);
        assert!(paths[0].len() >= 4);
    }

    #[test]
    fn square_path_rasterizes_to_full_interior_coverage() {
        let paths = parse_svg_path("M2 2 L18 2 L18 18 L2 18 Z");
        let coverage = rasterize_polylines(&paths, 20, 20, 4);
        let center_idx = 10 * 20 + 10;
        assert_eq!(coverage[center_idx], 255);
        let outside_idx = 0;
        assert_eq!(coverage[outside_idx], 0);
    }

    #[test]
    fn arc_command_does_not_panic_and_produces_points() {
        let paths = parse_svg_path("M12 2 A10 10 0 1 1 11.99 2 Z");
        assert!(!paths.is_empty());
        assert!(paths[0].len() > 4);
    }
}
