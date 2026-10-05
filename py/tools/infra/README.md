<!-- SPDX-License-Identifier: Apache-2.0 -->
# Infra Python tools

First-party operational scripts extracted from `aphrody-infra`. They run from
the shared workspace environment and keep their original command arguments:

```sh
uv run --locked --project /home/aphro/aphrody-py python tools/infra/scripts/install-developer-cli.py
uv run --locked --project /home/aphro/aphrody-py python tools/infra/scripts/ops/ovh.py zones
uv run --locked --project /home/aphro/aphrody-py python tools/infra/scripts/rg/prune-vps-releases.py --max-delete 1
uv run --locked --project /home/aphro/aphrody-py pytest tools/infra/scripts/rg/test_prune_vps_releases.py
```

`install-developer-cli.py` reads its catalog from the Infra checkout. Set
`APHRODY_INFRA_ROOT` when that checkout is not at the workstation default.
`APHRODY_PY_ROOT` selects another checkout of this Python workspace when the
commands are launched through the Infra compatibility paths.

`prune-vps-releases.py` is read-only unless passed `--apply` with the required
canonical-root checks. `provision-vps-env.py` and `sync-cron-secret.py` retain
their existing mode and root checks. Do not run these administrative commands
as part of workspace validation.
