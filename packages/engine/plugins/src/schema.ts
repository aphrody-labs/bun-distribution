/**
 * Normalized Plugin & Agent Manifest Schemas
 * Directly aligned with Antigravity / Claude Code / Codex plugins
 */

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly license?: string;
  readonly repository?: string;
  readonly engines?: {
    readonly bun?: string;
    readonly typescript?: string;
  };
}

export interface HookDefinition {
  readonly type: "command";
  readonly command: string;
  readonly timeout?: number;
}

export interface HookMatcherGroup {
  readonly matcher: string;
  readonly hooks: readonly HookDefinition[];
}

export interface PluginHooksManifest {
  readonly [pluginName: string]: {
    readonly enabled: boolean;
    readonly SessionStart?: readonly HookMatcherGroup[];
    readonly PreCommand?: readonly HookMatcherGroup[];
    readonly PostCommand?: readonly HookMatcherGroup[];
  };
}

export interface AgentManifest {
  readonly name: string;
  readonly description: string;
  readonly role?: string;
  readonly tools?: string;
  readonly model?: string;
  readonly instructions: string;
}

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  readonly license?: string;
  readonly instructions: string;
}
