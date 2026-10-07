"""Exercise the actual remote policy program against a fake Discord API."""

import ast
import contextlib
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError


class Response(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(json.dumps(body).encode() if body is not None else b"")
        self.status = status


class ReconciliationTests(unittest.TestCase):
    def run_policy(self, apply, member=True, roles=None):
        tree = ast.parse(Path(__file__).with_name("omar-admin-access.py").read_text())
        program = next(
            node.value.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "remote" for t in node.targets)
            and isinstance(node.value, ast.Constant)
        )
        policy = {
            "credentialFile": "/fake/credentials",
            "roleName": "Aphrody Administrator",
            "permissions": "8",
            "primaryUserId": "1323725494184841256",
            "alternateUserIds": [],
        }
        program = program.replace("POLICY", repr(json.dumps(policy))).replace(
            "APPLY", str(apply)
        )
        current_roles = roles if roles is not None else []
        member_roles = []
        writes = []

        def api(request, timeout):
            self.assertEqual(timeout, 10)
            path = request.full_url.split("/api/v10/")[1]
            method = request.get_method()
            if method != "GET":
                writes.append((method, path))
            if path == "guilds/guild/roles":
                if method == "POST":
                    role = {"id": "new-role", **json.loads(request.data)}
                    current_roles.append(role)
                    return Response(role)
                return Response(current_roles)
            if method == "PATCH":
                current_roles[0].update(json.loads(request.data))
                return Response(current_roles[0])
            if path.endswith("/roles/new-role"):
                self.assertEqual(method, "PUT")
                member_roles.append("new-role")
                return Response(None, 204)
            if not member:
                raise HTTPError(
                    request.full_url, 404, "missing", {}, io.BytesIO(b'{"code":10007}')
                )
            return Response({"roles": member_roles})

        output = io.StringIO()
        with (
            patch(
                "builtins.open",
                return_value=io.StringIO(
                    "DISCORD_GUILD_ID=guild\nDISCORD_BOT_TOKEN=fake\n"
                ),
            ),
            patch("urllib.request.urlopen", side_effect=api),
            contextlib.redirect_stdout(output),
        ):
            # Execute our repository-owned program with all external I/O mocked.
            exec(compile(program, "remote-policy", "exec"), {})  # noqa: S102
        return json.loads(output.getvalue()), writes, current_roles

    def test_plan_never_mutates(self):
        result, writes, _ = self.run_policy(False)
        self.assertEqual(writes, [])
        self.assertEqual(result["members"][0]["state"], "planned")

    def test_grant_only_declared_member_and_verify(self):
        result, writes, _ = self.run_policy(True)
        self.assertEqual(result["members"][0]["state"], "administrator")
        self.assertEqual(
            writes[-1],
            ("PUT", "guilds/guild/members/1323725494184841256/roles/new-role"),
        )

    def test_absent_member_is_pending_without_grant(self):
        result, writes, _ = self.run_policy(True, member=False)
        self.assertEqual(result["members"][0]["state"], "pending-guild-membership")
        self.assertEqual(writes, [("POST", "guilds/guild/roles")])

    def test_existing_permission_bits_preserved(self):
        role = {
            "id": "new-role",
            "name": "Aphrody Administrator",
            "permissions": "1024",
        }
        _, writes, roles = self.run_policy(True, roles=[role])
        self.assertEqual(roles[0]["permissions"], "1032")
        self.assertEqual(writes[0][0], "PATCH")

    def test_managed_role_refused(self):
        role = {
            "id": "new-role",
            "name": "Aphrody Administrator",
            "permissions": "8",
            "managed": True,
        }
        with self.assertRaisesRegex(SystemExit, "Managed role"):
            self.run_policy(True, roles=[role])


if __name__ == "__main__":
    unittest.main()
