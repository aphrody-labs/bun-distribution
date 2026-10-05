// SPDX-License-Identifier: MIT
//! Optional native tooling provider. Engine implementations stay with their owners.
//! Build the final C ABI artifact with panic unwinding enabled.

pub use aphrody_n2b_native::*;
pub use aphrody_oxc_bridge::*;

/// Version of the grouped tooling provider; individual component ABIs remain unchanged.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_tooling_abi_version() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grouped_provider_retains_component_abi_versions() {
        assert_eq!(yolo_tooling_abi_version(), 1);
        assert_eq!(node2bun_abi_version(), 2);
        assert_eq!(aphrody_oxc_abi_version(), 1);
    }
}
