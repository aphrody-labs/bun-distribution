#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Aphrody Comprehensive Shell & Terminal Benchmark Suite (2026)
# Compares Nushell, Bun Shell, Dash, Bash, Zsh, and Fish across:
#   1. Startup latency
#   2. Pipeline throughput
#   3. Structured data parsing
#   4. Raw read of a 100k-line ANSI file (I/O only: no VT parsing is measured)
#   5. Memory footprint (RSS)

set -euo pipefail

BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo -e "${BOLD}${CYAN}========================================================================${RESET}"
echo -e "${BOLD}${CYAN}          APHRODY SHELL & TERMINAL BENCHMARK SUITE (2026)               ${RESET}"
echo -e "${BOLD}${CYAN}========================================================================${RESET}\n"

# Verify installed shells
echo -e "${BOLD}Environment & Runtime Inventory:${RESET}"
command -v nu >/dev/null 2>&1 && echo -e "  * Nushell:  $(nu --version)" || echo "  - Nushell: not found"
command -v bun >/dev/null 2>&1 && echo -e "  * Bun:      $(bun --version)" || echo "  - Bun: not found"
command -v dash >/dev/null 2>&1 && echo -e "  * Dash:     dash (POSIX)" || echo "  - Dash: not found"
command -v bash >/dev/null 2>&1 && echo -e "  * Bash:     $BASH_VERSION" || echo "  - Bash: not found"
command -v zsh >/dev/null 2>&1 && echo -e "  * Zsh:      $(zsh --version)" || echo "  - Zsh: not found"
command -v fish >/dev/null 2>&1 && echo -e "  * Fish:     $(fish --version)" || echo "  - Fish: not found"
echo ""

# -----------------------------------------------------------------------------
# BENCHMARK 1: Startup Latency
# -----------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>>> 1. STARTUP TIME BENCHMARK (Warm Process Exit)${RESET}"
echo -e "Measures process initialization and exit time for each shell.\n"

hyperfine --warmup 5 --runs 20 \
  --export-markdown /tmp/startup-bench.md \
  "dash -c exit" \
  "bun -e 'process.exit(0)'" \
  "bash -c exit" \
  "zsh -c exit" \
  "fish -c exit" \
  "nu -c exit"

cat /tmp/startup-bench.md
echo ""

# -----------------------------------------------------------------------------
# BENCHMARK 2: Pipeline Throughput (100,000 lines streaming)
# -----------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>>> 2. PIPE & STREAMING THROUGHPUT (100k lines)${RESET}"
echo -e "Streams 100,000 lines through stdout/stdin pipe and counts them.\n"

hyperfine --warmup 3 --runs 10 \
  --export-markdown /tmp/pipe-bench.md \
  -n "dash (seq | wc -l)" "dash -c 'seq 1 100000 | wc -l'" \
  -n "bash (seq | wc -l)" "bash -c 'seq 1 100000 | wc -l'" \
  -n "nu (seq 1 100000 | length)" "nu -c 'seq 1 100000 | length'" \
  -n 'bun shell (seq 1 100000 | wc -l)' "bun scripts/audit/bench/bench-bun-pipe.ts"

cat /tmp/pipe-bench.md
echo ""

# -----------------------------------------------------------------------------
# BENCHMARK 3: Structured Data Manipulation (50,000 JSON items)
# -----------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>>> 3. STRUCTURED DATA PROCESSING (JSON Filter & Count)${RESET}"
echo -e "Parses and queries a structured JSON file of 50,000 objects.\n"

bun -e '
  const data = Array.from({ length: 50000 }, (_, i) => ({
    id: i,
    name: "item_" + i,
    score: (i * 17) % 100,
    active: i % 2 === 0
  }));
  await Bun.write("/tmp/test_data.json", JSON.stringify(data));
'
echo "Generated /tmp/test_data.json ($(du -h /tmp/test_data.json | cut -f1))"

hyperfine --warmup 2 --runs 5 \
  --export-markdown /tmp/data-bench.md \
  -n "bun (JSC native parse + filter)" "bun scripts/audit/bench/bench-bun-data.ts" \
  -n "nu (open test_data.json | where ... | length)" "nu -c \"open /tmp/test_data.json | where active == true and score > 50 | length\"" \
  -n "bash + jq (jq stream filter | length)" "bash -c \"jq '[.[] | select(.active and .score > 50)] | length' /tmp/test_data.json\""

cat /tmp/data-bench.md
echo ""

# -----------------------------------------------------------------------------
# BENCHMARK 4: Terminal VT Stream Processing (100k lines ANSI)
# -----------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>>> 4. RAW READ OF AN ANSI FILE (100k lines, no VT parsing)${RESET}"
echo -e "Copies an ANSI-colored file to /dev/null; terminal emulators are not exercised.\n"

bun scripts/audit/bench/generate-ansi.ts

hyperfine --warmup 3 --runs 10 \
  --export-markdown /tmp/vt-bench.md \
  -n "dash (cat /tmp/ansi_stream.txt > /dev/null)" "dash -c 'cat /tmp/ansi_stream.txt > /dev/null'" \
  -n "bash (cat /tmp/ansi_stream.txt > /dev/null)" "bash -c 'cat /tmp/ansi_stream.txt > /dev/null'" \
  -n "bun (Bun.file.bytes > devnull)" "bun -e \"const f = Bun.file('/tmp/ansi_stream.txt'); await Bun.write('/dev/null', await f.arrayBuffer());\"" \
  -n "nu (open /tmp/ansi_stream.txt | save -f /dev/null)" "nu -c 'open --raw /tmp/ansi_stream.txt | save -f /dev/null'"

cat /tmp/vt-bench.md
echo ""

# -----------------------------------------------------------------------------
# BENCHMARK 5: Resident Memory (RSS) Footprint
# -----------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}>>> 5. RESIDENT MEMORY FOOTPRINT (RSS)${RESET}"
echo -e "Measures resident set size (RAM) of each shell process at exit.\n"

format_rss() {
  local name="$1"
  local cmd="$2"
  local rss
  rss=$(/usr/bin/time -v $cmd 2>&1 | grep "Maximum resident set size" | awk '{print $NF}')
  printf "  %-25s : %6d KB (~%.2f MB)\n" "$name" "$rss" "$(echo "$rss / 1024" | bc -l 2>/dev/null || awk "BEGIN {print $rss/1024}")"
}

format_rss "Dash" "dash -c exit"
format_rss "Bash" "bash -c exit"
format_rss "Zsh" "zsh -c exit"
format_rss "Fish" "fish -c exit"
format_rss "Bun Runtime" "bun -e process.exit(0)"
format_rss "Nushell" "nu -c exit"

echo ""
echo -e "${BOLD}${GREEN}========================================================================${RESET}"
echo -e "${BOLD}${GREEN}                   BENCHMARK COMPLETE                                   ${RESET}"
echo -e "${BOLD}${GREEN}========================================================================${RESET}"
