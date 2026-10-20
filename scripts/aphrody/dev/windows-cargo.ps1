# SPDX-License-Identifier: Apache-2.0
# Compatibility entry for PowerShell callers; the native Windows MSVC Cargo context is owned by
# scripts/aphrody/build/rust/cargo-serial.ts --msvc (Bun: vswhere + VsDevCmd, kernel mutex, sccache).
& bun (Join-Path $PSScriptRoot '../build/rust/cargo-serial.ts') --msvc @args
exit $LASTEXITCODE
