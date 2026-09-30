# Cargo owns the dependency order; @aphrody/workspace owns orchestration.
check:
    cargo check --workspace --all-targets --locked

clippy:
    cargo clippy --workspace --all-targets --locked -- -D warnings

test:
    cargo test --workspace --locked
