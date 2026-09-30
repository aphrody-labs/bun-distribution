// SPDX-License-Identifier: Apache-2.0
//! Challenge and soft-block signals from the source router, without browser I/O.

use crate::DetectionInput;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChallengeProvider {
    None,
    CloudflareBlock,
    CloudflareChallenge,
    CloudflareTurnstile,
    AkamaiBotManager,
    PerimeterX,
    DataDome,
    Kasada,
    Incapsula,
    AwsWaf,
    Sucuri,
    JsRequired,
    SoftBlock,
    RateLimit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Recommendation {
    Static,
    Fast,
    Stealth,
    Max,
    Wait,
    Abort,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Challenge {
    pub provider: ChallengeProvider,
    pub confidence: Confidence,
    pub recommendation: Recommendation,
    pub evidence: Vec<String>,
}

impl Challenge {
    fn new(
        provider: ChallengeProvider,
        confidence: Confidence,
        recommendation: Recommendation,
        evidence: &str,
    ) -> Self {
        Self { provider, confidence, recommendation, evidence: vec![evidence.to_owned()] }
    }
}

pub(crate) fn detect_challenge(input: &DetectionInput) -> Challenge {
    let status = input.http_status;
    let body = input.body.chars().take(50_000).collect::<String>().to_ascii_lowercase();
    let cookie =
        input.header_values("set-cookie").collect::<Vec<_>>().join(" ").to_ascii_lowercase();
    let cf_mitigated = input.header("cf-mitigated").unwrap_or("").to_ascii_lowercase();
    let cf_ray = input.header("cf-ray").is_some();
    let cf_server =
        input.header("server").is_some_and(|v| v.to_ascii_lowercase().contains("cloudflare"));

    if cf_mitigated == "challenge"
        || has_any(&body, &["__cf_chl_opt", "cf_chl_jschl", "challenges.cloudflare.com/turnstile"])
    {
        return Challenge::new(
            ChallengeProvider::CloudflareTurnstile,
            Confidence::High,
            Recommendation::Max,
            "Cloudflare challenge marker",
        );
    }
    if cf_mitigated == "block" || (cf_server && status == 403) {
        return Challenge::new(
            ChallengeProvider::CloudflareBlock,
            Confidence::High,
            Recommendation::Stealth,
            "Cloudflare block header",
        );
    }
    if cf_ray && (400..600).contains(&status) {
        return Challenge::new(
            ChallengeProvider::CloudflareChallenge,
            Confidence::Medium,
            Recommendation::Stealth,
            "Cloudflare ray on error response",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && (has_any(&body, &["name=\"bm-", "akamai bot manager", "reference #"])
            || input.header("x-akamai-transformed").is_some()
            || cookie.contains("_abck="))
    {
        return Challenge::new(
            ChallengeProvider::AkamaiBotManager,
            Confidence::High,
            Recommendation::Max,
            "Akamai Bot Manager marker",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && (has_any(&body, &["id=\"datadome\"", "id='datadome'", "datadome captcha"])
            || input.header("x-dd-b").is_some()
            || cookie.contains("_dd=")
            || cookie.contains("_dd2="))
    {
        return Challenge::new(
            ChallengeProvider::DataDome,
            Confidence::High,
            Recommendation::Max,
            "DataDome challenge marker",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && (cookie.contains("_pxhd=") || cookie.contains("_px2=") || body.contains("/_px/"))
    {
        return Challenge::new(
            ChallengeProvider::PerimeterX,
            Confidence::High,
            Recommendation::Max,
            "PerimeterX challenge marker",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && (body.contains("x-kpsdk-")
            || input.header("x-kpsdk-ct").is_some()
            || input.header("x-kpsdk-st").is_some())
    {
        return Challenge::new(
            ChallengeProvider::Kasada,
            Confidence::High,
            Recommendation::Max,
            "Kasada challenge marker",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && (cookie.contains("visid_incap")
            || cookie.contains("incap_ses")
            || input.header("x-iinfo").is_some())
    {
        return Challenge::new(
            ChallengeProvider::Incapsula,
            Confidence::High,
            Recommendation::Stealth,
            "Imperva challenge marker",
        );
    }
    if status == 429 {
        return Challenge::new(
            ChallengeProvider::RateLimit,
            Confidence::High,
            Recommendation::Wait,
            "HTTP 429",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && has_any(&body, &["awswaf.com", "aws waf captcha", "awswaf-token"])
    {
        return Challenge::new(
            ChallengeProvider::AwsWaf,
            Confidence::Medium,
            Recommendation::Stealth,
            "AWS WAF challenge marker",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && has_any(&body, &["sucuri website firewall", "sucuri.net", "sucuri cloudproxy"])
    {
        return Challenge::new(
            ChallengeProvider::Sucuri,
            Confidence::Medium,
            Recommendation::Stealth,
            "Sucuri challenge marker",
        );
    }
    if status == 200 && looks_like_js_shell(&body) {
        return Challenge::new(
            ChallengeProvider::JsRequired,
            Confidence::Medium,
            Recommendation::Fast,
            "empty app mount with JavaScript bundle",
        );
    }
    if (status >= 400 || short_interstitial(&body))
        && has_any(
            &body,
            &[
                "access denied",
                "verify you are human",
                "unusual traffic",
                "automated queries",
                "checking your browser",
                "captcha",
            ],
        )
    {
        return Challenge::new(
            ChallengeProvider::SoftBlock,
            Confidence::Medium,
            Recommendation::Stealth,
            "short access-denial interstitial",
        );
    }
    Challenge::new(
        ChallengeProvider::None,
        Confidence::High,
        Recommendation::Fast,
        "no challenge markers found",
    )
}

fn has_any(text: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| text.contains(marker))
}

fn short_interstitial(body: &str) -> bool {
    body.len() < 12_000 && visible_text_len(body) < 1_000
}

fn looks_like_js_shell(body: &str) -> bool {
    let has_empty_mount = has_any(
        body,
        &[
            "id=\"root\"></div>",
            "id=\"app\"></div>",
            "id=\"__next\"></div>",
            "id=\"root\"></main>",
            "id=\"app\"></main>",
        ],
    );
    has_empty_mount && body.contains("<script") && visible_text_len(body) < 200
}

fn visible_text_len(html: &str) -> usize {
    let mut inside_tag = false;
    let mut count = 0;
    for ch in html.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag && !ch.is_whitespace() => count += 1,
            _ => {},
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloudflare_challenge_precedes_generic_status() {
        let mut input = DetectionInput::new(
            "https://example.com",
            403,
            "<script src=\"https://challenges.cloudflare.com/turnstile\"></script>",
        );
        input.add_header("CF-Ray", "x-FRA");
        let result = detect_challenge(&input);
        assert_eq!(result.provider, ChallengeProvider::CloudflareTurnstile);
        assert_eq!(result.recommendation, Recommendation::Max);
    }

    #[test]
    fn normal_article_can_mention_captcha() {
        let article = format!(
            "<article>{}</article>",
            "This article explains captcha and contains enough ordinary text. ".repeat(40)
        );
        let input = DetectionInput::new("https://example.com", 200, article);
        assert_eq!(detect_challenge(&input).provider, ChallengeProvider::None);
    }

    #[test]
    fn js_shell_detected_but_hydrated_page_is_not() {
        let shell = DetectionInput::new(
            "https://example.com",
            200,
            "<div id=\"root\"></div><script src=\"/app.js\"></script>",
        );
        assert_eq!(detect_challenge(&shell).provider, ChallengeProvider::JsRequired);
        let page = DetectionInput::new(
            "https://example.com",
            200,
            "<div id=\"root\"><h1>Hello</h1></div><script src=\"/app.js\"></script>",
        );
        assert_eq!(detect_challenge(&page).provider, ChallengeProvider::None);
    }

    #[test]
    fn rate_limit_needs_wait() {
        let input = DetectionInput::new("https://example.com", 429, "");
        assert_eq!(detect_challenge(&input).recommendation, Recommendation::Wait);
    }
}
