// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Built-in agent tools: `update_plan`, `view_image`, and `tool_search`.

pub mod image;
pub mod plan;
pub mod search;

use std::sync::Arc;

use aphrody_toolcall::ToolRegistry;
pub use image::ViewImageTool;
pub use plan::{PlanState, UpdatePlanTool};
pub use search::{ToolCatalog, ToolSearchResult, ToolSearchTool};

/// Register the default suite of built-in tools (`update_plan`, `view_image`, `tool_search`)
/// into the provided [`ToolRegistry`].
///
/// Returns the shared [`PlanState`] and [`ToolCatalog`] handles for inspection or external
/// registration.
pub fn register_builtins(registry: &mut ToolRegistry) -> (PlanState, ToolCatalog) {
    let plan_state = PlanState::new();
    let plan_tool = Arc::new(UpdatePlanTool::new(plan_state.clone()));
    let _ = registry.register(plan_tool.clone());

    let image_tool = Arc::new(ViewImageTool::new());
    let _ = registry.register(image_tool.clone());

    let catalog = ToolCatalog::new();
    let search_tool = Arc::new(ToolSearchTool::new(catalog.clone()));
    let _ = registry.register(search_tool.clone());

    (plan_state, catalog)
}
