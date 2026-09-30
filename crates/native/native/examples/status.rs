// SPDX-License-Identifier: Apache-2.0
//! Prints the status documents of the native layer as JSON.
//!
//! ```sh
//! cargo run -p aphrody-native --example status
//! ```

use aphrody_native::NativePlatform;

fn main() -> Result<(), serde_json::Error> {
    let status = serde_json::json!({
        "platform": NativePlatform::status(),
    });
    println!("{}", serde_json::to_string_pretty(&status)?);
    Ok(())
}
