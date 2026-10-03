<!-- SPDX-License-Identifier: Apache-2.0 -->
# Yolo consumer interface requalification

Producer HEAD at observation: `b828a06` (2026-10-03). The working tree was
dirty: another session was extracting the HTTP/MCP implementations into
`packages/core`. This receipt qualifies that observed source tree, not an
installed release or the final extraction commit.

[Measured receipt](yolo-agent-interface-2026-10-03-recheck.json) comes from
`bun scripts/audit/yolo-agent-interfaces.ts /home/aphro/yolo` with synthetic
files and an ephemeral loopback HTTP server. The command exits 1 because
two probes still fail. No credentials or protected files were read.

The valid in-root parse returned its expected declaration. Parent traversal
was refused (HTTP 500). An in-root symlink to a synthetic outside file still
returned the outside declaration (HTTP 200). An ordinary external origin no
longer received a CORS allow header. A malformed origin containing userinfo
was reflected as an allowed origin. That last result is HTTP validation
evidence, not a demonstrated browser exploit: browser-generated origins do
not contain userinfo.

Positive controls, traversal, symlinks and origins are now separate probes;
one refusal cannot mask a failure in another guard. This small suite does
not qualify the complete MCP/HTTP protocol, authentication, lifecycle or
all tools. The earlier receipt remains historical evidence. The producer
owner still needs canonical-path containment and URL-based origin parsing.
