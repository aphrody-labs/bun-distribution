// SPDX-License-Identifier: Apache-2.0
//! Native rules ported from the source detector's HTTP, body and DNS signals.

use crate::{DetectionBucket as Bucket, DetectionInput, DetectionReport};
use std::net::IpAddr;

struct HeaderRule {
    name: &'static str,
    bucket: Bucket,
    header: &'static str,
    contains: Option<&'static str>,
}

const HEADER_RULES: &[HeaderRule] = &[
    HeaderRule { name: "Cloudflare", bucket: Bucket::Cdn, header: "cf-ray", contains: None },
    HeaderRule {
        name: "Cloudflare",
        bucket: Bucket::Cdn,
        header: "cf-cache-status",
        contains: None,
    },
    HeaderRule {
        name: "AWS CloudFront",
        bucket: Bucket::Cdn,
        header: "x-amz-cf-id",
        contains: None,
    },
    HeaderRule {
        name: "Fastly",
        bucket: Bucket::Cdn,
        header: "x-served-by",
        contains: Some("cache-"),
    },
    HeaderRule { name: "Akamai", bucket: Bucket::Cdn, header: "x-akamai-edge", contains: None },
    HeaderRule { name: "Vercel", bucket: Bucket::Hosting, header: "x-vercel-id", contains: None },
    HeaderRule {
        name: "Netlify",
        bucket: Bucket::Hosting,
        header: "x-nf-request-id",
        contains: None,
    },
    HeaderRule { name: "nginx", bucket: Bucket::Server, header: "server", contains: Some("nginx") },
    HeaderRule {
        name: "Apache",
        bucket: Bucket::Server,
        header: "server",
        contains: Some("apache"),
    },
    HeaderRule { name: "Caddy", bucket: Bucket::Server, header: "server", contains: Some("caddy") },
    HeaderRule {
        name: "Microsoft IIS",
        bucket: Bucket::Server,
        header: "server",
        contains: Some("microsoft-iis"),
    },
    HeaderRule {
        name: "Next.js",
        bucket: Bucket::Backend,
        header: "x-powered-by",
        contains: Some("next.js"),
    },
    HeaderRule {
        name: "PHP",
        bucket: Bucket::Language,
        header: "x-powered-by",
        contains: Some("php/"),
    },
    HeaderRule {
        name: "WordPress",
        bucket: Bucket::Cms,
        header: "x-powered-by",
        contains: Some("wordpress"),
    },
    HeaderRule {
        name: "Express",
        bucket: Bucket::Backend,
        header: "x-powered-by",
        contains: Some("express"),
    },
    HeaderRule {
        name: "ASP.NET",
        bucket: Bucket::Backend,
        header: "x-powered-by",
        contains: Some("asp.net"),
    },
    HeaderRule {
        name: "Drupal",
        bucket: Bucket::Cms,
        header: "x-generator",
        contains: Some("drupal"),
    },
    HeaderRule { name: "Varnish", bucket: Bucket::Cdn, header: "via", contains: Some("varnish") },
];

struct BodyRule {
    name: &'static str,
    bucket: Bucket,
    markers: &'static [&'static str],
}

const BODY_RULES: &[BodyRule] = &[
    BodyRule {
        name: "Next.js",
        bucket: Bucket::Frontend,
        markers: &["/_next/static/", "__next_data__", "id=\"__next\""],
    },
    BodyRule {
        name: "Nuxt.js",
        bucket: Bucket::Frontend,
        markers: &["/_nuxt/", "window.__nuxt__", "__nuxt_data__"],
    },
    BodyRule {
        name: "Astro",
        bucket: Bucket::Frontend,
        markers: &["<astro-island", "astro-slot", "data-astro-"],
    },
    BodyRule {
        name: "SvelteKit",
        bucket: Bucket::Frontend,
        markers: &["_app/immutable/", "data-sveltekit-"],
    },
    BodyRule {
        name: "Gatsby",
        bucket: Bucket::Frontend,
        markers: &["___gatsby", "/page-data/app-data.json"],
    },
    BodyRule {
        name: "React",
        bucket: Bucket::Library,
        markers: &["data-reactroot", "__react_devtools_global_hook__"],
    },
    BodyRule { name: "Vue.js", bucket: Bucket::Library, markers: &["data-v-", "__vue__"] },
    BodyRule { name: "Angular", bucket: Bucket::Frontend, markers: &["ng-version=", "ng-app="] },
    BodyRule {
        name: "WordPress",
        bucket: Bucket::Cms,
        markers: &["/wp-content/", "/wp-includes/", "content=\"wordpress "],
    },
    BodyRule {
        name: "Drupal",
        bucket: Bucket::Cms,
        markers: &["/sites/default/files/", "drupal-settings-json", "content=\"drupal"],
    },
    BodyRule {
        name: "Ghost",
        bucket: Bucket::Cms,
        markers: &["ghost-sdk", "/ghost/api/", "content=\"ghost"],
    },
    BodyRule {
        name: "Shopify",
        bucket: Bucket::Cms,
        markers: &["cdn.shopify.com", "window.shopify", "shopify.theme"],
    },
    BodyRule {
        name: "Webflow",
        bucket: Bucket::Hosting,
        markers: &["data-wf-page=", "webflow.js"],
    },
    BodyRule {
        name: "Tailwind CSS",
        bucket: Bucket::Library,
        markers: &["tailwindcss", "tw-elements"],
    },
    BodyRule {
        name: "Google Analytics",
        bucket: Bucket::Analytics,
        markers: &["google-analytics.com/analytics.js", "gtag/js?id=ga-", "gtag/js?id=g-"],
    },
    BodyRule {
        name: "Google Tag Manager",
        bucket: Bucket::TagManager,
        markers: &["googletagmanager.com/gtm.js", "gtm.start"],
    },
    BodyRule { name: "Plausible", bucket: Bucket::Analytics, markers: &["plausible.io/js/script"] },
    BodyRule { name: "Matomo", bucket: Bucket::Analytics, markers: &["matomo.js", "_paq.push"] },
    BodyRule {
        name: "Segment",
        bucket: Bucket::Analytics,
        markers: &["cdn.segment.com/analytics.js", "analytics.load("],
    },
];

