#!/usr/bin/env python3
"""Apply the canonical Omar account/WireGuard plan through native Infra SSH.

Private keys stay on each host. No MCP/A2A proxy is activated by this SSH batch.
"""

import argparse
import base64
import json
import shlex
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = Path("/home/aphro/.local/bin/aphrody")


def execute(host, command, *, capture=False):
    if host == "wsl":
        args = ["sudo", "-n", "bash", "-c", command]
    else:
        encoded = base64.b64encode(command.encode()).decode()
        remote = f"printf %s {shlex.quote(encoded)} | base64 -d | sudo -n bash"
        args = [str(CLI), "infra", "ssh", "exec", "--host", host, "--cmd", remote]
    result = subprocess.run(args, check=True, text=True, capture_output=True)
    if capture:
        return result.stdout.strip()
    # Commands in this batch emit no private configuration or key material.
    if result.stdout.strip():
        print(result.stdout.strip())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    plan = json.loads(
        subprocess.check_output(
            ["bun", "packages/engine/core/src/host/cli.ts", "wg-plan", "--json"],
            cwd=ROOT,
            text=True,
        )
    )
    steps = {step["id"]: step for step in plan["steps"]}
    if not args.apply:
        print(
            json.dumps(
                {
                    "hosts": ["vps", "dbfr", "wsl"],
                    "interface": "wg1",
                    "accounts": "omar with journaled NOPASSWD sudo",
                    "activation": "SSH and WireGuard only; no MCP/A2A proxy",
                },
                indent=2,
            )
        )
        return
    # A fresh-interface gate protects existing tunnels and their private keys.
    for host in ["vps", "dbfr", "wsl"]:
        execute(
            host,
            "set -eu; command -v wg wg-quick >/dev/null; "
            "! ip link show wg1 >/dev/null 2>&1; "
            "! test -e /etc/wireguard/wg1.conf; "
            '! ip -4 route | grep -q "10\\.200\\.77\\."; '
            "test -d /run/systemd/system",
        )

    def apply(step_id, public=None, host=None):
        step = steps[step_id]
        command = step["run"]
        if public:
            command = (
                "\n".join(
                    f"{key}={shlex.quote(value)}" for key, value in public.items()
                )
                + "\n"
                + command
            )
        execute(host or step["host"], command)
        print(f"Applied {host or step['host']}: {step_id}", flush=True)

    public = {}
    for host, key in [
        ("vps", "HUB_PUBLIC_KEY"),
        ("dbfr", "DBFR_PUBLIC_KEY"),
        ("wsl", "WSL_PUBLIC_KEY"),
    ]:
        apply(f"{host}.keygen")
        public[key] = execute(host, "cat /etc/wireguard/wg1.pub", capture=True)
    apply("vps.hub-conf", public)
    apply("vps.hub-verify-conf")
    apply("vps.sysctl")
    apply("dbfr.conf", public)
    apply("wsl.conf", public)
    # Retain existing all-port sources; add only declared SSH reachability.
    for step in plan["steps"]:
        if step["id"].startswith("vps.ufw.") and any(
            step["id"].endswith(suffix) for suffix in [".udp", ".ssh-vps", ".ssh-dbfr"]
        ):
            apply(step["id"])
    execute(
        "vps",
        "ufw route allow in on wg1 out on wg1 from 10.200.77.10 to 10.200.77.2 port 22 proto tcp comment 'aphrody-wg-omar'; "
        "ufw allow in on wg1 from 10.200.77.3 to 10.200.77.1 port 22 proto tcp comment 'aphrody-wg-dbfr'",
    )
    execute("wsl", "install -d -m 755 /run/sshd; systemctl enable --now ssh")
    # WSL uses the same root-owned key and sudo policy as both VPS hosts.
    for host in ["vps", "dbfr", "wsl"]:
        source_host = "vps" if host == "wsl" else host
        for suffix in ["user", "keys", "sudoers", "sshd:60-omar.conf"]:
            apply(f"{source_host}.account.omar.{suffix}", host=host)
        execute(
            host,
            "sshd -t; sudo -n -u omar sudo -n id -u; "
            'stat -c "%a %U:%G %n" /etc/sudoers.d/omar /etc/ssh/authorized_keys.d/omar',
        )
    execute("dbfr", "! test -e /var/lib/postgresql/.ssh/authorized_keys")
    apply("dbfr.account.omar.sshd:62-postgres-no-login.conf")
    execute("wsl", "systemctl enable --now ssh")
    execute("vps", "systemctl enable --now wg-quick@wg1")
    apply("dbfr.start")
    apply("wsl.start")
    print(
        json.dumps(
            {
                "publicKeys": public,
                "endpoint": "51.77.147.152:51821",
                "omarAddress": "10.200.77.10/32",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
