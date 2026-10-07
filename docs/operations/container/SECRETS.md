<!-- SPDX-License-Identifier: Apache-2.0 -->

# Container secrets

The single encrypted vault is `~/.aphrody/private/container-vault/vault.enc.json`.
It contains the configured WSL, VPS and DBFR environment/credential files with
their original paths and checksums. Values remain separated by host and service.
The collector includes active first-party systemd service environments; it does
not collect databases, conversations, datasets, model weights or build caches.
Sources remain in their existing stores. This is a backup, not a credential rotation.

The native `aphrody infra secrets` owner encrypts the payload with authenticated
AES-256-GCM. A random 256-bit password lives separately in `master.key` (0600).
The directory is 0700, the encrypted file 0600 and exported runtime files 0400.
Temporary plaintext is held in `/dev/shm` and removed on completion.

```sh
bun scripts/tools/secrets/vault.ts sync
bun scripts/tools/secrets/vault.ts status
bun scripts/tools/secrets/vault.ts runtime
```

`sync` collects, verifies decryption, and backs up only the encrypted envelope to
the existing private `aphrody-labs/aphrody` repository and the existing `Aphrody`
Google Drive folder. Both remote copies are downloaded and SHA-256 checked.
The key is never uploaded. Keep `master.key` available independently: cloud
copies cannot be restored without it. The private `backup-status.json` records
the verified destinations. A broad-sharing Drive folder is rejected.

Start the API with the Docker secrets overlay:

```sh
docker compose --env-file "$HOME/.aphrody/private/container-vault/compose.env" \
  -f tools/config/container/compose.yaml -f tools/config/container/compose.secrets.yaml up -d api
```

Only the API token is mounted into this container. `YOLO_API_TOKEN_FILE` is read
at startup; the token is not baked into image layers or build arguments.
The runtime's UID must be able to read the private mounted file (the default
runtime and WSL owner both use UID 1000). Compose file secrets use bind mounts;
host file permissions remain authoritative.

To export another original environment file, choose its host and exact source:

```sh
bun scripts/tools/secrets/vault.ts export vps /etc/aphrody/aphrody-ai-http.env \
  "$HOME/.aphrody/private/container-vault/ai.env"
```

Exports must remain in the private directory. Mount only the environment needed
by that service. Images contain neither the vault nor its decryption key.

The declared user service and daily timer are in
`tools/config/host/systemd/aphrody-container-vault.{service,timer}`. The timer catches
up after WSL starts; it requires the existing SSH, GitHub and Google credentials.
No new account or authentication grant is created. Failure leaves source secrets
unchanged and is reported by systemd; remote backups may have different revisions
if one destination is unavailable.
