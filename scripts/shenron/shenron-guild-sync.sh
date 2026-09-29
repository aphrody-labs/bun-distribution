#!/usr/bin/env bash
# Reconciliation quotidienne : scan Discord guild + reconstruct missing users
# + parse messages des dernières 24h pour combler messageCount/lastMessageAt
# + backup avant + après.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT/apps/bot"
export PATH="$HOME/.bun/bin:$PATH"

TS=$(date -u +%Y%m%d-%H%M%S)
echo "[$TS] === shenron guild sync start ==="

# 1) Backup pré-sync
bash "$PROJECT_ROOT/scripts/backup-shenron-sqlite.sh"

# 2) Scan Discord live (refresh data/guild-scan.json)
bun scripts/scan-ids.ts 2>&1 | tail -3

# 3) Reconstruct missing users + level from roles
bun scripts/reconstruct-from-discord.ts 2>&1 | tail -8

# 4) Parse messages des dernières 25h (≈24h + marge)
bun scripts/recover-from-discord-history.ts --days 1 --concurrency 4 2>&1 | tail -10

echo "[$TS] === shenron guild sync done ==="
