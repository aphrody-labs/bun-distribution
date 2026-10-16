// SPDX-License-Identifier: Apache-2.0
export interface M3LintRule {
  meta: {
    type: "problem" | "suggestion" | "layout";
    docs?: { description?: string };
    schema: readonly unknown[];
    messages?: Record<string, string>;
  };
  create(context: unknown): Record<string, (node: unknown) => void>;
}
export interface M3LintPlugin {
  meta: { name: string; version: string };
  rules: Record<string, M3LintRule>;
  configs: Record<
    string,
    {
      plugins: Record<string, M3LintPlugin>;
      rules: Record<string, "error" | "warn" | "off">;
    }
  >;
}
declare const plugin: M3LintPlugin;
export default plugin;
