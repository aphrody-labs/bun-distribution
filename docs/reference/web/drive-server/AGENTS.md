# Drive server agent rules

This nested workspace is FSL-1.1-ALv2. Keep it separate from the Apache-2.0
`aphrody-web` Cargo workspace and preserve upstream notices. The `sd-server`
binary and HTTP behavior stay available while route, auth, SSE, sidecar, data
and deployment parity are qualified. Drive backend lives in
`../../aphrody-os/drive`; compiled UI assets live in
`../../aphrody-ui/drive/apps/web/dist`. Do not copy UI source or AI packages
here. The files in `upstream/` are historical deployment references, not
active Aphrody deployment instructions.
