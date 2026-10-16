export const referenceCategories = ["documentation", "sdk", "3ds-reference", "sister-project"] as const;

export type ReferenceCategory = (typeof referenceCategories)[number];

export interface ConsoleReference {
  id: string;
  name: string;
  category: ReferenceCategory;
  url: string;
  role: string;
  localPath?: string;
}

export interface ConsoleReferences {
  schemaVersion: 1;
  references: ConsoleReference[];
}

const token = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadConsoleReferences(): Promise<ConsoleReferences> {
  return Bun.file(new URL("../../plugins/consoles/references.json", import.meta.url)).json();
}

export async function validateConsoleReferences(
  catalog: ConsoleReferences,
  root = new URL("../../../../", import.meta.url).pathname.slice(1).replaceAll("/", "\\"),
): Promise<string[]> {
  const errors: string[] = [];
  if (catalog.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(catalog.references) || catalog.references.length === 0) {
    errors.push("references must be a non-empty array");
    return errors;
  }

  const ids = new Set<string>();
  for (const [index, reference] of catalog.references.entries()) {
    const at = `references[${index}]`;
    if (!token.test(reference.id)) errors.push(`${at}.id must be a token`);
    if (ids.has(reference.id)) errors.push(`${at}.id must be unique`);
    ids.add(reference.id);
    if (!referenceCategories.includes(reference.category)) errors.push(`${at}.category is invalid`);
    if (typeof reference.name !== "string" || reference.name.length === 0) errors.push(`${at}.name is required`);
    if (typeof reference.role !== "string" || reference.role.length === 0) errors.push(`${at}.role is required`);
    try {
      const url = new URL(reference.url);
      if (url.protocol !== "https:") errors.push(`${at}.url must use HTTPS`);
    } catch {
      errors.push(`${at}.url is invalid`);
    }
    if (reference.localPath) {
      if (
        !(reference.localPath.startsWith("crates/") || reference.localPath.startsWith("vendor/")) ||
        reference.localPath.includes("..") ||
        reference.localPath.includes("\\")
      ) {
        errors.push(`${at}.localPath escapes crates`);
      } else if (!(await Bun.file(`${root}/${reference.localPath}/README.md`).exists())) {
        errors.push(`${at}.localPath does not exist: ${reference.localPath}`);
      }
    }
  }
  return errors;
}
