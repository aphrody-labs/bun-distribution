#!/usr/bin/env bash
set -Eeuo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT

version="$(cd "$repo" && bun -p "require('./packages/aphrody-messaging/package.json').version")"
typescript_version="$(cd "$repo" && bun -p "require('./package.json').workspaces.catalog.typescript")"
node_types_version="$(cd "$repo" && bun -p "require('./packages/rest/package.json').devDependencies['@types/node']")"
package="$scratch/aphrody-messaging-$version.tgz"

(cd "$repo/packages/aphrody-messaging" && bun run build && bun pm pack --destination "$scratch")
[[ -f "$package" ]] || { echo 'messaging package tarball missing' >&2; exit 1; }

mkdir "$scratch/consumer"
cat > "$scratch/consumer/package.json" <<EOF
{"name":"messaging-external-smoke","private":true,"type":"module","dependencies":{"@aphrody/messaging":"file:$package"},"devDependencies":{"typescript":"$typescript_version","@types/node":"$node_types_version"}}
EOF
cat > "$scratch/consumer/smoke.ts" <<'EOF'
import { ChannelError, DiscordChannel, type InboundMessage, type RoomInfo } from '@aphrody/messaging';

const channel: DiscordChannel = new DiscordChannel('smoke-token');
const error: ChannelError = new ChannelError('smoke');
const room: RoomInfo = { id: '1', name: 'smoke', kind: 'channel', memberCount: null };
const message: InboundMessage | undefined = undefined;
if (channel.id !== 'discord' || !(error instanceof Error) || !room.id || message) throw new Error('invalid exports');
EOF
cat > "$scratch/consumer/tsconfig.json" <<'EOF'
{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ESNext","strict":true,"noEmit":true,"skipLibCheck":false},"include":["smoke.ts"]}
EOF

(
  cd "$scratch/consumer"
  bun install
  bun install --frozen-lockfile
  bun run smoke.ts
  bunx --bun tsc -p tsconfig.json
)
