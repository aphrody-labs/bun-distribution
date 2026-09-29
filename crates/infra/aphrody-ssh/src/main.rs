// SPDX-License-Identifier: Apache-2.0
pub use aphrody_ssh::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    aphrody_ssh::run_from_args(std::env::args_os()).await
}
