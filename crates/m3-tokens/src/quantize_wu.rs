// SPDX-License-Identifier: Apache-2.0
//! Wu color quantizer: exact port of `quantize/quantizer_wu.ts` from
//! [material-color-utilities] 0.4.0 (Apache-2.0).
//!
//! Divides the image's pixels into clusters by recursively cutting an RGB cube, based on the
//! weight of pixels in each area of the cube (Xiaolin Wu, *Graphic Gems II*, 1991).
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::{color_math, quantize_map::quantize_map};

const INDEX_BITS: i32 = 5;
const SIDE_LENGTH: i32 = 33; // (1 << INDEX_BITS) + 1
const TOTAL_SIZE: usize = 35937; // SIDE_LENGTH^3

#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    Red,
    Green,
    Blue,
}

#[derive(Clone, Copy, Default)]
struct Cube {
    r0: i32,
    r1: i32,
    g0: i32,
    g1: i32,
    b0: i32,
    b1: i32,
    vol: i32,
}

struct Maximize {
    cut_location: i32,
    maximum: f64,
}

/// The four accumulator arrays a moment is computed over. Borrowed together so `volume`,
/// `bottom`, `top`, `variance` and `cut` never need `&self`, which would otherwise conflict with
/// the mutable borrow of `cubes` while boxes are being split.
struct Moments<'a> {
    weights: &'a [f64],
    moments_r: &'a [f64],
    moments_g: &'a [f64],
    moments_b: &'a [f64],
    moments: &'a [f64],
}

/// Wu quantizer state, exact port of the `QuantizerWu` class.
#[derive(Default)]
pub struct QuantizerWu {
    weights: Vec<f64>,
    moments_r: Vec<f64>,
    moments_g: Vec<f64>,
    moments_b: Vec<f64>,
    moments: Vec<f64>,
    cubes: Vec<Cube>,
}

impl QuantizerWu {
    /// A fresh, empty quantizer.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Colors in ARGB format, `max_colors` is the number of colors to divide the image into (a
    /// lower number of colors may be returned).
    #[must_use]
    pub fn quantize(&mut self, pixels: &[u32], max_colors: usize) -> Vec<u32> {
        self.construct_histogram(pixels);
        self.compute_moments();
        let result_count = self.create_boxes(max_colors);
        self.create_result(result_count)
    }

    fn construct_histogram(&mut self, pixels: &[u32]) {
        self.weights = vec![0.0; TOTAL_SIZE];
        self.moments_r = vec![0.0; TOTAL_SIZE];
        self.moments_g = vec![0.0; TOTAL_SIZE];
        self.moments_b = vec![0.0; TOTAL_SIZE];
        self.moments = vec![0.0; TOTAL_SIZE];

        let count_by_color = quantize_map(pixels);
        let bits_to_remove = 8 - INDEX_BITS;
        for (pixel, count) in count_by_color {
            let count = f64::from(count);
            let red = i32::from(color_math::red(pixel));
            let green = i32::from(color_math::green(pixel));
            let blue = i32::from(color_math::blue(pixel));
            let i_r = (red >> bits_to_remove) + 1;
            let i_g = (green >> bits_to_remove) + 1;
            let i_b = (blue >> bits_to_remove) + 1;
            let index = get_index(i_r, i_g, i_b);
            self.weights[index] += count;
            self.moments_r[index] += count * f64::from(red);
            self.moments_g[index] += count * f64::from(green);
            self.moments_b[index] += count * f64::from(blue);
            self.moments[index] += count * f64::from(red * red + green * green + blue * blue);
        }
    }

