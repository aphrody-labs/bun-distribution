//! Small deterministic PRNG (SplitMix64). Determinism matters: level
//! assignment and synthetic benchmark data must be reproducible from a seed.

/// SplitMix64 generator (Steele, Lea, Flood 2014). Passes BigCrush and is
/// more than good enough for level sampling and synthetic data.
#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn state(&self) -> u64 {
        self.state
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform sample in the half-open interval (0, 1].
    #[inline]
    pub fn next_open01(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64 + 1.0) / (1u64 << 53) as f64
    }

    /// Uniform integer in `0..n` (n > 0). Slight modulo bias is irrelevant here.
    #[inline]
    pub fn below(&mut self, n: u64) -> u64 {
        ((self.next_u64() as u128 * n as u128) >> 64) as u64
    }

    /// Standard normal sample via Box-Muller (one of the pair is discarded to
    /// keep the generator stateless apart from `state`).
    #[inline]
    pub fn gaussian(&mut self) -> f32 {
        let u1 = self.next_open01();
        let u2 = self.next_open01();
        ((-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_in_range() {
        let mut a = SplitMix64::new(42);
        let mut b = SplitMix64::new(42);
        for _ in 0..1000 {
            let x = a.next_open01();
            assert_eq!(x, b.next_open01());
            assert!(x > 0.0 && x <= 1.0);
        }
        assert!(a.below(10) < 10);
    }
}
