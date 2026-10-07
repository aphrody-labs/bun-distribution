#!/usr/bin/env python3
"""Reconcile Omar's declared Discord administrator role through native Infra SSH.

Default is read-only. Credentials remain on VPS; unknown GitHub identities and
Discord users outside the guild are reported rather than granted by inference.
"""

import argparse
import json
import shlex
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    policy = json.loads((root / "config/host/omar-admin.json").read_text())
    discord = policy["discord"]
    remote = """
import json,urllib.request,urllib.error
policy=json.loads(POLICY)
apply=APPLY
env={}
for line in open(policy["credentialFile"]):
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    key,value=line.split("=",1)
    env[key]=value.strip().strip("\\\"'")
guild=env["DISCORD_GUILD_ID"]
def call(path,method="GET",body=None):
    req=urllib.request.Request("https://discord.com/api/v10/"+path,
        data=None if body is None else json.dumps(body).encode(),method=method,
        headers={"Authorization":"Bot "+env["DISCORD_BOT_TOKEN"],
        "Content-Type":"application/json","User-Agent":"DiscordBot (https://aphrody.com, 1)",
        "X-Audit-Log-Reason":"Owner-authorized%20Omar%20administrator%20access"})
    try:
        with urllib.request.urlopen(req) as response:
            text=response.read()
            return response.status,json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        data=json.loads(error.read())
        return error.code,{"code":data.get("code"),"message":data.get("message")}
status,roles=call("guilds/"+guild+"/roles")
if status!=200: raise SystemExit("Cannot inspect Discord roles: "+str(status))
matches=[role for role in roles if role["name"]==policy["roleName"]]
if len(matches)>1: raise SystemExit("Ambiguous administrator role; no mutation")
role=matches[0] if matches else None
if role and role.get("managed"): raise SystemExit("Managed role cannot be reconciled")
if apply:
    if role is None:
        status,role=call("guilds/"+guild+"/roles","POST",{"name":policy["roleName"],"permissions":policy["permissions"],"mentionable":False})
        if status!=200: raise SystemExit("Cannot create administrator role: "+str(status))
    elif not int(role["permissions"]) & int(policy["permissions"]):
        status,role=call("guilds/"+guild+"/roles/"+role["id"],"PATCH",{"permissions":str(int(role["permissions"]) | int(policy["permissions"]))})
        if status!=200: raise SystemExit("Cannot update administrator role: "+str(status))
results=[]
for user in [policy["primaryUserId"]]+policy["alternateUserIds"]:
    status,member=call("guilds/"+guild+"/members/"+user)
    if status==404:
        results.append({"userId":user,"state":"pending-guild-membership"})
        continue
    if status!=200: raise SystemExit("Cannot inspect member: "+str(status))
    granted=bool(role and role["id"] in member["roles"])
    if apply and not granted:
        status,_=call("guilds/"+guild+"/members/"+user+"/roles/"+role["id"],"PUT")
        if status!=204: raise SystemExit("Cannot grant administrator role: "+str(status))
        status,member=call("guilds/"+guild+"/members/"+user)
        granted=status==200 and role["id"] in member["roles"]
        if not granted: raise SystemExit("Role grant verification failed")
    results.append({"userId":user,"state":"administrator" if granted else "planned"})
print(json.dumps({"apply":apply,"guildId":guild,"roleId":role["id"] if role else None,
    "administratorPermission":bool(role and int(role["permissions"]) & 8),"members":results}))
"""
    remote = remote.replace("POLICY", repr(json.dumps(discord))).replace(
        "APPLY", "True" if args.apply else "False"
    )
    result = subprocess.run(
        [
            str(Path.home() / ".local/bin/aphrody"),
            "infra",
            "ssh",
            "exec",
            "--host",
            "vps",
            "--cmd",
            "python3 -c " + shlex.quote(remote),
            "--json",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    receipt = json.loads(result.stdout)
    if receipt.get("exit_code") != 0:
        raise SystemExit("Remote reconciliation failed")
    print(receipt["stdout"].strip())
    print(
        json.dumps(
            {
                "github": "pending-confirmed-login"
                if not policy["github"]["login"]
                else "not-reconciled"
            }
        )
    )


if __name__ == "__main__":
    main()
