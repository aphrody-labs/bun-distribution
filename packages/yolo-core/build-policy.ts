// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";

// Publish layout defaults only; host grants and deployment policy stay in their owner store.
const policy = Bun.TOML.parse(await Bun.file(join(import.meta.dir, "../../infra/config/host/host-policy.toml")).text());
await Bun.write(
  join(import.meta.dir, "data/host-layout.json"),
  `${JSON.stringify({ layout: policy.layout }, null, 2)}\n`,
);
