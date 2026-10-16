// SPDX-License-Identifier: Apache-2.0
// Pure system presets and inference options for local AI models (Jan parity).

export interface SystemPreset {
  label: string;
  prompt: string;
}

export const SYSTEM_PRESETS: Record<string, SystemPreset> = {
  default: {
    label: "Default assistant",
    prompt:
      "You are Aphrody, an advanced AI software engineering assistant running on local hardware.",
  },
  engineer: {
    label: "Autonomous engineer",
    prompt:
      "You are an autonomous senior staff engineer. Analyze problems deeply, formulate verified solutions, follow clean code principles, and prioritize robust error handling.",
  },
  code_reviewer: {
    label: "Rigorous code reviewer",
    prompt:
      "You are a rigorous code reviewer. Check for edge cases, performance pitfalls, security vulnerabilities, and adherence to system invariants.",
  },
  custom: {
    label: "Custom prompt...",
    prompt: "",
  },
};

export const TOKEN_LIMIT_OPTIONS = [
  1024, 2048, 4096, 8192, 16384, 32768,
] as const;

export function filterSessionsList<
  T extends { id: string; preview?: string; cwd?: string },
>(sessions: T[], query: string): T[] {
  if (!query.trim()) return sessions;
  const q = query.toLowerCase();
  return sessions.filter(
    (s) =>
      (s.preview?.toLowerCase().includes(q) ?? false) ||
      s.id.toLowerCase().includes(q) ||
      (s.cwd?.toLowerCase().includes(q) ?? false),
  );
}
