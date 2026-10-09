// SPDX-License-Identifier: Apache-2.0
export function GET() {
  return Response.json({ ok: true, runtime: `bun ${Bun.version}` });
}
