// SPDX-License-Identifier: Apache-2.0
//! Product-site CLI: the same native catalog and app-ui server as HTTP/MCP.
use clap::{Args, Subcommand, ValueEnum};
use miette::IntoDiagnostic;
use std::{
    io::{self, Write},
    net::SocketAddr,
    path::PathBuf,
};

#[derive(Args, Debug, Clone)]
pub struct SiteCli {
    /// Repository containing canonical M3 templates. Defaults to
    /// APHRODY_WORKSPACE_ROOT, then the current working directory.
    #[arg(long, global = true)]
    pub root: Option<PathBuf>,
    #[command(subcommand)]
    pub action: SiteAction,
}

#[derive(Subcommand, Debug, Clone)]
pub enum SiteAction {
    /// Print the native product catalog as JSON.
    Catalog {
        #[arg(value_enum, default_value = "all")]
        kind: CatalogKind,
        #[arg(long)]
        pretty: bool,
        /// Search documentation title, summary, tags and content.
        #[arg(long)]
        q: Option<String>,
        /// Exact documentation category (All selects every category).
        #[arg(long)]
        category: Option<String>,
        /// Exact documentation article identifier.
        #[arg(long)]
        id: Option<String>,
    },
    /// Serve native product pages and JSON APIs through the canonical router.
    Serve {
        /// Compose the agent application and RPC/events on the same loopback listener.
        #[arg(long)]
        app: bool,
        #[arg(long, default_value = "127.0.0.1:3000")]
        bind: SocketAddr,
        /// Separate Bun WebOS origin; redirect only, never privileged proxy.
        #[arg(long)]
        webos_url: Option<String>,
    },
}

#[derive(ValueEnum, Debug, Clone, Copy)]
pub enum CatalogKind {
    All,
    Docs,
    Templates,
}

impl SiteCli {
    pub async fn execute(self) -> miette::Result<()> {
        let root = self
            .root
            .or_else(|| std::env::var_os("APHRODY_WORKSPACE_ROOT").map(PathBuf::from))
            .map_or_else(std::env::current_dir, Ok)
            .into_diagnostic()?;
        match self.action {
            SiteAction::Serve { bind, webos_url, app } => {
                let webos_url = webos_url.or_else(|| std::env::var("BUN_WEBOS_URL").ok());
                if app {
                    aphrody_app_server::serve_http_with_site(&root, bind, webos_url.as_deref())
                        .await
                        .into_diagnostic()
                } else {
                    aphrody_site::serve(&root, bind, webos_url.as_deref()).await.into_diagnostic()
                }
            },
            SiteAction::Catalog { kind, pretty, q, category, id } => {
                let catalog = aphrody_site::Catalog::load(&root).into_diagnostic()?;
                let value =
                    catalog_value(&catalog, kind, &aphrody_site::SearchFilter { q, category, id })
                        .into_diagnostic()?;
                let mut output = io::stdout().lock();
                if pretty {
                    serde_json::to_writer_pretty(&mut output, &value)
                } else {
                    serde_json::to_writer(&mut output, &value)
                }
                .into_diagnostic()?;
                writeln!(output).into_diagnostic()
            },
        }
    }
}

fn catalog_value(
    catalog: &aphrody_site::Catalog,
    kind: CatalogKind,
    filter: &aphrody_site::SearchFilter,
) -> io::Result<serde_json::Value> {
    let view = match kind {
        CatalogKind::Docs => aphrody_site::CatalogView::Docs,
        CatalogKind::Templates => aphrody_site::CatalogView::Templates,
        CatalogKind::All => aphrody_site::CatalogView::All,
    };
    catalog.select(view, filter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    struct TestCli {
        #[command(flatten)]
        site: SiteCli,
    }

    #[test]
    fn parses_all_actions_with_explicit_root_and_bind() {
        let cli =
            TestCli::try_parse_from(["site", "catalog", "templates", "--root", ".", "--pretty"])
                .unwrap();
        assert!(matches!(
            cli.site.action,
            SiteAction::Catalog { kind: CatalogKind::Templates, pretty: true, .. }
        ));
        assert_eq!(cli.site.root, Some(PathBuf::from(".")));
        let cli = TestCli::try_parse_from([
            "site",
            "serve",
            "--bind",
            "127.0.0.1:0",
            "--webos-url",
            "http://127.0.0.1:3001",
        ])
        .unwrap();
        assert!(matches!(cli.site.action, SiteAction::Serve { bind, .. } if bind.port() == 0));
        assert!(TestCli::try_parse_from(["site", "render", "unknown"]).is_err());
    }

    #[test]
    fn catalog_output_uses_shared_native_values() {
        let catalog = aphrody_site::Catalog {
            docs: serde_json::json!([{ "id": "native-doc" }]),
            templates: serde_json::json!([{ "id": "native-template" }]),
        };
        let filter = aphrody_site::SearchFilter::default();
        assert_eq!(catalog_value(&catalog, CatalogKind::Docs, &filter).unwrap(), catalog.docs);
        assert_eq!(
            catalog_value(&catalog, CatalogKind::Templates, &filter).unwrap(),
            catalog.templates
        );
        assert_eq!(
            catalog_value(&catalog, CatalogKind::All, &filter).unwrap()["templates"],
            catalog.templates
        );
    }

    #[test]
    fn catalog_filters_parse_and_delegate_to_shared_owner() {
        let cli = TestCli::try_parse_from([
            "site",
            "catalog",
            "docs",
            "--q",
            "native",
            "--category",
            "Architecture",
            "--id",
            "first",
        ])
        .unwrap();
        assert!(
            matches!(cli.site.action, SiteAction::Catalog { q: Some(q), category: Some(category), id: Some(id), .. } if q == "native" && category == "Architecture" && id == "first")
        );
        let catalog = aphrody_site::Catalog {
            docs: serde_json::json!([
                {"id":"first", "title":"Native Rust", "category":"Architecture"},
                {"id":"second", "title":"Other", "category":"Architecture"}
            ]),
            templates: serde_json::json!([{ "id":"unchanged" }]),
        };
        let filter = aphrody_site::SearchFilter {
            q: Some("native".into()),
            category: Some("Architecture".into()),
            id: Some("first".into()),
        };
        assert_eq!(
            catalog_value(&catalog, CatalogKind::Docs, &filter).unwrap(),
            catalog.search_docs(&filter)
        );
        let all = catalog_value(&catalog, CatalogKind::All, &filter).unwrap();
        assert_eq!(all["docs"].as_array().unwrap().len(), 1);
        assert_eq!(all["templates"], catalog.templates);
        assert_eq!(
            catalog_value(&catalog, CatalogKind::Templates, &filter).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
        assert!(
            catalog_value(
                &catalog,
                CatalogKind::Templates,
                &aphrody_site::SearchFilter { q: Some(String::new()), ..Default::default() }
            )
            .is_ok()
        );
    }
}
