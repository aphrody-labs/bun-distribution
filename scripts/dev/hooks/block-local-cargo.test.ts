// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { blocksLocalCargo } from "./block-local-cargo";

test("blocks local heavy cargo, direct or serialized", () => {
  for (const command of [
    "cargo test -p aphrody-ovh --lib",
    "cd crates/x && cargo clippy --all-targets",
    "cargo +nightly build --release",
    "APHRODY_LOCAL_CARGO=1 scripts/build/rust/cargo-serial.sh check -p aphrody",
    "true; cargo b",
    `bash -c "cargo build --release"`,
    "eval 'cargo test'",
  ]) {
    expect(blocksLocalCargo(command)).toBe(true);
  }
});

test("allows light cargo and every remote route", () => {
  for (const command of [
    "cargo fmt -p aphrody-ovh",
    "cargo metadata --offline --no-deps --format-version 1",
    "bun scripts/build/rust/vps-cargo.ts run -- clippy -p aphrody -- -D warnings",
    "aphrody-ops build-factory run --repo aphrody --revision abc -- scripts/build/rust/cargo-serial.sh test",
    "ssh vps 'cd /srv && cargo build'",
    "rg -n cargo Cargo.toml",
    "echo cargo-test",
    `sd -F 'cargo build -p a' 'cargo build -p b' docs/RUNTIME-ABI.md`,
    `bun -e 'console.log("cargo test")'`,
    `git commit -m "fix: cargo clippy findings"`,
  ]) {
    expect(blocksLocalCargo(command)).toBe(false);
  }
});
