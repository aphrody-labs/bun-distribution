// SPDX-License-Identifier: Apache-2.0
//
// aphrody-skills-runtime — pure-Rust port of @aphrody/skills (TS, 1169 LoC).
//
// Public API mirrors the TS package: a SKILL.md `Frontmatter` parser, a
// filesystem-resolved `Source` registry (6 upstream catalogs), a discovery
// walker, a JSON-backed install manifest, and a schema validator.
//
// All modules are sync, allocation-bounded by the number of skills on disk,
// and AOT-friendly (no reflection, all (de)serialization via serde).

pub mod discover;
pub mod frontmatter;
pub mod manifest;
pub mod plugin_manifest;
pub mod sources;
pub mod validate;

pub use discover::{
    DiscoveredSkill, agent_skill_roots, discover_agent_skills, discover_plugin_skills,
    discover_skills,
};
pub use frontmatter::{FrontMatter, OdMeta, parse_frontmatter, split_frontmatter};
pub use manifest::{
    Manifest, ManifestEntry, ensure_home_exists, manifest_path, read_manifest, skills_home,
    upsert_entry, write_manifest,
};
pub use plugin_manifest::plugin_skill_dirs;
pub use sources::{
    SOURCES, SourceSchema, SourceSlug, SourceSpec, active_sources, resolve_source_root,
    source_by_slug,
};
pub use validate::{ValidationError, validate_frontmatter};
