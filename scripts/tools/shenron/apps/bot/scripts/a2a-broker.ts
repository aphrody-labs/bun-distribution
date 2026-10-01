#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Compatibility entrypoint; the application owns the broker implementation.
export * from "../../../../../../apps/shenron/bot/scripts/a2a-broker.ts";
import { createBrokerServer, SOCKET, TASKS, MESSAGES } from "../../../../../../apps/shenron/bot/scripts/a2a-broker.ts";

if (import.meta.main) {
  createBrokerServer(SOCKET, TASKS, MESSAGES);
  await new Promise(() => {});
}
