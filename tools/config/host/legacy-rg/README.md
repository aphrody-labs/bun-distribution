# Decommissioned rg host configuration (2026-10-03)

Systemd units, nginx server blocks and the sysctl file that served rg on the production host, kept for reference.
The deployed code is frozen on branch `legacy` of `rose-griffon/rg-legacy`; the active line is `aphrody-labs/rg` (`main`).
No secrets here: `.env` files and database dumps live in the git-ignored paths (`apps/rg/**/.env*`, `packages/rg/*/.env`, `data/rg/`).
`rg-zram-swap.service` was kept on the host under the generic name `zram-swap.service`; its unit file is the maintained copy `tools/config/host/systemd/rg/rg-zram-swap.service` (identical, so it is not repeated here).