    fn compute_moments(&mut self) {
        let n = SIDE_LENGTH as usize;
        for r in 1..n {
            let mut area = vec![0.0f64; n];
            let mut area_r = vec![0.0f64; n];
            let mut area_g = vec![0.0f64; n];
            let mut area_b = vec![0.0f64; n];
            let mut area2 = vec![0.0f64; n];
            for g in 1..n {
                let mut line = 0.0f64;
                let mut line_r = 0.0f64;
                let mut line_g = 0.0f64;
                let mut line_b = 0.0f64;
                let mut line2 = 0.0f64;
                for b in 1..n {
                    let index = get_index(r as i32, g as i32, b as i32);
                    line += self.weights[index];
                    line_r += self.moments_r[index];
                    line_g += self.moments_g[index];
                    line_b += self.moments_b[index];
                    line2 += self.moments[index];

                    area[b] += line;
                    area_r[b] += line_r;
                    area_g[b] += line_g;
                    area_b[b] += line_b;
                    area2[b] += line2;

                    let previous_index = get_index(r as i32 - 1, g as i32, b as i32);
                    self.weights[index] = self.weights[previous_index] + area[b];
                    self.moments_r[index] = self.moments_r[previous_index] + area_r[b];
                    self.moments_g[index] = self.moments_g[previous_index] + area_g[b];
                    self.moments_b[index] = self.moments_b[previous_index] + area_b[b];
                    self.moments[index] = self.moments[previous_index] + area2[b];
                }
            }
        }
    }

    fn create_boxes(&mut self, max_colors: usize) -> usize {
        self.cubes = vec![Cube::default(); max_colors.max(1)];
        let mut volume_variance = vec![0.0f64; max_colors.max(1)];
        self.cubes[0] = Cube {
            r0: 0,
            g0: 0,
            b0: 0,
            r1: SIDE_LENGTH - 1,
            g1: SIDE_LENGTH - 1,
            b1: SIDE_LENGTH - 1,
            vol: 0,
        };

        let m = Moments {
            weights: &self.weights,
            moments_r: &self.moments_r,
            moments_g: &self.moments_g,
            moments_b: &self.moments_b,
            moments: &self.moments,
        };

        let mut generated_color_count = max_colors;
        let mut next = 0usize;
        let mut i = 1usize;
        while i < max_colors {
            let (one, two) = split_at_mut_pair(&mut self.cubes, next, i);
            let did_cut = cut(&m, one, two);
            if did_cut {
                volume_variance[next] = if one.vol > 1 { variance(&m, one) } else { 0.0 };
                volume_variance[i] = if two.vol > 1 { variance(&m, two) } else { 0.0 };
            } else {
                volume_variance[next] = 0.0;
                i = i.wrapping_sub(1);
            }

            next = 0;
            let mut temp = volume_variance[0];
            for (j, &variance) in volume_variance.iter().enumerate().take(i + 1).skip(1) {
                if variance > temp {
                    temp = variance;
                    next = j;
                }
            }
            if temp <= 0.0 {
                generated_color_count = i + 1;
                break;
            }
            i = i.wrapping_add(1);
        }
        generated_color_count
    }

    fn create_result(&self, color_count: usize) -> Vec<u32> {
        let m = Moments {
            weights: &self.weights,
            moments_r: &self.moments_r,
            moments_g: &self.moments_g,
            moments_b: &self.moments_b,
            moments: &self.moments,
        };
        let mut colors = Vec::new();
        for cube in &self.cubes[..color_count] {
            let weight = volume(cube, m.weights);
            if weight > 0.0 {
                let r = color_math::js_round(volume(cube, m.moments_r) / weight) as i32;
                let g = color_math::js_round(volume(cube, m.moments_g) / weight) as i32;
                let b = color_math::js_round(volume(cube, m.moments_b) / weight) as i32;
                let color = 0xFF00_0000u32
                    | ((r as u32 & 0xFF) << 16)
                    | ((g as u32 & 0xFF) << 8)
                    | (b as u32 & 0xFF);
                colors.push(color);
            }
        }
        colors
    }
}

