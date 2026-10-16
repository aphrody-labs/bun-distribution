export const JEV_MODEL = "jev-1.13.0";

export const WINDOWS_FINDING_QUESTIONS = {
  area: {
    type: "choice",
    instructions: "Which area is primarily affected by `finding`?",
    criteria: {
      runtime: "Bun runtime behavior or JavaScript APIs",
      dotnet: ".NET, Roslyn, C# interop, or NativeAOT",
      shell: "PowerShell or Bun Shell compatibility",
      terminal: "Windows Terminal, ConPTY, or terminal rendering",
      toolchain: "MSVC, vcpkg, WinGet, or native build tooling",
      ui: "WinUI, WinRT UI, or Fluent UI",
      none_of_the_above: "The finding does not primarily fit another option",
    },
  },
  impact: {
    type: "score",
    instructions: "How much does `finding` limit the Windows 11 developer experience?",
    criteria: [
      "Cosmetic issue or documentation gap with no blocked workflow",
      "A workflow has a reliable workaround",
      "A common workflow is broken or requires another runtime",
      "Build, data integrity, or security is at risk",
    ],
  },
  needs_reasoning_review: {
    type: "noul",
    instructions: "Does `finding` require deeper technical reasoning before a maintainer can prioritize it?",
    criteria: {
      true: "The evidence is ambiguous, cross-component, or missing a demonstrated cause",
      false: "The finding and its concrete effect are already clear",
    },
  },
} as const;

export interface WindowsFinding {
  summary: string;
  evidence: readonly string[];
  component?: string;
}

export interface JevTriageResult {
  model: string;
  answers: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function buildJevTriageRequest(finding: WindowsFinding) {
  return {
    state: { finding },
    model: JEV_MODEL,
    questions: WINDOWS_FINDING_QUESTIONS,
  } as const;
}

export async function triageWindowsFinding(
  finding: WindowsFinding,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<JevTriageResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required for Jev triage");

  const response = await (options.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildJevTriageRequest(finding)),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Jev triage failed with HTTP ${response.status}`);
  return (await response.json()) as JevTriageResult;
}
