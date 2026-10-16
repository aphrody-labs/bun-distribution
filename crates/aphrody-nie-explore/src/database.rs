//! Compatibility facade for the former `aphrody-nie-explore` SQLite registry.
//!
//! Shared database ownership lives in `aphrody-nie-sql`; this module keeps Inacord's
//! existing import paths stable while downstream callers migrate deliberately.

pub use aphrody_nie_sql::{DatabaseRegistry, ExecuteResult, Migration};
