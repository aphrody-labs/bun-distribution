# SPDX-License-Identifier: Apache-2.0
# Compatibility entry for PowerShell callers; serialization is owned by cargo-serial.ts (Bun, kernel mutex).
& bun (Join-Path $PSScriptRoot 'cargo-serial.ts') @args
exit $LASTEXITCODE
