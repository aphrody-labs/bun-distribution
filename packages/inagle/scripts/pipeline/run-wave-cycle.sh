#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PACKAGE_ROOT"

echo "======================================================"
echo "🌊 [$(date)] Running Data Processing Wave Cycle..."
echo "======================================================"

# 1. Run the SQL-backed wave processing scripts (Zukan audit, series correction, glossary, patch notes sync)
bun scripts/pipeline/wave-processing.ts

echo "======================================================"
echo "🎉 Wave Cycle finished successfully."
echo "======================================================"
