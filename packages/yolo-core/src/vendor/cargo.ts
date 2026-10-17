/**
 * Workspace Cargo.toml configuration reader using native Bun.TOML.
 */
import { resolve } from "node:path";
import { yoloHome } from "../vfs/home";

export interface WorkspaceCargoSummary {
  readonly resolver: string;
  readonly members: readonly string[];
  /** Explicit Cargo selection; null means Cargo applies its implicit workspace/root-package rules. */
  readonly defaultMembers: readonly string[] | null;
  readonly releaseProfile: Record<string, unknown>;
}

export async function readWorkspaceCargo(rootDir: string = yoloHome()): Promise<WorkspaceCargoSummary | null> {
  try {
    const cargoFile = Bun.file(resolve(rootDir, "Cargo.toml"));
    if (!(await cargoFile.exists())) return null;
    const tomlContent = await cargoFile.text();
    const parsed = Bun.TOML.parse(tomlContent) as {
      workspace?: {
        resolver?: string;
        members?: string[];
        "default-members"?: string[];
      };
      profile?: {
        release?: Record<string, unknown>;
      };
    };

    return {
      resolver: parsed.workspace?.resolver ?? "3",
      members: parsed.workspace?.members ?? [],
      defaultMembers: parsed.workspace?.["default-members"] ?? null,
      releaseProfile: parsed.profile?.release ?? {},
    };
  } catch {
    return null;
  }
}
