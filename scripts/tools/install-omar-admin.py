#!/usr/bin/env python3
"""Plan/apply the cataloged Omar role reconciler on VPS, without replacing an installation."""

import argparse
import hashlib
import json
import shlex
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    owner = str(Path.home() / ".local/bin/aphrody")
    stage = "/tmp/aphrody-omar-admin-stage-20261007"
    files = {
        "config/host/omar-admin.json": "/srv/aphrody-admin/config/host/omar-admin.json",
        "scripts/tools/omar-admin-access.py": "/srv/aphrody-admin/scripts/tools/omar-admin-access.py",
        "config/host/systemd/aphrody/aphrody-omar-admin.service": "/etc/systemd/system/aphrody-omar-admin.service",
        "config/host/systemd/aphrody/aphrody-omar-admin.timer": "/etc/systemd/system/aphrody-omar-admin.timer",
    }
    plan = [
        {
            "source": source,
            "stage": stage + "/" + Path(source).name,
            "destination": destination,
            "sha256": hashlib.sha256((root / source).read_bytes()).hexdigest(),
        }
        for source, destination in files.items()
    ]
    if not args.apply:
        print(
            json.dumps(
                {"host": "vps", "files": plan, "enable": "aphrody-omar-admin.timer"},
                indent=2,
            )
        )
        return

    def ssh(command):
        result = subprocess.run(
            [
                owner,
                "infra",
                "ssh",
                "exec",
                "--host",
                "vps",
                "--cmd",
                command,
                "--json",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        receipt = json.loads(result.stdout)
        if receipt["exit_code"] != 0:
            raise SystemExit("Infra installation failed")
        print(receipt["stdout"].strip())

    ssh("mkdir -p " + shlex.quote(stage) + " && chmod 700 " + shlex.quote(stage))
    for entry in plan:
        subprocess.run(
            [
                owner,
                "infra",
                "ssh",
                "sftp",
                "--host",
                "vps",
                "--put",
                str(root / entry["source"]),
                "--path",
                entry["stage"],
                "--json",
            ],
            check=True,
        )
    remote = """
import hashlib,json,os,subprocess
plan=json.loads(PLAN)
for item in plan:
    if os.path.islink(item["stage"]): raise SystemExit("Symlink stage refused")
    if hashlib.sha256(open(item["stage"],"rb").read()).hexdigest()!=item["sha256"]:
        raise SystemExit("Stage checksum mismatch")
    dest=item["destination"]
    if os.path.lexists(dest):
        if os.path.islink(dest) or hashlib.sha256(open(dest,"rb").read()).hexdigest()!=item["sha256"]:
            raise SystemExit("Existing installation differs; review before replacing")
for item in plan:
    subprocess.run(["sudo","install","-d","-o","root","-g","root","-m","0755",os.path.dirname(item["destination"])],check=True)
    subprocess.run(["sudo","install","-o","root","-g","root","-m","0644",item["stage"],item["destination"]],check=True)
    if hashlib.sha256(open(item["destination"],"rb").read()).hexdigest()!=item["sha256"]:
        raise SystemExit("Installed checksum mismatch")
subprocess.run(["sudo","systemd-analyze","verify","/etc/systemd/system/aphrody-omar-admin.service","/etc/systemd/system/aphrody-omar-admin.timer"],check=True)
subprocess.run(["sudo","systemctl","daemon-reload"],check=True)
subprocess.run(["sudo","systemctl","start","aphrody-omar-admin.service"],check=True)
subprocess.run(["sudo","systemctl","enable","--now","aphrody-omar-admin.timer"],check=True)
print(json.dumps({"installed":True,"checksumsVerified":True}))
print(subprocess.check_output(["systemctl","show","aphrody-omar-admin.service","-p","Result","-p","ExecMainStatus"],text=True))
print(subprocess.check_output(["systemctl","is-active","aphrody-omar-admin.timer"],text=True))
""".replace("PLAN", repr(json.dumps(plan)))
    ssh("python3 -c " + shlex.quote(remote))


if __name__ == "__main__":
    main()
