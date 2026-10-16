/**
 * Contrat commun des fichiers `cfg.bin.json`.
 *
 * Le dump actuel reste rétrocompatible avec les enveloppes `{ entries }`.
 * `ConfigFile` est la forme normalisée utilisée par les parseurs TypeScript;
 * `VersionedConfigDocument` est la forme d'échange qui peut porter le buildid
 * Steam entre iecode, inagle et niers.
 */

export const CONFIG_SCHEMA_VERSION = 1 as const;

export type ConfigVariableType = "Int" | "Float" | "String" | "List";

export interface ConfigVariable {
  type: ConfigVariableType;
  value: string;
  items?: string[];
}

export interface ConfigNode {
  name: string;
  variables: ConfigVariable[];
  children?: ConfigNode[];
}

/** Forme normalisée exposée aux parseurs. */
export interface ConfigFile {
  name: string;
  variables: ConfigVariable[];
  children: ConfigNode[];
}

/** Forme brute produite par les extracteurs cfg.bin JSON. */
export interface RawConfigFile {
  entries: ConfigNode[];
}

/** Forme versionnée pour les échanges inter-outils. */
export interface VersionedConfigDocument extends RawConfigFile {
  schema_version: typeof CONFIG_SCHEMA_VERSION;
  generator?: string;
  buildid?: number | string | null;
}

export type ConfigDocument = RawConfigFile | VersionedConfigDocument;

export function isVersionedConfigDocument(value: unknown): value is VersionedConfigDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<VersionedConfigDocument>;
  return candidate.schema_version === CONFIG_SCHEMA_VERSION && Array.isArray(candidate.entries);
}
