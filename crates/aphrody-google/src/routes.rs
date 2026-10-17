// SPDX-License-Identifier: Apache-2.0
//! Public Google entry points and official product guidance, not a crawl queue.
//! Observation date records the homepage/robots inspection, not API stability.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleRoute {
    pub id: &'static str,
    pub url: &'static str,
    pub integration: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleRoutes {
    pub schema_version: u8,
    pub observed_at: &'static str,
    pub robots_url: &'static str,
    pub routes: Vec<GoogleRoute>,
    pub guidance: Vec<GoogleRoute>,
}

/// Bounded catalogue shared by native consumers. These URLs confer no host rights.
pub fn catalog() -> GoogleRoutes {
    GoogleRoutes {
        schema_version: 1,
        observed_at: "2026-10-09",
        robots_url: "https://www.google.com/robots.txt",
        routes: vec![
            GoogleRoute {
                id: "home",
                url: "https://www.google.com/",
                integration: "external-navigation",
            },
            GoogleRoute {
                id: "search",
                url: "https://www.google.com/search",
                integration: "aphrody_search; explicit query only; robots disallows mirroring",
            },
            GoogleRoute {
                id: "images",
                url: "https://www.google.com/imghp",
                integration: "external-navigation",
            },
            GoogleRoute {
                id: "advanced-search",
                url: "https://www.google.com/advanced_search",
                integration: "external-navigation",
            },
            GoogleRoute {
                id: "how-search-works",
                url: "https://www.google.com/search/howsearchworks/",
                integration: "public-reference",
            },
            GoogleRoute {
                id: "dns",
                url: "https://dns.google/resolve",
                integration: "aphrody_google_dns",
            },
            GoogleRoute {
                id: "suggest",
                url: "https://suggestqueries.google.com/complete/search",
                integration: "aphrody_google_suggest",
            },
        ],
        guidance: vec![
            GoogleRoute {
                id: "seo",
                url: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
                integration: "descriptive URLs, crawlable links, unique content and canonical URLs",
            },
            GoogleRoute {
                id: "web-vitals",
                url: "https://web.dev/articles/vitals",
                integration: "measure LCP, INP and CLS with field data; never infer them from HTML",
            },
            GoogleRoute {
                id: "accessible-forms",
                url: "https://web.dev/learn/forms/accessibility",
                integration: "label inputs, keyboard operation and visible feedback",
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_preserves_native_owners_and_public_https_boundaries() {
        let catalog = catalog();
        let mut ids = std::collections::HashSet::new();
        for route in catalog.routes.iter().chain(&catalog.guidance) {
            assert!(ids.insert(route.id));
            let url = url::Url::parse(route.url).unwrap();
            assert_eq!(url.scheme(), "https");
            assert!(url.username().is_empty() && url.password().is_none());
            assert!(url.query().is_none());
        }
        assert!(catalog.routes.iter().any(|route| route.id == "search" && route.integration.contains("robots disallows")));
        assert!(catalog.routes.iter().any(|route| route.integration == "aphrody_google_dns"));
        assert_eq!(serde_json::to_value(catalog).unwrap()["schemaVersion"], 1);
    }
}
