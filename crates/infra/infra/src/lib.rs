// SPDX-License-Identifier: Apache-2.0
//! Unified Aphrody Infrastructure Library.
//!
//! Provides core domain models, observability, lifecycle management,
//! cross-catalog validation, pipeline orchestration, remote SSH operations,
//! Git ecosystem automation, Mullvad VPN/proxy control, and embedded HTTP API.

pub mod api;
pub mod catalog;
pub mod cli;
pub mod devenv;
pub mod drive;
pub mod lifecycle;
pub mod local_ai;
pub mod nginx;
pub mod pipeline;
pub mod probe;
pub mod reclaim;
pub mod secrets;
pub mod validate;

pub use cli::cli_main;

pub use drive::{
    DriveFileNode, DriveTreeNode, GitOverview, MountKind, VirtualDriveEngine, VirtualMount,
};

pub use catalog::{CatalogService, ServiceCatalog, TargetInfo, TargetMatrix};
pub use lifecycle::{ServiceAction, ServiceActionResult, ServiceStatusResult};
pub use nginx::{LocationBlock, NginxConfig, ServerBlock, UpstreamBlock, UpstreamTarget};
pub use pipeline::{PipelineConfig, PipelineStage, PipelineStep, StageExecutionResult};
pub use probe::ProbeResult;

// Full subsystem re-exports
pub use aphrody_git as git;
pub use aphrody_ovh as ovh;
pub use aphrody_ssh as ssh;
pub use aphrody_vpn as vpn;
pub use aphrody_yolo as yolo;
