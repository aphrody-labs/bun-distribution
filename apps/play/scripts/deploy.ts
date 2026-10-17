#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Deploys the built release (apps/play/dist, from scripts/build.ts on this workstation) to the VPS:
 * replaces ~/apps/play/current in place (no kept releases), writes ~/apps/play/play.env, installs
 * the user unit bun-os-play.service (bun-os-gaming.slice) and the distro TLS vhost
 * play.aphrody.app.conf (nginx -t, then reload only). Nothing is compiled on the VPS.
 *
 * Usage: bun apps/play/scripts/deploy.ts [--build] [--host vps] [--skip-vhost]
 * Prerequisites on the VPS: ~/apps/play/runtime/bun (Bun OS release with bun:nginx) and the
 * engine ~/apps/play/nginx/sbin/nginx (toolchains/bun/packages/bun-nginx build-provider.ts).
 */
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Bun.argv.slice(2);
const host = args.includes("--host")
  ? args[args.indexOf("--host") + 1]!
  : "vps";
const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "..", "..");
const dist = join(app, "dist");

if (args.includes("--build")) await $`bun ${join(import.meta.dir, "build.ts")}`;
if (!(await Bun.file(join(dist, "server.js")).exists()))
  throw new Error("apps/play/dist is missing; run scripts/build.ts");

const staging = await mkdtemp(join(tmpdir(), "play-release-"));
try {
  // Relative operands: GNU tar and scp read "C:" in a Windows path as a remote host.
  await $`tar -czf play.tgz -C ${dist} .`.cwd(staging);
  await $`scp -q play.tgz ${host}:/tmp/`.cwd(staging);
  await $`scp -q infra/config/host/apps/vps/gaming/play/bun-os-play.service infra/config/host/nginx/play/play.aphrody.app.conf ${host}:/tmp/`.cwd(
    repo,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}

const remote = String.raw`
set -eu
P="$HOME/apps/play"
test -x "$P/runtime/bun" && test -x "$P/nginx/sbin/nginx"
rm -rf "$P/next" && mkdir -p "$P/next" "$P/data/usr" && tar -xzf /tmp/play.tgz -C "$P/next" && rm -f /tmp/play.tgz
# The owner's SteamID64 (read-only from the client's loginusers.vdf) is the Steam sign-in allow list.
STEAM_IDS=$(grep -ohE '"7656119[0-9]{10}"' "$HOME/.steam/steam/config/loginusers.vdf" 2>/dev/null | tr -d '"' | sort -u | paste -sd, - || true)
umask 077
cat > "$P/play.env" <<EOF
NODE_ENV=production
PLAY_ROOT=$P/current
PLAY_DATA=$P/data
PLAY_SECRETS=$HOME/.aphrody/secrets/play
PLAY_NGINX_BINARY=$P/nginx/sbin/nginx
PLAY_NGINX_PREFIX=$P/nginx
PLAY_STEAM_IDS=$STEAM_IDS
BEP_ROOT=$P/data/usr
BEP_PROJECT=$P/data/usr/var/lib/bep/library
EOF
mkdir -p "$HOME/.config/systemd/user"
install -m 644 /tmp/bun-os-play.service "$HOME/.config/systemd/user/bun-os-play.service" && rm -f /tmp/bun-os-play.service
systemctl --user daemon-reload
systemctl --user stop bun-os-play.service 2>/dev/null || true
rm -rf "$P/current" && mv "$P/next" "$P/current"
systemctl --user enable --now bun-os-play.service
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:18480/healthz && break; sleep 0.5; done
systemctl --user --no-pager --lines=8 status bun-os-play.service | sed -n '1,14p'
`;
const vhost = String.raw`
set -eu
LIVE=/etc/nginx/conf.d/play.aphrody.app.conf
if ! sudo cmp -s /tmp/play.aphrody.app.conf "$LIVE"; then
  PREVIOUS=$(mktemp)
  sudo cat "$LIVE" > "$PREVIOUS" 2>/dev/null || : > "$PREVIOUS"
  sudo install -m 644 /tmp/play.aphrody.app.conf "$LIVE"
  if sudo nginx -t; then
    sudo systemctl reload nginx
  else
    # Never leave a configuration that fails nginx -t for the other vhosts' next reload.
    if [ -s "$PREVIOUS" ]; then sudo install -m 644 "$PREVIOUS" "$LIVE"; else sudo rm -f "$LIVE"; fi
    rm -f "$PREVIOUS" /tmp/play.aphrody.app.conf
    exit 1
  fi
  rm -f "$PREVIOUS"
fi
rm -f /tmp/play.aphrody.app.conf
`;
await $`ssh ${host} ${remote}`;
if (!args.includes("--skip-vhost")) await $`ssh ${host} ${vhost}`;
console.log(`deployed apps/play to ${host}`);
