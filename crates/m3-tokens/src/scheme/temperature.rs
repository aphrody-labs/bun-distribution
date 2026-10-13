// SPDX-License-Identifier: Apache-2.0
//! Colour temperature and dislike analyses of the Content and Fidelity variants.
//!
//! Exact ports of `temperature/temperature_cache.ts` and `dislike/dislike_analyzer.ts` of
//! material-color-utilities 0.4.0 (Apache-2.0).

use crate::{
    color_math::{js_round, lab_from_argb, sanitize_degrees, sanitize_degrees_int},
    hct::Hct,
};

const HUES: usize = 361;

/// `DislikeAnalyzer.isDisliked`: a dark, non-neutral yellow-green.
pub(super) fn is_disliked(hct: &Hct) -> bool {
    let hue = js_round(hct.hue);
    (90.0..=111.0).contains(&hue) && js_round(hct.chroma) > 16.0 && js_round(hct.tone) < 65.0
}

/// `DislikeAnalyzer.fixIfDisliked`: a disliked colour lightened to tone 70.
pub(super) fn fix_if_disliked(hct: Hct) -> Hct {
    if is_disliked(&hct) {
        Hct::new(hct.hue, hct.chroma, 70.0)
    } else {
        hct
    }
}

/// `TemperatureCache.rawTemperature`: below 0 cool, above 0 warm.
fn raw_temperature(color: &Hct) -> f64 {
    let lab = lab_from_argb(color.to_argb());
    let hue = sanitize_degrees(lab[2].atan2(lab[1]) * 180.0 / core::f64::consts::PI);
    let chroma = (lab[1] * lab[1] + lab[2] * lab[2]).sqrt();
    -0.5 + 0.02
        * chroma.powf(1.07)
        * (sanitize_degrees(hue - 50.0) * core::f64::consts::PI / 180.0).cos()
}

/// `TemperatureCache.isBetween`: whether `angle` lies clockwise from `a` to `b`.
fn is_between(angle: f64, a: f64, b: f64) -> bool {
    if a < b {
        a <= angle && angle <= b
    } else {
        a <= angle || angle <= b
    }
}

/// The colours of every hue at the input's chroma and tone, with their temperatures.
pub(super) struct TemperatureCache {
    input: Hct,
    by_hue: [Hct; HUES],
    temps: [f64; HUES],
    input_temp: f64,
    /// Index into `by_hue` of the coldest colour, `HUES` for the input itself.
    coldest: usize,
    warmest: usize,
}

impl TemperatureCache {
    pub(super) fn new(input: Hct) -> Self {
        let by_hue: [Hct; HUES] =
            core::array::from_fn(|hue| Hct::new(hue as f64, input.chroma, input.tone));
        let temps: [f64; HUES] = core::array::from_fn(|i| raw_temperature(&by_hue[i]));
        let input_temp = raw_temperature(&input);
        // A stable ascending sort of `by_hue` then the input: the coldest is the first minimum,
        // the warmest the last maximum.
        let temp_of = |i: usize| if i == HUES { input_temp } else { temps[i] };
        let (mut coldest, mut warmest) = (0, 0);
        for i in 1..=HUES {
            if temp_of(i) < temp_of(coldest) {
                coldest = i;
            }
            if temp_of(i) >= temp_of(warmest) {
                warmest = i;
            }
        }
        Self {
            input,
            by_hue,
            temps,
            input_temp,
            coldest,
            warmest,
        }
    }

    fn color(&self, i: usize) -> Hct {
        if i == HUES {
            self.input
        } else {
            self.by_hue[i]
        }
    }

    fn temp(&self, i: usize) -> f64 {
        if i == HUES {
            self.input_temp
        } else {
            self.temps[i]
        }
    }

    fn relative_temperature(&self, i: usize) -> f64 {
        let range = self.temp(self.warmest) - self.temp(self.coldest);
        if range == 0.0 {
            0.5
        } else {
            (self.temp(i) - self.temp(self.coldest)) / range
        }
    }

    /// `TemperatureCache.complement`.
    pub(super) fn complement(&self) -> Hct {
        let coldest_hue = self.color(self.coldest).hue;
        let coldest_temp = self.temp(self.coldest);
        let warmest_hue = self.color(self.warmest).hue;
        let range = self.temp(self.warmest) - coldest_temp;
        let start_is_coldest_to_warmest = is_between(self.input.hue, coldest_hue, warmest_hue);
        let (start_hue, end_hue) = if start_is_coldest_to_warmest {
            (warmest_hue, coldest_hue)
        } else {
            (coldest_hue, warmest_hue)
        };
        let mut smallest_error = 1000.0;
        let mut answer = js_round(self.input.hue) as usize;
        let complement_relative_temp = 1.0 - self.relative_temperature(HUES);
        let mut hue_addend = 0.0;
        while hue_addend <= 360.0 {
            let hue = sanitize_degrees(start_hue + hue_addend);
            hue_addend += 1.0;
            if !is_between(hue, start_hue, end_hue) {
                continue;
            }
            let index = js_round(hue) as usize;
            let relative_temp = (self.temps[index] - coldest_temp) / range;
            let error = (complement_relative_temp - relative_temp).abs();
            if error < smallest_error {
                smallest_error = error;
                answer = index;
            }
        }
        self.by_hue[answer]
    }

    /// `TemperatureCache.analogous(count, divisions)`, for `count <= 5` and `divisions <= 12`.
    /// Returns the colours and how many are meaningful.
    pub(super) fn analogous(&self, count: usize, divisions: usize) -> ([Hct; 5], usize) {
        assert!(count <= 5 && (1..=12).contains(&divisions));
        let start_hue = js_round(self.input.hue) as i32;
        let start = start_hue as usize;
        let hue_index = |offset: i32| sanitize_degrees_int(start_hue + offset) as usize;
        let mut last_temp = self.relative_temperature(start);
        // Indices into `by_hue`.
        let mut all = [start; 12];
        let mut len = 1;
        let mut absolute_total_temp_delta = 0.0;
        for i in 0..360 {
            let temp = self.relative_temperature(hue_index(i));
            absolute_total_temp_delta += (temp - last_temp).abs();
            last_temp = temp;
        }
        let mut hue_addend = 1;
        let temp_step = absolute_total_temp_delta / divisions as f64;
        let mut total_temp_delta = 0.0;
        last_temp = self.relative_temperature(start);
        while len < divisions {
            let index = hue_index(hue_addend);
            let temp = self.relative_temperature(index);
            total_temp_delta += (temp - last_temp).abs();
            let mut satisfied = total_temp_delta >= len as f64 * temp_step;
            let mut index_addend = 1.0;
            while satisfied && len < divisions {
                all[len] = index;
                len += 1;
                satisfied = total_temp_delta >= (len as f64 + index_addend) * temp_step;
                index_addend += 1.0;
            }
            last_temp = temp;
            hue_addend += 1;
            if hue_addend > 360 {
                while len < divisions {
                    all[len] = index;
                    len += 1;
                }
                break;
            }
        }
        let wrap = |i: isize| all[i.rem_euclid(len as isize) as usize];
        let increase = (count - 1) / 2;
        let decrease = count - increase - 1;
        let mut answers = [self.input; 5];
        let mut n = 0;
        for i in (1..=increase).rev() {
            answers[n] = self.by_hue[wrap(-(i as isize))];
            n += 1;
        }
        answers[n] = self.input;
        n += 1;
        for i in 1..=decrease {
            answers[n] = self.by_hue[wrap(i as isize)];
            n += 1;
        }
        (answers, n)
    }
}