const NS_RULES: &[(&str, &[&str])] = &[
    ("Cloudflare DNS", &[".cloudflare.com"]),
    ("AWS Route 53", &[".awsdns-"]),
    ("Google Cloud DNS", &[".googledomains.com", ".zdns.google"]),
    ("Azure DNS", &[".azure-dns.com", ".azure-dns.net"]),
    ("DigitalOcean", &[".digitalocean.com"]),
    ("DNSimple", &[".dnsimple.com"]),
    ("GoDaddy DNS", &[".domaincontrol.com"]),
    ("Namecheap", &[".registrar-servers.com"]),
    ("Vercel DNS", &[".vercel-dns.com"]),
    ("Netlify DNS", &[".nsone.net", ".netlify.com"]),
    ("Hover", &[".hover.com"]),
    ("Gandi", &[".gandi.net"]),
    ("OVH", &[".ovh.net", ".ovh.com"]),
];

const CNAME_RULES: &[(&str, Bucket, &[&str])] = &[
    ("Vercel", Bucket::Hosting, &[".vercel-dns.com", ".vercel.app", ".now.sh"]),
    ("Netlify", Bucket::Hosting, &[".netlify.com", ".netlify.app"]),
    ("GitHub Pages", Bucket::Hosting, &[".github.io"]),
    ("GitLab Pages", Bucket::Hosting, &[".gitlab.io"]),
    ("Heroku", Bucket::Hosting, &[".herokuapp.com", ".herokudns.com"]),
    ("Render", Bucket::Hosting, &[".onrender.com"]),
    ("Fly.io", Bucket::Hosting, &[".fly.dev", ".fly.io"]),
    ("Railway", Bucket::Hosting, &[".railway.app"]),
    ("Google Cloud Run", Bucket::Hosting, &[".appspot.com", ".run.app", ".googleapis.com"]),
    ("AWS S3", Bucket::Hosting, &[".s3.amazonaws.com", ".s3-website"]),
    ("AWS CloudFront", Bucket::Cdn, &[".cloudfront.net"]),
    ("Cloudflare Pages", Bucket::Hosting, &[".pages.dev"]),
    ("Shopify", Bucket::Hosting, &[".myshopify.com"]),
    ("Webflow", Bucket::Hosting, &[".webflow.io", ".webflow.com"]),
];

const IP_RULES: &[(&str, &[&str])] = &[
    (
        "Cloudflare",
        &[
            "104.16.",
            "104.17.",
            "104.18.",
            "104.19.",
            "104.20.",
            "104.21.",
            "104.22.",
            "104.23.",
            "104.24.",
            "104.25.",
            "104.26.",
            "104.27.",
            "162.158.",
            "172.64.",
            "172.65.",
            "172.66.",
            "172.67.",
            "172.68.",
            "172.69.",
            "172.70.",
            "2606:4700:",
        ],
    ),
    ("Fastly", &["151.101.", "146.75.", "199.232.", "2a04:4e42:"]),
    (
        "AWS CloudFront",
        &[
            "13.32.", "13.33.", "13.224.", "13.225.", "13.249.", "18.160.", "18.161.", "18.164.",
            "18.165.", "52.84.", "52.85.", "54.192.", "54.230.", "99.84.", "99.86.",
        ],
    ),
    ("Vercel", &["76.76.21.", "76.76.19.", "64.252."]),
    ("Netlify", &["75.2.", "99.83."]),
    (
        "Akamai",
        &[
            "23.32.", "23.33.", "23.34.", "23.35.", "23.36.", "23.37.", "23.38.", "23.39.",
            "23.40.", "23.42.", "23.43.", "104.64.", "104.65.", "104.66.", "104.67.",
        ],
    ),
];

