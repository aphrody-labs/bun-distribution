// SPDX-License-Identifier: MIT
const response = await fetch(
  `http://127.0.0.1:${process.env.PORT ?? 8080}/healthz`,
).catch(() => undefined);
process.exit(response?.ok ? 0 : 1);
