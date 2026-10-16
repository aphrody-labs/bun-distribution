<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR: First remote shell sandbox provider

Status: E2B selected and adapter implemented, 2026-10-02. No live provider session has
been created or qualified yet. Withdrawn 2026-10-09: the adapter crate
`aphrody-shell-sandbox-host` was removed because nothing consumed it; the comparison
below stays as the record for a future remote sandbox.

## Decision

Use **E2B** for the first remote `SandboxHost` adapter. Its documented HTTP API creates
and deletes a sandbox; its sandbox endpoint provides file upload/download and Connect
RPCs for PTY process start, input, resize, signal and reattachment. These operations map
to the existing `SandboxHost`/`ShellSession` contract without a custom guest daemon or
OCI image. The provider access token and API key stay in the existing protected store.
The adapter must bound sandbox lifetime and output, preserve the provider process across
a transport disconnect, and delete the sandbox on teardown.

## Comparison

| Option | API and fit | Cost and cold start | Licence / constraint |
| --- | --- | --- | --- |
| E2B | HTTP sandbox lifecycle plus file and PTY process APIs. Start and Connect use five-byte framed Connect streaming; ordinary PTY controls use JSON. | Hobby has a one-time $100 usage credit; default 2 vCPU/4 GiB lists $0.000028/s CPU plus $0.000018/s RAM. Pro base is $150/month plus usage. Cold start not locally measured. | Hosted service. Live conformance needs a scoped API key and billable sandbox creation. |
| Fly Machines | REST lifecycle works, but file transfer and PTY would require a custom guest service/image in addition to Machine setup. | Usage-based compute; stopped rootfs is $0.15/GB per 30 days. Cold start not locally measured. | Hosted service; organization with card and scoped token required. |
| Cloudflare Sandbox | Sandbox SDK runs on Containers, Workers and Durable Objects; the documented primary integration is Worker-side. | Container CPU/RAM/disk and egress plus Workers and Durable Objects charges; cold start not measured here. | Hosted service; would need a Worker control plane before the Rust host adapter can own lifecycle. |
| Firecracker on owned hosts | Apache-2.0 VMM with REST control API. | Uses existing host capacity, but requires KVM and guest-image/host isolation work; cold start not measured on the owned hosts. | Apache-2.0; `/dev/kvm` access and host hardening must be proven before use. |

The adapter is `aphrody-shell-sandbox-host-e2b`. Its live T11 conformance test runs only
with `APHRODY_E2B_LIVE=1`, `E2B_API_KEY` and `E2B_TEMPLATE_ID`. Dropping the host sends
a sandbox delete request, and the provider timeout bounds lifetime if that request fails.
The test must record create-to-ready latency and billable lifetime before deployment
readiness is claimed. Local compile and protocol framing checks do not prove the API
exchange or cold-start behavior.

Sources: [E2B create sandbox](https://docs.e2b.dev/api-reference/sandboxes/create-sandbox-v2),
[process Start](https://docs.e2b.dev/api-reference/process/start),
[process Connect](https://docs.e2b.dev/api-reference/process/connect),
[process Update](https://docs.e2b.dev/api-reference/process/update),
[file upload](https://docs.e2b.dev/api-reference/filesystem/upload-a-file-and-ensure-the-parent-directories-exist-if-the-file-exists-it-will-be-overwritten),
[file download](https://docs.e2b.dev/api-reference/filesystem/download-a-file),
[Fly Machines API](https://docs.fly.io/machines/api),
[working with the API](https://docs.fly.io/machines/api/working-with-machines-api),
[Machines resource](https://docs.fly.io/machines/api/machines-resource),
[Fly pricing](https://docs.fly.io/about/pricing),
[E2B pricing](https://e2b.dev/pricing),
[Cloudflare Sandbox pricing](https://developers.cloudflare.com/sandbox/platform/pricing/),
[Firecracker requirements](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
and [licence FAQ](https://github.com/firecracker-microvm/firecracker/blob/main/FAQ.md).