fn variance(m: &Moments<'_>, cube: &Cube) -> f64 {
    let dr = volume(cube, m.moments_r);
    let dg = volume(cube, m.moments_g);
    let db = volume(cube, m.moments_b);
    let xx = m.moments[get_index(cube.r1, cube.g1, cube.b1)]
        - m.moments[get_index(cube.r1, cube.g1, cube.b0)]
        - m.moments[get_index(cube.r1, cube.g0, cube.b1)]
        + m.moments[get_index(cube.r1, cube.g0, cube.b0)]
        - m.moments[get_index(cube.r0, cube.g1, cube.b1)]
        + m.moments[get_index(cube.r0, cube.g1, cube.b0)]
        + m.moments[get_index(cube.r0, cube.g0, cube.b1)]
        - m.moments[get_index(cube.r0, cube.g0, cube.b0)];
    let hypotenuse = dr * dr + dg * dg + db * db;
    let vol = volume(cube, m.weights);
    xx - hypotenuse / vol
}

fn cut(m: &Moments<'_>, one: &mut Cube, two: &mut Cube) -> bool {
    let whole_r = volume(one, m.moments_r);
    let whole_g = volume(one, m.moments_g);
    let whole_b = volume(one, m.moments_b);
    let whole_w = volume(one, m.weights);

    let max_r_result = maximize(
        m,
        one,
        Direction::Red,
        one.r0 + 1,
        one.r1,
        whole_r,
        whole_g,
        whole_b,
        whole_w,
    );
    let max_g_result = maximize(
        m,
        one,
        Direction::Green,
        one.g0 + 1,
        one.g1,
        whole_r,
        whole_g,
        whole_b,
        whole_w,
    );
    let max_b_result = maximize(
        m,
        one,
        Direction::Blue,
        one.b0 + 1,
        one.b1,
        whole_r,
        whole_g,
        whole_b,
        whole_w,
    );

    let max_r = max_r_result.maximum;
    let max_g = max_g_result.maximum;
    let max_b = max_b_result.maximum;

    let direction = if max_r >= max_g && max_r >= max_b {
        if max_r_result.cut_location < 0 {
            return false;
        }
        Direction::Red
    } else if max_g >= max_r && max_g >= max_b {
        Direction::Green
    } else {
        Direction::Blue
    };

    two.r1 = one.r1;
    two.g1 = one.g1;
    two.b1 = one.b1;

    match direction {
        Direction::Red => {
            one.r1 = max_r_result.cut_location;
            two.r0 = one.r1;
            two.g0 = one.g0;
            two.b0 = one.b0;
        }
        Direction::Green => {
            one.g1 = max_g_result.cut_location;
            two.r0 = one.r0;
            two.g0 = one.g1;
            two.b0 = one.b0;
        }
        Direction::Blue => {
            one.b1 = max_b_result.cut_location;
            two.r0 = one.r0;
            two.g0 = one.g0;
            two.b0 = one.b1;
        }
    }

    one.vol = (one.r1 - one.r0) * (one.g1 - one.g0) * (one.b1 - one.b0);
    two.vol = (two.r1 - two.r0) * (two.g1 - two.g0) * (two.b1 - two.b0);
    true
}

#[allow(clippy::too_many_arguments)]
fn maximize(
    m: &Moments<'_>,
    cube: &Cube,
    direction: Direction,
    first: i32,
    last: i32,
    whole_r: f64,
    whole_g: f64,
    whole_b: f64,
    whole_w: f64,
) -> Maximize {
    let bottom_r = bottom(cube, direction, m.moments_r);
    let bottom_g = bottom(cube, direction, m.moments_g);
    let bottom_b = bottom(cube, direction, m.moments_b);
    let bottom_w = bottom(cube, direction, m.weights);

    let mut max = 0.0f64;
    let mut cut_at = -1i32;

    let mut i = first;
    while i < last {
        let mut half_r = bottom_r + top(cube, direction, i, m.moments_r);
        let mut half_g = bottom_g + top(cube, direction, i, m.moments_g);
        let mut half_b = bottom_b + top(cube, direction, i, m.moments_b);
        let mut half_w = bottom_w + top(cube, direction, i, m.weights);

        if half_w != 0.0 {
            let mut temp = (half_r * half_r + half_g * half_g + half_b * half_b) / half_w;

            half_r = whole_r - half_r;
            half_g = whole_g - half_g;
            half_b = whole_b - half_b;
            half_w = whole_w - half_w;

            if half_w != 0.0 {
                temp += (half_r * half_r + half_g * half_g + half_b * half_b) / half_w;
                if temp > max {
                    max = temp;
                    cut_at = i;
                }
            }
        }
        i += 1;
    }
    Maximize {
        cut_location: cut_at,
        maximum: max,
    }
}

