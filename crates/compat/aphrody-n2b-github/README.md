<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-n2b-github

The GitHub client of [n2b](https://crates.io/crates/aphrody-n2b), used by `n2b audit` to scan the
issues and pull requests of a repository for Bun and Node.js mentions.

`client()` builds an [`octocrab`](https://crates.io/crates/octocrab) client authenticated with a
personal token read from `GH_TOKEN` or `GITHUB_TOKEN`, falling back to a `.env` file found by
walking up from the current directory. Without a token it returns an anonymous client, limited
to the unauthenticated GitHub rate limit. The token is never logged.

## Install

```toml
[dependencies]
aphrody-n2b-github = "0.6.2"
```

## Example

```rust,no_run
let github = aphrody_n2b_github::client()?;
# let _ = github;
# Ok::<(), anyhow::Error>(())
```

## License

Apache-2.0.
