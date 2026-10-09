// SPDX-License-Identifier: Apache-2.0
// Server-only values: TEMPLATES is read once at server start from m3/templates/stack.toml and the
// template directories (templates-source.ts) and served by GET /api/templates. The browser imports
// the types only.
import { loadTemplates } from "./templates-source";

export interface TemplateFile {
  name: string;
  path: string;
  language: string;
  content: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  cliCommand: string;
  dependencies: Record<string, string>;
  files: TemplateFile[];
}

export const TEMPLATES: TemplateDefinition[] = await loadTemplates();
