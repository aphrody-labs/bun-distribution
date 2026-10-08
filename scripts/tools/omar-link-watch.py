#!/usr/bin/env python3
"""Watch Omar's links on the vps (wg1 handshake, reverse SSH tunnel) and post each transition to Discord.

Runs as aphrody-omar-link.service (root, oneshot) every minute. Reads tools/config/var/omar.json; the bot token
stays in the credential file on the host. `--dry-run` prints the state and the message without posting.
"""

import argparse
import json
import socket
import subprocess
import time
import urllib.request
from pathlib import Path


def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout


def handshake_age(public_key):
    for line in run("wg", "show", "wg1", "latest-handshakes").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == public_key and parts[1] != "0":
            return int(time.time()) - int(parts[1])
    return None


def listening(port):
    return bool(run("ss", "-Hltn", f"sport = :{port}").strip())


def reachable(host, port):
    try:
        with socket.create_connection((host, port), timeout=3):
            return True
    except OSError:
        return False


def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip("\"'")
    return env


def post(env_file, channel, content):
    token = load_env(env_file)["DISCORD_BOT_TOKEN"]
    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{channel}/messages",
        data=json.dumps(
            {"content": content, "allowed_mentions": {"parse": ["users"]}}
        ).encode(),
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "aphrody-omar-link (https://aphrody.com, 1)",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    var = json.loads((root / "tools/config/var/omar.json").read_text())
    watch = var["linkWatch"]
    wg_ip = var["wireguard"]["address"].split("/")[0]
    age = handshake_age(var["wireguard"]["publicKey"])
    state = {
        "wg": age is not None and age <= watch["handshakeFreshSeconds"],
        "reverse": {
            f["service"]: listening(int(f["remote"].rsplit(":", 1)[1]))
            for f in var["reverseTunnel"]["forwards"]
        },
    }
    if state["wg"]:
        state["wgServices"] = {
            name: reachable(wg_ip, int(svc["bind"].rsplit(":", 1)[1]))
            for name, svc in var["services"].items()
        }
    state_file = Path(watch["stateFile"])
    previous = json.loads(state_file.read_text()) if state_file.exists() else None
    print(json.dumps(state))
    if previous == state:
        return
    up = lambda flag: "✅" if flag else "❌"
    lines = [f"<@{watch['ownerDiscordId']}> Lien Omar modifié :"]
    lines.append(
        f"- wg1 {wg_ip} : {up(state['wg'])}"
        + (f" (handshake il y a {age}s)" if age is not None else "")
    )
    for name, ok in state.get("wgServices", {}).items():
        lines.append(f"  - {name} {var['services'][name]['bind']} : {up(ok)}")
    for name, ok in state["reverse"].items():
        lines.append(f"- tunnel inverse {name} : {up(ok)}")
    if state["wg"]:
        lines.append("→ `ssh omar-pc`, `aphrody infra remote status`")
    elif state["reverse"].get("ssh"):
        lines.append("→ `ssh omar-rt`")
    message = "\n".join(lines)
    if args.dry_run:
        print(message)
        return
    if previous is not None:
        post(watch["credentialFile"], watch["discordChannelId"], message)
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state))


if __name__ == "__main__":
    main()
