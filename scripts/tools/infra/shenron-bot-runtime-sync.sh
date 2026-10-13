#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

bundle=/home/ubuntu/.aphrody/profiles/dbfr/pg-gap/sync-bot-runtime.bundle.js
profiles_bundle=/home/ubuntu/.aphrody/profiles/dbfr/pg-gap/sync-discord-profiles.bundle.js
checkpoint=/home/ubuntu/.aphrody/profiles/dbfr/pg-gap/runtime-checkpoint.json
runtime=/home/ubuntu/.local/share/aphrody/cloudflare-cli/runtime/bun
source_dir=/home/ubuntu/apps/shenron/shared/bot/data
lock="$source_dir/.replica-sync.lock"
expected_bundle=4d65981fa0b2aa982b080665c21a9cda265f13798d403e676d25fc20cdb2eff9
expected_profiles_bundle=a2f0dec7c5ab9a3f0260adbe6a0d1476eac648ea204079de857e45b024cb1efa
expected_runtime=71ae39ac2deb5022fcbf62737f8779562ea094f079747cff3936214457f72567

[[ "$(sha256sum "$bundle" | cut -d' ' -f1)" == "$expected_bundle" ]]
[[ "$(sha256sum "$profiles_bundle" | cut -d' ' -f1)" == "$expected_profiles_bundle" ]]
[[ "$(sha256sum "$runtime" | cut -d' ' -f1)" == "$expected_runtime" ]]
[[ "$(stat -c %a "$checkpoint")" == 600 ]]
[[ "$(stat -c %a "$(dirname "$checkpoint")")" == 700 ]]

image=$(docker inspect aphrody-site-1 --format '{{.Image}}')
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
docker image inspect "$image" >/dev/null

exec 9>"$lock"
flock -n 9
timeout --kill-after=5s 90s docker run \
  --rm --pull=never --network container:aphrody-site-1 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m --tmpfs /tmp:rw,nosuid,nodev,size=16m \
  --user 1000:1000 --env-file /etc/rose-griffon/shenron-site.env \
  -v "$runtime:/bun:ro" -v "$(dirname "$bundle"):/job:rw" -v "$source_dir:/bot:ro" \
  --entrypoint /bun "$image" /job/sync-bot-runtime.bundle.js \
  --sqlite /bot/bot.db --source-id dbfr-bot-runtime-20261013 \
  --checkpoint /job/runtime-checkpoint.json --apply

timeout --kill-after=5s 30s docker run \
  --rm --pull=never --network container:aphrody-site-1 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m --tmpfs /tmp:rw,nosuid,nodev,size=16m \
  --user 1000:1000 --env-file /etc/rose-griffon/shenron-site.env \
  -v "$runtime:/bun:ro" -v "$(dirname "$bundle"):/job:ro" -v "$source_dir:/bot:ro" \
  --entrypoint /bun "$image" /job/sync-discord-profiles.bundle.js \
  --sqlite /bot/bot.db --source-id dbfr-bot-runtime-20261013 --apply
