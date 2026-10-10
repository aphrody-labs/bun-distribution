// SPDX-License-Identifier: Apache-2.0
//! Ownership and local discovery of the Aphrody AI, OS and infra surfaces.
//!
//! This crate does not start services or grant access. Finding an executable
//! proves only that a file exists. The caller must perform a protocol handshake
//! before reporting a service as live or exposing its tools.

use std::{env, path::PathBuf};

/// The repository that owns a capability and its implementation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Layer {
    /// Agent, inference, RAG, CLI, app-server and AI MCP tools.
    Ai,
    /// Privileged kernel, desktop, Web/BXC, WinClean and the public site.
    Os,
    /// Deployment configuration and release operations.
    Infra,
}

/// Transport and trust boundary of a declared surface.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Boundary {
    /// Interactive command line process with its own authorization context.
    LocalProcess,
    /// Private process-to-process JSON-RPC; no network listener is implied.
    LocalStdio,
    /// Public HTTP origin; authentication and policy are enforced by its host.
    PublicHttp,
    /// Deployment control; no runtime tool endpoint is implied.
    Operator,
}

/// Product surfaces. AI and OS MCP capabilities share one canonical server.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Surface {
    AgentCli,
    AppServer,
    AiMcp,
    OsMcp,
    PublicSite,
    Deployment,
}

/// Static ownership and launch metadata. `binary` is only a local file name.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SurfaceSpec {
    pub surface: Surface,
    pub owner: Layer,
    pub boundary: Boundary,
    pub binary: Option<&'static str>,
    pub args: &'static [&'static str],
}

/// The supported surfaces and their owners. The public site is OS-owned and
/// deployed by infra; the operator surface is not an MCP server.
pub const SURFACES: [SurfaceSpec; 6] = [
    SurfaceSpec {
        surface: Surface::AgentCli,
        owner: Layer::Ai,
        boundary: Boundary::LocalProcess,
        binary: Some("aphrody"),
        args: &[],
    },
    SurfaceSpec {
        surface: Surface::AppServer,
        owner: Layer::Ai,
        boundary: Boundary::LocalStdio,
        binary: Some("aphrody"),
        args: &["app-server"],
    },
    SurfaceSpec {
        surface: Surface::AiMcp,
        owner: Layer::Ai,
        boundary: Boundary::LocalStdio,
        binary: Some("aphrody-mcp"),
        args: &["server"],
    },
    SurfaceSpec {
        surface: Surface::OsMcp,
        owner: Layer::Os,
        boundary: Boundary::LocalStdio,
        binary: Some("aphrody-mcp"),
        args: &["server"],
    },
    SurfaceSpec {
        surface: Surface::PublicSite,
        owner: Layer::Os,
        boundary: Boundary::PublicHttp,
        binary: Some("aphrody-site"),
        args: &[],
    },
    SurfaceSpec {
        surface: Surface::Deployment,
        owner: Layer::Infra,
        boundary: Boundary::Operator,
        binary: None,
        args: &[],
    },
];

/// Return the contract for one surface. This does not probe the runtime.
#[must_use]
pub const fn spec(surface: Surface) -> SurfaceSpec {
    match surface {
        Surface::AgentCli => SURFACES[0],
        Surface::AppServer => SURFACES[1],
        Surface::AiMcp => SURFACES[2],
        Surface::OsMcp => SURFACES[3],
        Surface::PublicSite => SURFACES[4],
        Surface::Deployment => SURFACES[5],
    }
}

/// Local file resolution, deliberately weaker than a successful handshake.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalSurface {
    pub spec: SurfaceSpec,
    pub executable: PathBuf,
}

/// Resolve a declared local process from ordered search directories. This
/// does not spawn it and does not make the tool catalog authoritative.
#[must_use]
pub fn find_local_surface(surface: Surface, directories: &[PathBuf]) -> Option<LocalSurface> {
    let declaration = spec(surface);
    if !matches!(declaration.boundary, Boundary::LocalStdio | Boundary::LocalProcess) {
        return None;
    }
    let binary = declaration.binary?;
    let filename = format!("{binary}{}", env::consts::EXE_SUFFIX);
    directories
        .iter()
        .map(|dir| dir.join(&filename))
        .find(|path| path.is_file())
        .map(|executable| LocalSurface { spec: declaration, executable })
}

/// PATH directories in system order. Callers can prepend a release directory
/// before invoking [`find_local_surface`].
#[must_use]
pub fn path_directories() -> Vec<PathBuf> {
    env::var_os("PATH").map_or_else(Vec::new, |path| env::split_paths(&path).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_keeps_ai_os_and_infra_distinct() {
        assert_eq!(spec(Surface::AiMcp).owner, Layer::Ai);
        assert_eq!(spec(Surface::OsMcp).owner, Layer::Os);
        assert_eq!(spec(Surface::PublicSite).owner, Layer::Os);
        assert_eq!(spec(Surface::Deployment).owner, Layer::Infra);
        assert_eq!(spec(Surface::Deployment).binary, None);
        assert_eq!(spec(Surface::PublicSite).boundary, Boundary::PublicHttp);
        assert_eq!(spec(Surface::AiMcp).args, &["server"]);
        assert_eq!(spec(Surface::OsMcp).binary, spec(Surface::AiMcp).binary);
        assert_eq!(spec(Surface::OsMcp).args, spec(Surface::AiMcp).args);
    }

    #[test]
    fn missing_binary_and_public_site_are_not_reported_as_local_mcp() {
        let empty =
            std::env::temp_dir().join(format!("aphrody-ecosystem-absent-{}", std::process::id()));
        assert!(find_local_surface(Surface::AiMcp, &[empty]).is_none());
        assert!(find_local_surface(Surface::PublicSite, &path_directories()).is_none());
        assert!(find_local_surface(Surface::Deployment, &path_directories()).is_none());
    }

    #[test]
    fn resolves_only_the_declared_binary_from_ordered_directories() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("aphrody-ecosystem-{}-{unique}", std::process::id()));
        std::fs::create_dir(&directory).expect("fixture directory");
        let executable = directory.join(format!("aphrody-mcp{}", env::consts::EXE_SUFFIX));
        std::fs::write(&executable, b"fixture").expect("fixture binary");
        let ai = find_local_surface(Surface::AiMcp, std::slice::from_ref(&directory))
            .expect("AI MCP binary found");
        assert_eq!(ai.executable, executable);
        assert_eq!(ai.spec.owner, Layer::Ai);
        let os = find_local_surface(Surface::OsMcp, std::slice::from_ref(&directory))
            .expect("OS MCP capabilities use the same binary");
        assert_eq!(os.executable, ai.executable);
        assert_eq!(os.spec.owner, Layer::Os);
        assert_eq!(os.spec.args, ai.spec.args);
        std::fs::remove_file(&executable).expect("remove fixture binary");
        std::fs::remove_dir(&directory).expect("remove fixture directory");
    }
}
