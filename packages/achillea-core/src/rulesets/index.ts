/** Portable validation for ruleset metadata. Persistence remains an adapter concern. */
export interface RulesetValidationInput {
  name: string;
  version: string;
  defaultBo: number;
}

export interface RulesetValidationResult {
  ok: boolean;
  errors: string[];
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function validateRulesetMetadata(ruleset: RulesetValidationInput): RulesetValidationResult {
  const errors: string[] = [];
  if (!ruleset.name || ruleset.name.trim().length === 0) errors.push("name must not be empty");
  if (ruleset.version !== "legacy" && !SEMVER_RE.test(ruleset.version)) {
    errors.push(`version "${ruleset.version}" is not a valid semver (X.Y.Z) or "legacy"`);
  }
  if (!Number.isInteger(ruleset.defaultBo) || ruleset.defaultBo <= 0) {
    errors.push("defaultBo must be a positive integer");
  }
  if (Number.isInteger(ruleset.defaultBo) && ruleset.defaultBo % 2 === 0) {
    errors.push("defaultBo must be an odd number (best-of-N: 1, 3, 5…)");
  }
  return { ok: errors.length === 0, errors };
}
