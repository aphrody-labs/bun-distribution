// SPDX-License-Identifier: BSD-2-Clause
// Absorbed from fec-rs (https://github.com/hgaiser/fec-rs, revision 402f41f970bb8c3ef7c88639821032e3b6460f63),
// Copyright (c) 2026, Hans Gaiser. See crates/bun-engine-core/STREAM-PROVENANCE.md.
use super::galois;

#[derive(PartialEq, Debug, Clone)]
pub struct Matrix {
    pub row_count: usize,
    pub col_count: usize,
    pub data: Vec<u8>,
}

impl Matrix {
    pub fn new(rows: usize, cols: usize) -> Self {
        Self {
            row_count: rows,
            col_count: cols,
            data: vec![0u8; rows * cols],
        }
    }

    pub fn identity(size: usize) -> Self {
        let mut m = Self::new(size, size);
        for i in 0..size {
            m.data[i * size + i] = 1;
        }
        m
    }

    pub fn vandermonde(rows: usize, cols: usize) -> Self {
        let mut m = Self::new(rows, cols);
        for r in 0..rows {
            let r_a = r as u8;
            for c in 0..cols {
                m.data[r * cols + c] = galois::exp(r_a, c);
            }
        }
        m
    }

    #[inline]
    pub fn get(&self, r: usize, c: usize) -> u8 {
        self.data[r * self.col_count + c]
    }

    #[inline]
    pub fn set(&mut self, r: usize, c: usize, val: u8) {
        self.data[r * self.col_count + c] = val;
    }

    pub fn get_row(&self, row: usize) -> &[u8] {
        let start = row * self.col_count;
        &self.data[start..start + self.col_count]
    }

    pub fn sub_matrix(&self, rmin: usize, cmin: usize, rmax: usize, cmax: usize) -> Self {
        let new_rows = rmax - rmin;
        let new_cols = cmax - cmin;
        let mut m = Self::new(new_rows, new_cols);
        for r in rmin..rmax {
            for c in cmin..cmax {
                m.data[(r - rmin) * new_cols + (c - cmin)] = self.get(r, c);
            }
        }
        m
    }

    pub fn multiply(&self, rhs: &Matrix) -> Self {
        assert_eq!(
            self.col_count, rhs.row_count,
            "Matrix dimensions incompatible for multiply"
        );
        let mut result = Self::new(self.row_count, rhs.col_count);
        for r in 0..self.row_count {
            for c in 0..rhs.col_count {
                let mut val = 0u8;
                for i in 0..self.col_count {
                    val = galois::add(val, galois::mul(self.get(r, i), rhs.get(i, c)));
                }
                result.set(r, c, val);
            }
        }
        result
    }

    pub fn augment(&self, rhs: &Matrix) -> Self {
        assert_eq!(
            self.row_count, rhs.row_count,
            "Matrix row counts must match for augment"
        );
        let new_cols = self.col_count + rhs.col_count;
        let mut m = Self::new(self.row_count, new_cols);
        for r in 0..self.row_count {
            for c in 0..self.col_count {
                m.set(r, c, self.get(r, c));
            }
            for c in 0..rhs.col_count {
                m.set(r, self.col_count + c, rhs.get(r, c));
            }
        }
        m
    }

    fn swap_rows(&mut self, r1: usize, r2: usize) {
        if r1 == r2 {
            return;
        }
        let s1 = r1 * self.col_count;
        let s2 = r2 * self.col_count;
        for i in 0..self.col_count {
            self.data.swap(s1 + i, s2 + i);
        }
    }

    fn gaussian_elim(&mut self) -> Result<(), &'static str> {
        for r in 0..self.row_count {
            // Pivot search
            if self.get(r, r) == 0 {
                for r_below in r + 1..self.row_count {
                    if self.get(r_below, r) != 0 {
                        self.swap_rows(r, r_below);
                        break;
                    }
                }
            }
            if self.get(r, r) == 0 {
                return Err("Singular matrix");
            }
            // Scale to 1
            if self.get(r, r) != 1 {
                let scale = galois::div(1, self.get(r, r));
                for c in 0..self.col_count {
                    let val = galois::mul(scale, self.get(r, c));
                    self.set(r, c, val);
                }
            }
            // Eliminate below
            for r_below in r + 1..self.row_count {
                if self.get(r_below, r) != 0 {
                    let scale = self.get(r_below, r);
                    for c in 0..self.col_count {
                        let val =
                            galois::add(self.get(r_below, c), galois::mul(scale, self.get(r, c)));
                        self.set(r_below, c, val);
                    }
                }
            }
        }

        // Back substitution
        for d in 0..self.row_count {
            for r_above in 0..d {
                if self.get(r_above, d) != 0 {
                    let scale = self.get(r_above, d);
                    for c in 0..self.col_count {
                        let val =
                            galois::add(self.get(r_above, c), galois::mul(scale, self.get(d, c)));
                        self.set(r_above, c, val);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn invert(&self) -> Result<Self, &'static str> {
        assert!(
            self.row_count == self.col_count,
            "Cannot invert non-square matrix"
        );
        let mut work = self.augment(&Self::identity(self.row_count));
        work.gaussian_elim()?;
        Ok(work.sub_matrix(0, self.row_count, self.col_count, self.col_count * 2))
    }
}
