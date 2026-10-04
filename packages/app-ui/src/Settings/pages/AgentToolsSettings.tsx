// SPDX-License-Identifier: Apache-2.0
import { A2AStudio } from "../../routes/studio/A2AStudio";

/** Settings and Studio share the same live app-server inventory. */
export function AgentToolsSettings() {
  return <A2AStudio />;
}
