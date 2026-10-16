//! Thin executable binding for the reusable `aphrody_nie_cli` library.

fn main() -> anyhow::Result<()> {
    aphrody_nie_cli::main_entry()
}
