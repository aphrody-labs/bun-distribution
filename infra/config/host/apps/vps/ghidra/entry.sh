#!/bin/sh
# Create the PyGhidra venv from the wheels bundled with the mounted Ghidra release, once.
set -eu
test -x /opt/ghidra/support/analyzeHeadless || { echo "Ghidra is not mounted at /opt/ghidra" >&2; exit 1; }
if [ ! -x /work/venv/bin/python ] || ! /work/venv/bin/python -c 'import pyghidra' 2>/dev/null; then
  python3 -m venv /work/venv
  /work/venv/bin/pip install --no-cache-dir --no-index \
    --find-links /opt/ghidra/Ghidra/Features/PyGhidra/pypkg/dist pyghidra
fi
mkdir -p /work/home
exec /work/venv/bin/python -I /opt/re/ghidra_re.py "$@"
