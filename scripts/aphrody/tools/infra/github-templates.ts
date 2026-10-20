#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Render the shared issue and PR templates (tools/config/github/templates.json) into each repository's
 * .github. `--check` reports drift without writing (exit 1); default writes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface RepoTemplate {
  root: string;
  product: string;
  bugDescription: string;
  bugIntro: string;
  summaryDescription: string;
  reproductionDescription: string;
  environment: string[];
  environmentDescription: string;
  reproductionVerb: string;
  featureDescription: string;
  featureIntro: string;
  components: string[];
  prComponents: string[];
  prValidations: string[];
}

const root = join(import.meta.dir, "../../../../");
const config = JSON.parse(readFileSync(join(root, "tools/config/github/templates.json"), "utf8")) as {
  repos: Record<string, RepoTemplate>;
};

export function render(r: RepoTemplate): Record<string, string> {
  const bug = `name: "🐛 Signalement de Bug"
description: ${r.bugDescription}
title: "[BUG]: "
labels: ["bug", "triage"]
body:
  - type: markdown
    attributes:
      value: ${r.bugIntro}
  - type: dropdown
    id: component
    attributes:
      label: Composant affecté
      options:
${r.components.map(c => `        - ${c}`).join("\n")}
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: Description du problème
      description: ${r.summaryDescription}
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Étapes de reproduction
      description: ${r.reproductionDescription}
      value: |
        1. Exécuter \`...\`
        2. ${r.reproductionVerb} l'erreur \`...\`
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environnement
      description: ${r.environmentDescription}
      value: |
${r.environment.map(e => `        - ${e}`).join("\n")}
    validations:
      required: false
`;
  const feature = `name: "🚀 Proposition de Fonctionnalité"
description: ${r.featureDescription}
title: "[FEATURE]: "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: ${r.featureIntro}
  - type: textarea
    id: problem
    attributes:
      label: Problème ou cas d'usage visé
      description: Quel besoin ou goulet d'étranglement cette fonctionnalité adresse-t-elle ?
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Solution proposée
      description: Description détaillée de la conception technique envisagée.
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considérées
      description: Quelles autres solutions ou approches ont été évaluées ?
    validations:
      required: false
`;
  const pr = `## 📋 Description des Changements
<!-- Décrivez clairement les modifications apportées et le composant ciblé. -->

### Composant(s) modifié(s) :
${r.prComponents.map(c => `- [ ] ${c}`).join("\n")}

---

## 🧪 Validations Requises
Avant de soumettre, confirmez que les vérifications suivantes ont été exécutées :
${r.prValidations.map(c => `- [ ] ${c}`).join("\n")}
`;
  return {
    ".github/ISSUE_TEMPLATE/bug_report.yml": bug,
    ".github/ISSUE_TEMPLATE/feature_request.yml": feature,
    ".github/pull_request_template.md": pr,
  };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let drift = 0;
  for (const [name, repo] of Object.entries(config.repos)) {
    const base = repo.root.replace(/^~/, homedir());
    for (const [file, text] of Object.entries(render(repo))) {
      const path = join(base, file);
      const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      if (current === text) continue;
      drift++;
      console.log(`${check ? "drift" : "write"} ${name}/${file}`);
      if (!check) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }
    }
  }
  process.exit(check && drift ? 1 : 0);
}
