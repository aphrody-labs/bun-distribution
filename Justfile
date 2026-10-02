# Cargo owns the dependency order; @aphrody/workspace owns orchestration.
check:
    scripts/build/rust/cargo-serial.sh check --workspace --all-targets --locked

clippy:
    scripts/build/rust/cargo-serial.sh clippy --workspace --all-targets --locked -- -D warnings

test:
    scripts/build/rust/cargo-serial.sh test --workspace --locked