pub(crate) fn detect_all(input: &DetectionInput, report: &mut DetectionReport) {
    for rule in HEADER_RULES {
        for value in input.header_values(rule.header) {
            if rule.contains.is_none_or(|needle| value.to_ascii_lowercase().contains(needle)) {
                report.push(
                    rule.name,
                    rule.bucket,
                    format!("{}: {}", rule.header, truncate_chars(value, 80)),
                    "header",
                    0.95,
                    None,
                );
            }
        }
    }

    let body_lower = input.body.to_ascii_lowercase();
    for rule in BODY_RULES {
        if let Some(marker) = rule.markers.iter().find(|marker| body_lower.contains(**marker)) {
            let version =
                if rule.name == "Next.js" { extract_next_version(&input.body) } else { None };
            report.push(rule.name, rule.bucket, (*marker).to_owned(), "body", 0.85, version);
        }
    }

    for ns in &input.ns_records {
        let canonical = ns.trim_end_matches('.').to_ascii_lowercase();
        if canonical == "ns.google.com"
            || (canonical.starts_with("ns")
                && canonical.ends_with(".google.com")
                && canonical[2..canonical.len() - ".google.com".len()]
                    .chars()
                    .all(|ch| ch.is_ascii_digit()))
        {
            report.push("Google Cloud DNS", Bucket::Dns, format!("ns:{ns}"), "dns", 0.9, None);
            continue;
        }
        if let Some((name, _)) = NS_RULES
            .iter()
            .find(|(_, suffixes)| suffixes.iter().any(|suffix| canonical.ends_with(suffix)))
        {
            report.push(name, Bucket::Dns, format!("ns:{ns}"), "dns", 0.9, None);
        }
    }
    for cname in &input.cname_chain {
        let canonical = cname.trim_end_matches('.').to_ascii_lowercase();
        if let Some((name, bucket, _)) = CNAME_RULES
            .iter()
            .find(|(_, _, suffixes)| suffixes.iter().any(|suffix| canonical.ends_with(suffix)))
        {
            report.push(name, *bucket, format!("cname:{cname}"), "dns", 0.9, None);
        }
    }
    for ip in &input.resolved_ips {
        if let Some(name) = ip_provider(*ip) {
            report.push(name, Bucket::Cdn, format!("ip:{ip}"), "ip", 0.75, None);
        }
    }
}

fn ip_provider(ip: IpAddr) -> Option<&'static str> {
    let value = ip.to_string();
    IP_RULES.iter().find_map(|(name, prefixes)| {
        prefixes.iter().any(|prefix| value.starts_with(prefix)).then_some(*name)
    })
}

fn extract_next_version(body: &str) -> Option<String> {
    let start = body.find("Next.js v")? + "Next.js v".len();
    let version: String =
        body[start..].chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    (!version.is_empty()).then_some(version)
}

fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect_response;

    #[test]
    fn body_header_and_dns_evidence() {
        let mut input = DetectionInput::new(
            "https://shop.example.com",
            200,
            "<script src=\"/_next/static/app.js\"></script> Next.js v15.2.1",
        );
        input.add_header("X-Powered-By", "Next.js");
        input.add_header("CF-Ray", "abc-FRA");
        input.ns_records.push("alice.ns.cloudflare.com.".into());
        input.cname_chain.push("store.myshopify.com.".into());
        input.resolved_ips.push("104.16.0.1".parse().unwrap());
        let report = detect_response(&input).unwrap();
        assert_eq!(
            report
                .in_bucket(Bucket::Frontend)
                .find(|item| item.name == "Next.js")
                .unwrap()
                .version
                .as_deref(),
            Some("15.2.1")
        );
        assert!(report.in_bucket(Bucket::Backend).any(|item| item.name == "Next.js"));
        assert!(report.in_bucket(Bucket::Dns).any(|item| item.name == "Cloudflare DNS"));
        assert!(report.in_bucket(Bucket::Hosting).any(|item| item.name == "Shopify"));
        assert!(report.in_bucket(Bucket::Cdn).any(|item| item.name == "Cloudflare"));
    }

    #[test]
    fn github_pages_is_not_google_pages() {
        let mut input = DetectionInput::new("https://x.example", 200, "");
        input.cname_chain.push("foo.github.io".into());
        let report = detect_response(&input).unwrap();
        assert!(report.in_bucket(Bucket::Hosting).any(|item| item.name == "GitHub Pages"));
        assert!(!report.findings.iter().any(|item| item.name == "Google Developers Pages"));
    }

    #[test]
    fn network_prefix_does_not_match_partial_octet() {
        assert_eq!(ip_provider("104.160.0.1".parse().unwrap()), None);
        assert_eq!(ip_provider("104.16.0.1".parse().unwrap()), Some("Cloudflare"));
    }
}