fn volume(cube: &Cube, moment: &[f64]) -> f64 {
    moment[get_index(cube.r1, cube.g1, cube.b1)]
        - moment[get_index(cube.r1, cube.g1, cube.b0)]
        - moment[get_index(cube.r1, cube.g0, cube.b1)]
        + moment[get_index(cube.r1, cube.g0, cube.b0)]
        - moment[get_index(cube.r0, cube.g1, cube.b1)]
        + moment[get_index(cube.r0, cube.g1, cube.b0)]
        + moment[get_index(cube.r0, cube.g0, cube.b1)]
        - moment[get_index(cube.r0, cube.g0, cube.b0)]
}

fn bottom(cube: &Cube, direction: Direction, moment: &[f64]) -> f64 {
    match direction {
        Direction::Red => {
            -moment[get_index(cube.r0, cube.g1, cube.b1)]
                + moment[get_index(cube.r0, cube.g1, cube.b0)]
                + moment[get_index(cube.r0, cube.g0, cube.b1)]
                - moment[get_index(cube.r0, cube.g0, cube.b0)]
        }
        Direction::Green => {
            -moment[get_index(cube.r1, cube.g0, cube.b1)]
                + moment[get_index(cube.r1, cube.g0, cube.b0)]
                + moment[get_index(cube.r0, cube.g0, cube.b1)]
                - moment[get_index(cube.r0, cube.g0, cube.b0)]
        }
        Direction::Blue => {
            -moment[get_index(cube.r1, cube.g1, cube.b0)]
                + moment[get_index(cube.r1, cube.g0, cube.b0)]
                + moment[get_index(cube.r0, cube.g1, cube.b0)]
                - moment[get_index(cube.r0, cube.g0, cube.b0)]
        }
    }
}

fn top(cube: &Cube, direction: Direction, position: i32, moment: &[f64]) -> f64 {
    match direction {
        Direction::Red => {
            moment[get_index(position, cube.g1, cube.b1)]
                - moment[get_index(position, cube.g1, cube.b0)]
                - moment[get_index(position, cube.g0, cube.b1)]
                + moment[get_index(position, cube.g0, cube.b0)]
        }
        Direction::Green => {
            moment[get_index(cube.r1, position, cube.b1)]
                - moment[get_index(cube.r1, position, cube.b0)]
                - moment[get_index(cube.r0, position, cube.b1)]
                + moment[get_index(cube.r0, position, cube.b0)]
        }
        Direction::Blue => {
            moment[get_index(cube.r1, cube.g1, position)]
                - moment[get_index(cube.r1, cube.g0, position)]
                - moment[get_index(cube.r0, cube.g1, position)]
                + moment[get_index(cube.r0, cube.g0, position)]
        }
    }
}

const fn get_index(r: i32, g: i32, b: i32) -> usize {
    ((r << (INDEX_BITS * 2)) + (r << (INDEX_BITS + 1)) + r + (g << INDEX_BITS) + g + b) as usize
}

/// Splits `cubes` into two disjoint mutable references at indices `a` and `b` (`a != b`, either
/// order — the reference always calls `cut(cubes[next], cubes[i])` with `next <= i`, `next`
/// starting at `0` and `i` starting at `1`).
fn split_at_mut_pair<T>(slice: &mut [T], a: usize, b: usize) -> (&mut T, &mut T) {
    assert_ne!(a, b, "quantizer_wu: cut() never targets the same box twice");
    if a < b {
        let (left, right) = slice.split_at_mut(b);
        (&mut left[a], &mut right[0])
    } else {
        let (left, right) = slice.split_at_mut(a);
        (&mut right[0], &mut left[b])
    }
}
