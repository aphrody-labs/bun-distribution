// SPDX-License-Identifier: Apache-2.0
//! Read-only audit of managed workflow coverage for a GitHub account.

use aphrody_git::{GitHubClient, audit_ecosystem_workflows};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let owner = std::env::args().nth(1).unwrap_or_else(|| "aphrody-code".to_owned());
    let source_ref = std::env::args().nth(2).unwrap_or_else(|| "main".to_owned());
    let client = GitHubClient::from_env()?;
    let outcomes = audit_ecosystem_workflows(&client, &owner, &source_ref, false).await?;
    println!("{}", serde_json::to_string_pretty(&outcomes)?);
    Ok(())
}
