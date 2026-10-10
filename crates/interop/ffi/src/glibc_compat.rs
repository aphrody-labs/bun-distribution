// SPDX-License-Identifier: Apache-2.0
//! glibc re-versioned libm entry points, defined here so the cdylib loads on older glibc hosts.
//!
//! glibc 2.40 to 2.43 gave several single-precision libm functions new symbol versions (`acosf`,
//! `asinf`, `atan2f`, `atanhf`, `acoshf`, `coshf`, `sinhf`, `log10f`, `tgammaf`, `lgammaf`,
//! `remainderf` carry `GLIBC_2.43`). A library linked on such a host (the build factory runs Ubuntu
//! 26.04, glibc 2.43) imports `acosf@GLIBC_2.43` and `dlopen` refuses it on glibc 2.39 (Ubuntu
//! 24.04 user machines that load this library; vps and dbfr run 26.04 like the factory).
//!
//! Defining the functions in this library resolves every reference at link time, so no versioned
//! import is left; at run time the host's own libm is still preferred for unversioned lookups. The
//! implementations are the `libm` crate (musl ported to Rust). The same technique protects the
//! `aphrody` binary (`crates/infra/aphrody/src/main.rs`). Gate: `bun scripts/audit/elf-glibc-imports.ts
//! <libaphrody_ffi.so> --max 2.39` must report no offending import.
//!
//! The functions are deliberately not `pub`: they are not part of the Aphrody C ABI, so the ABI
//! drift gates (`packages/interop/native/test/*-drift.test.ts`) and the C header do not list them.

#[unsafe(no_mangle)]
extern "C" fn acosf(x: f32) -> f32 {
    libm::acosf(x)
}

#[unsafe(no_mangle)]
extern "C" fn asinf(x: f32) -> f32 {
    libm::asinf(x)
}

#[unsafe(no_mangle)]
extern "C" fn atan2f(y: f32, x: f32) -> f32 {
    libm::atan2f(y, x)
}

#[unsafe(no_mangle)]
extern "C" fn atanhf(x: f32) -> f32 {
    libm::atanhf(x)
}

#[unsafe(no_mangle)]
extern "C" fn acoshf(x: f32) -> f32 {
    libm::acoshf(x)
}

#[unsafe(no_mangle)]
extern "C" fn coshf(x: f32) -> f32 {
    libm::coshf(x)
}

#[unsafe(no_mangle)]
extern "C" fn sinhf(x: f32) -> f32 {
    libm::sinhf(x)
}

#[unsafe(no_mangle)]
extern "C" fn log10f(x: f32) -> f32 {
    libm::log10f(x)
}

#[unsafe(no_mangle)]
extern "C" fn tgammaf(x: f32) -> f32 {
    libm::tgammaf(x)
}

#[unsafe(no_mangle)]
extern "C" fn lgammaf(x: f32) -> f32 {
    libm::lgammaf(x)
}

#[unsafe(no_mangle)]
extern "C" fn remainderf(x: f32, y: f32) -> f32 {
    libm::remainderf(x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-5 * b.abs().max(1.0)
    }

    /// Reference values computed independently of the platform libm (and of these shims, which the
    /// test binary itself interposes).
    #[test]
    fn shims_return_the_reference_values() {
        assert!(close(acosf(0.5), core::f32::consts::FRAC_PI_3), "acosf");
        assert!(close(asinf(0.5), core::f32::consts::FRAC_PI_6), "asinf");
        assert!(close(atanhf(0.5), 0.549_306_15), "atanhf");
        assert!(close(coshf(1.5), 2.352_409_6), "coshf");
        assert!(close(sinhf(1.5), 2.129_279_5), "sinhf");
        assert!(close(acoshf(2.5), 1.566_799_2), "acoshf");
        assert!(close(atan2f(1.0, -2.0), 2.677_945), "atan2f");
        assert!(close(log10f(1000.0), 3.0), "log10f");
        assert!(close(tgammaf(5.0), 24.0), "tgammaf");
        assert!(close(lgammaf(5.0), 3.178_053_8), "lgammaf");
        assert!(close(remainderf(7.0, 4.0), -1.0), "remainderf");
    }
}
