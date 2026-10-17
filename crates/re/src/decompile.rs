use std::path::Path;

use ghidra_decompiler::error::Result;
use ghidra_decompiler::program::{FunctionEntry, Program};

/// Opens PE, ELF or Mach-O through the unified Rust decompiler owner.
pub fn functions(path: &Path) -> Result<Vec<FunctionEntry>> {
    Program::open(path, None)?.functions()
}

/// Decompiles one function address without routing through Java or C++.
pub fn decompile(path: &Path, address: u64) -> Result<String> {
    Program::open(path, None)?.decompile(address)
}

/// Finds and decompiles a named function using the same symbol view exposed by `functions`.
pub fn decompile_named(path: &Path, name: &str) -> Result<Option<String>> {
    let mut program = Program::open(path, None)?;
    let Some(function) = program
        .functions()?
        .into_iter()
        .find(|item| item.name == name)
    else {
        return Ok(None);
    };
    program.decompile(function.address).map(Some)
}
