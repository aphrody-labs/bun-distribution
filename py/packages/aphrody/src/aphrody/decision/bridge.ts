// SPDX-License-Identifier: Apache-2.0
/** Private product binding; runtime and native host remain owned by the Bun fork.
 * The caller supplies its qualified host/CPython environment and PYTHONPATH.
 * JSON is an explicit serialization boundary, never shared object memory.
 */
import type { PythonAsync } from "bun:python";

export async function decideJson(python: PythonAsync, argument: string): Promise<string> {
  return await python.call("aphrody.decision.workflow", "decide_json", argument);
}
