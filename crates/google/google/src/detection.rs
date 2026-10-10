// SPDX-License-Identifier: Apache-2.0
//! Google site fingerprinting and scraping strategy shared by CLI and MCP.
//!
//! Ported from the Web checkout's `google/detector.ts` and `strategy.ts`.

use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::search::is_google_domain;

static MARKERS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r#"ng-version|ng-app|_nghost-|lit-html|<lit-|jsaction="|jscontroller="|"#,
        r#"tensorflow|tfjs|flutter|flt-|firebase|google-cloud|gcp|kubernetes|k8s|"#,
        r#"golang|go\.dev|material-components-web|mdc-|m3-|google\.com/recaptcha|"#,
        r#"grecaptcha|recaptcha/enterprise|recaptcha/api2|gemini|bard\.google|vertex|"#,
        r#"aistudio|generativelanguage|workspace|gsuite|appspot\.com|firebase-app|"#,
        r#"googletagmanager|gtag\.js|analytics\.js|adsense|doubleclick|gtm\.js|"#,
        r#"youtube\.com/embed|google-pay|stadia|chrome-extension|polymer"#,
    ))
    .expect("Google marker pattern")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleFramework {
    Angular,
    Lit,
    Wiz,
    Internal,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AntiBotKind {
    RecaptchaV2,
    RecaptchaV3,
    RecaptchaEnterprise,
    CaptchaForm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleHosting {
    Appspot,
    Firebase,
    CloudRun,
    GoogleSites,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDetection {
    pub is_google_owned: bool,
    pub is_material_design: bool,
    pub framework: GoogleFramework,
    pub has_anti_bot: bool,
    pub anti_bot_kind: Option<AntiBotKind>,
    pub products: Vec<String>,
    pub hosting: GoogleHosting,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectedTech {
    pub name: String,
    pub categories: Vec<String>,
}

/// Scan a fetched response. `headers` are case insensitive HTTP header pairs.
pub fn detect_google_specifics(
    url: &str,
    headers: &[(String, String)],
    body: &str,
) -> GoogleDetection {
    let hostname = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_google_owned = is_google_domain(&hostname);
    let mut evidence = Vec::new();
    if is_google_owned {
        evidence.push("hostname matches google domain list".to_owned());
    }

    let matches: HashSet<&str> = MARKERS.find_iter(body).map(|m| m.as_str()).collect();
    let has = |marker: &str| matches.contains(marker);
    let framework = if has("ng-version") || has("ng-app") || has("_nghost-") {
        evidence.push("angular markers (ng-version/ng-app) found".to_owned());
        GoogleFramework::Angular
    } else if has("lit-html") || has("<lit-") {
        evidence.push("lit markers found".to_owned());
        GoogleFramework::Lit
    } else if has("jsaction=\"") && has("jscontroller=\"") {
        evidence.push("wiz markers (jsaction/jscontroller) found".to_owned());
        GoogleFramework::Wiz
    } else {
        GoogleFramework::None
    };

    for (found, label) in [
        (has("tensorflow") || has("tfjs"), "TensorFlow detected"),
        (has("flutter") || has("flt-"), "Flutter detected"),
        (has("firebase"), "Firebase detected"),
        (has("google-cloud") || has("gcp"), "GCP signals detected"),
        (has("kubernetes") || has("k8s"), "Kubernetes signals detected"),
        (has("golang") || has("go.dev"), "Go signals detected"),
    ] {
        if found {
            evidence.push(label.to_owned());
        }
    }

    let is_material_design = hostname.contains("material.io")
        || hostname.contains("design.google")
        || has("material-components-web")
        || has("mdc-")
        || has("m3-");
    if is_material_design {
        evidence.push("material design markers found".to_owned());
    }

    let anti_bot_kind =
        if body.contains("recaptcha/enterprise") || body.contains("enterprise.js?render=") {
            evidence.push("reCAPTCHA Enterprise detected".to_owned());
            Some(AntiBotKind::RecaptchaEnterprise)
        } else if has("grecaptcha")
            && (body.contains("grecaptcha.execute(") || body.contains("data-action="))
        {
            evidence.push("reCAPTCHA v3 detected (invisible)".to_owned());
            Some(AntiBotKind::RecaptchaV3)
        } else if has("google.com/recaptcha") || has("grecaptcha") {
            evidence.push("reCAPTCHA v2 detected".to_owned());
            Some(AntiBotKind::RecaptchaV2)
        } else if body.contains("id=\"captcha-form\"") || body.contains("CaptchaForm") {
            evidence.push("Google captcha-form detected".to_owned());
            Some(AntiBotKind::CaptchaForm)
        } else {
            None
        };
    let mut has_anti_bot = anti_bot_kind.is_some();
    if url.contains("udm=14") {
        evidence.push("Classic Web View (udm=14) enforced".to_owned());
    }
    let has_header = |name: &str| headers.iter().any(|(key, _)| key.eq_ignore_ascii_case(name));
    let header_value = |name: &str| {
        headers
            .iter()
            .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(value.as_str()))
    };
    if has_header("x-google-gfe-request-trace") && header_value("status") == Some("429") {
        has_anti_bot = true;
        evidence.push("google GFE rate limit (429) with trace header".to_owned());
    }
    if body.contains("gstatic.com") || body.contains("googleapis.com") {
        evidence.push("Google CDN usage detected".to_owned());
    }

    let mut products = Vec::new();
    for (found, product) in [
        (has("gemini") || hostname.contains("gemini.google"), "Gemini"),
        (has("bard.google"), "Bard"),
        (has("vertex") || has("aistudio"), "Vertex AI"),
        (has("generativelanguage"), "Generative Language API"),
        (has("firebase") || has("firebase-app"), "Firebase"),
        (has("googletagmanager") || has("gtm.js"), "Google Tag Manager"),
        (has("gtag.js") || has("analytics.js"), "Google Analytics"),
        (has("adsense"), "AdSense"),
        (has("doubleclick"), "DoubleClick"),
        (has("youtube.com/embed"), "YouTube Embed"),
        (has("google-pay"), "Google Pay"),
        (has("workspace") || has("gsuite"), "Google Workspace"),
    ] {
        if found {
            products.push(product.to_owned());
        }
    }

    let hosting = if hostname.ends_with(".appspot.com") || has("appspot.com") {
        GoogleHosting::Appspot
    } else if hostname.ends_with(".firebaseapp.com") || hostname.ends_with(".web.app") {
        GoogleHosting::Firebase
    } else if hostname.ends_with(".run.app") {
        GoogleHosting::CloudRun
    } else if hostname.ends_with(".sites.google.com") {
        GoogleHosting::GoogleSites
    } else {
        GoogleHosting::None
    };
    if hosting != GoogleHosting::None {
        evidence.push(format!("hosting: {}", hosting.as_str()));
    }

    GoogleDetection {
        is_google_owned,
        is_material_design,
        framework,
        has_anti_bot,
        anti_bot_kind,
        products,
        hosting,
        evidence,
    }
}

impl GoogleHosting {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Appspot => "appspot",
            Self::Firebase => "firebase",
            Self::CloudRun => "cloud-run",
            Self::GoogleSites => "google-sites",
            Self::None => "none",
        }
    }
}

/// Convert Google-specific signals to the generic technology format.
pub fn google_to_tech(detection: &GoogleDetection) -> Vec<DetectedTech> {
    let mut technologies = Vec::new();
    let mut add = |name: &str, categories: &[&str]| {
        technologies.push(DetectedTech {
            name: name.to_owned(),
            categories: categories.iter().map(|category| (*category).to_owned()).collect(),
        });
    };
    if detection.is_google_owned {
        add("Google", &["Cloud PaaS"]);
    }
    if detection.is_material_design {
        add("Material Design", &["UI frameworks"]);
    }
    for (signal, name) in [
        ("TensorFlow", "TensorFlow"),
        ("Flutter", "Flutter"),
        ("Firebase", "Firebase"),
        ("GCP", "Google Cloud Platform"),
        ("Kubernetes", "Kubernetes"),
        ("Go", "Go"),
    ] {
        for evidence in &detection.evidence {
            if evidence.contains(signal) {
                add(name, &["Libraries", "Development"]);
            }
        }
    }
    let framework_name = match detection.framework {
        GoogleFramework::Angular => Some("Angular"),
        GoogleFramework::Lit => Some("Lit"),
        GoogleFramework::Wiz => Some("Wiz (Google Internal)"),
        GoogleFramework::Internal => Some("Google Internal"),
        GoogleFramework::None => None,
    };
    if let Some(name) = framework_name {
        add(name, &["JavaScript frameworks"]);
    }
    if detection.has_anti_bot {
        let name = match detection.anti_bot_kind {
            Some(kind) => format!("Google Anti-Bot ({})", kind.as_str()),
            None => "Google Anti-Bot".to_owned(),
        };
        add(&name, &["Security"]);
    }
    for product in &detection.products {
        add(product, &["Google Products"]);
    }
    let hosting_name = match detection.hosting {
        GoogleHosting::Appspot => Some("Google App Engine"),
        GoogleHosting::Firebase => Some("Firebase Hosting"),
        GoogleHosting::CloudRun => Some("Google Cloud Run"),
        GoogleHosting::GoogleSites => Some("Google Sites"),
        GoogleHosting::None => None,
    };
    if let Some(name) = hosting_name {
        add(name, &["PaaS", "Hosting"]);
    }
    technologies
}

impl AntiBotKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::RecaptchaV2 => "recaptcha-v2",
            Self::RecaptchaV3 => "recaptcha-v3",
            Self::RecaptchaEnterprise => "recaptcha-enterprise",
            Self::CaptchaForm => "captcha-form",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleWaitFor {
    DomContentLoaded,
    WaitHydration,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStrategy {
    pub profile: String,
    pub wait_for: GoogleWaitFor,
    pub block_resources: Vec<String>,
    pub is_spa: bool,
    pub has_anti_bot: bool,
    pub shape: String,
    pub rationale: Vec<String>,
}

/// Choose the source Web headless policy for a Google property.
pub fn suggest_google_strategy(detection: &GoogleDetection, url: &str) -> GoogleStrategy {
    let hostname = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut rationale = Vec::new();
    let mut wait_for = GoogleWaitFor::DomContentLoaded;
    if hostname.contains("gemini.google") {
        rationale.push(
            "Gemini detected → curl profile; interactive mode is Aphrody OS Obscura/Tauri"
                .to_owned(),
        );
    } else if matches!(detection.framework, GoogleFramework::Wiz | GoogleFramework::Angular) {
        wait_for = GoogleWaitFor::WaitHydration;
        rationale.push(format!(
            "Google SPA framework ({}) → profile=http + wait-hydration",
            match detection.framework {
                GoogleFramework::Wiz => "wiz",
                _ => "angular",
            }
        ));
    } else if detection.is_material_design {
        rationale.push("Material Design site → profile=http + domcontentloaded".to_owned());
    } else if detection.has_anti_bot {
        rationale.push(
            "Google anti-bot detected → curl profile; no browser subprocess fallback".to_owned(),
        );
    } else if matches!(detection.hosting, GoogleHosting::Firebase | GoogleHosting::CloudRun) {
        rationale.push(format!("Google PaaS ({}) → profile=http", detection.hosting.as_str()));
    }
    GoogleStrategy {
        profile: "http".to_owned(),
        wait_for,
        block_resources: ["image", "media", "font"].map(str::to_owned).to_vec(),
        is_spa: detection.framework != GoogleFramework::None,
        has_anti_bot: detection.has_anti_bot,
        shape: if detection.framework == GoogleFramework::None { "static-html" } else { "spa" }
            .to_owned(),
        rationale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wiz_gemini_and_product_signals() {
        let detection = detect_google_specifics(
            "https://gemini.google.com/app",
            &[],
            r#"<div jsaction="open" jscontroller="Root">gemini firebase</div>"#,
        );
        assert!(detection.is_google_owned);
        assert_eq!(detection.framework, GoogleFramework::Wiz);
        assert_eq!(detection.products, ["Gemini", "Firebase"]);
        assert!(google_to_tech(&detection).iter().any(|tech| tech.name == "Wiz (Google Internal)"));
    }

    #[test]
    fn detects_enterprise_captcha_and_gfe_limit() {
        let detection = detect_google_specifics(
            "https://example.com/",
            &[
                ("X-Google-GFE-Request-Trace".to_owned(), "trace".to_owned()),
                ("status".to_owned(), "429".to_owned()),
            ],
            "recaptcha/enterprise",
        );
        assert!(!detection.is_google_owned);
        assert!(detection.has_anti_bot);
        assert_eq!(detection.anti_bot_kind, Some(AntiBotKind::RecaptchaEnterprise));
    }

    #[test]
    fn strategy_matches_google_spa_policy() {
        let detection = detect_google_specifics("https://docs.google.com", &[], "ng-version");
        let strategy = suggest_google_strategy(&detection, "https://docs.google.com");
        assert_eq!(strategy.profile, "http");
        assert_eq!(strategy.wait_for, GoogleWaitFor::WaitHydration);
        assert!(strategy.is_spa);
    }
}
