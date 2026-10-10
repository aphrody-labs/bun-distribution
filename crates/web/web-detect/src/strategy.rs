// SPDX-License-Identifier: Apache-2.0
//! Conservative profile selection from native detection evidence.

use crate::{ChallengeProvider, DetectionReport};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScrapeProfile {
    Static,
    Http,
    Render,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WaitFor {
    None,
    DomContentLoaded,
    Load,
    WaitHydration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SiteShape {
    Unknown,
    StaticHtml,
    SsrReact,
    SsrVue,
    SsrSvelte,
    Spa,
    Wordpress,
    Shopify,
    Drupal,
    Ghost,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Strategy {
    pub profile: ScrapeProfile,
    pub wait_for: WaitFor,
    pub block_resources: Vec<String>,
    pub re_detect_after_hydration: bool,
    pub is_spa: bool,
    pub has_anti_bot: bool,
    pub shape: SiteShape,
    pub rationale: Vec<String>,
}

impl Default for Strategy {
    fn default() -> Self {
        Self {
            profile: ScrapeProfile::Static,
            wait_for: WaitFor::Load,
            block_resources: vec!["image".into(), "media".into(), "font".into()],
            re_detect_after_hydration: true,
            is_spa: false,
            has_anti_bot: false,
            shape: SiteShape::Unknown,
            rationale: vec!["no strong signal".into()],
        }
    }
}

pub fn suggest_strategy(report: &DetectionReport) -> Strategy {
    let has = |name: &str| report.findings.iter().any(|item| item.name.eq_ignore_ascii_case(name));
    let shape = if has("WordPress") {
        SiteShape::Wordpress
    } else if has("Shopify") {
        SiteShape::Shopify
    } else if has("Drupal") {
        SiteShape::Drupal
    } else if has("Ghost") {
        SiteShape::Ghost
    } else if has("Next.js") {
        SiteShape::SsrReact
    } else if has("Nuxt.js") {
        SiteShape::SsrVue
    } else if has("SvelteKit") {
        SiteShape::SsrSvelte
    } else if has("React") || has("Vue.js") || has("Angular") {
        SiteShape::Spa
    } else if has("Astro") || has("Gatsby") {
        SiteShape::StaticHtml
    } else {
        SiteShape::Unknown
    };

    let challenge = report.challenge.provider;
    let has_anti_bot =
        !matches!(challenge, ChallengeProvider::None | ChallengeProvider::JsRequired);
    let is_spa = shape == SiteShape::Spa || challenge == ChallengeProvider::JsRequired;
    let (profile, wait_for, why) = if challenge == ChallengeProvider::RateLimit {
        (ScrapeProfile::Static, WaitFor::None, "rate limited; wait before retry")
    } else if has_anti_bot {
        (ScrapeProfile::Http, WaitFor::DomContentLoaded, "anti-bot challenge detected")
    } else if is_spa {
        (ScrapeProfile::Http, WaitFor::WaitHydration, "client-side application requires hydration")
    } else if matches!(shape, SiteShape::SsrReact | SiteShape::SsrVue | SiteShape::SsrSvelte) {
        (ScrapeProfile::Http, WaitFor::DomContentLoaded, "SSR framework detected")
    } else {
        (ScrapeProfile::Static, WaitFor::Load, "static response is sufficient")
    };
    let mut block_resources = vec!["image".into(), "media".into(), "font".into()];
    if matches!(
        shape,
        SiteShape::Wordpress | SiteShape::Drupal | SiteShape::Ghost | SiteShape::Shopify
    ) {
        block_resources.push("stylesheet".into());
    }
    Strategy {
        profile,
        wait_for,
        block_resources,
        re_detect_after_hydration: is_spa || report.findings.is_empty(),
        is_spa,
        has_anti_bot,
        shape,
        rationale: vec![why.into()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DetectionInput, detect_response};

    #[test]
    fn wordpress_stays_static() {
        let input = DetectionInput::new(
            "https://example.com",
            200,
            "<link href=\"/wp-content/style.css\">",
        );
        let result = detect_response(&input).unwrap();
        assert_eq!(result.strategy.profile, ScrapeProfile::Static);
        assert_eq!(result.strategy.shape, SiteShape::Wordpress);
    }

    #[test]
    fn next_uses_http_ssr() {
        let input = DetectionInput::new(
            "https://example.com",
            200,
            "<script src=\"/_next/static/x.js\"></script>",
        );
        let result = detect_response(&input).unwrap();
        assert_eq!(result.strategy.profile, ScrapeProfile::Http);
        assert_eq!(result.strategy.wait_for, WaitFor::DomContentLoaded);
    }

    #[test]
    fn js_shell_waits_for_hydration() {
        let input = DetectionInput::new(
            "https://example.com",
            200,
            "<div id=\"root\"></div><script src=\"/x.js\"></script>",
        );
        let result = detect_response(&input).unwrap();
        assert_eq!(result.strategy.wait_for, WaitFor::WaitHydration);
        assert!(result.strategy.re_detect_after_hydration);
    }
}
