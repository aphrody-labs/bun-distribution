// SPDX-License-Identifier: Apache-2.0
import type { File } from "@aphrody/drive-client";
import { useNavigate } from "react-router-dom";
import { buildAskAphrodyPrompt } from "../ai-helpers";

/** Opens the real chat composer with file context; inference requires the user's send action. */
export function useAskAphrody() {
  const navigate = useNavigate();
  return (targets: File[]) => {
    if (targets.length === 0) return;
    const { prompt, parentDir, targetPaths } = buildAskAphrodyPrompt(targets);
    navigate("/chat", {
      state: { initialPrompt: prompt, cwd: parentDir, contextFiles: targetPaths },
    });
  };
}
