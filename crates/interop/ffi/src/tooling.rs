// SPDX-License-Identifier: Apache-2.0
//! Grouped native tooling provider ABI (formerly the `yolo-tooling` cdylib).
//! N2B and Oxc symbols are re-exported from `lib.rs`; their ABIs keep their own versions.

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
        assert_eq!(crate::n2b_native::node2bun_abi_version(), 2);
        assert_eq!(aphrody_oxc_bridge::aphrody_oxc_abi_version(), 1);
    }
}
