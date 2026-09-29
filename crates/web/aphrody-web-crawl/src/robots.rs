// SPDX-License-Identifier: Apache-2.0

use url::Url;

#[derive(Debug, Default, Clone)]
struct Group {
    agents: Vec<String>,
    rules: Vec<Rule>,
    crawl_delay_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct Rule {
    allow: bool,
    pattern: String,
}

/// Parsed robots.txt rules, delay and sitemap directives for one origin.
#[derive(Debug, Default, Clone)]
pub struct RobotsFile {
    groups: Vec<Group>,
    sitemaps: Vec<Url>,
}

impl RobotsFile {
    #[must_use]
    pub fn parse(source_url: &Url, content: &str) -> Self {
        let mut result = Self::default();
        let mut current = Group::default();
        for raw in content.trim_start_matches('\u{feff}').lines() {
            let line = raw.split('#').next().unwrap_or_default().trim();
            if line.is_empty() {
                if !current.agents.is_empty() {
                    result.groups.push(std::mem::take(&mut current));
                }
                continue;
            }
            let Some((field, value)) = line.split_once(':') else { continue };
            let value = value.trim();
            match field.trim().to_ascii_lowercase().as_str() {
                "user-agent" => {
                    if !current.rules.is_empty() || current.crawl_delay_ms.is_some() {
                        result.groups.push(std::mem::take(&mut current));
                    }
                    if !value.is_empty() {
                        current.agents.push(value.to_ascii_lowercase());
                    }
                },
                "allow" | "disallow" if !current.agents.is_empty() => {
                    if !value.is_empty() {
                        current.rules.push(Rule {
                            allow: field.trim().eq_ignore_ascii_case("allow"),
                            pattern: value.to_owned(),
                        });
                    }
                },
                "crawl-delay" if !current.agents.is_empty() => {
                    if let Ok(seconds) = value.parse::<f64>()
                        && seconds.is_finite()
                        && seconds >= 0.0
                    {
                        current.crawl_delay_ms =
                            Some((seconds * 1000.0).min(i64::MAX as f64) as i64);
                    }
                },
                "sitemap" | "site-map" => {
                    if let Ok(url) = source_url.join(value)
                        && matches!(url.scheme(), "http" | "https")
                        && !result.sitemaps.contains(&url)
                    {
                        result.sitemaps.push(url);
                    }
                },
                _ => {},
            }
        }
        if !current.agents.is_empty() {
            result.groups.push(current);
        }
        result
    }

    #[must_use]
    pub fn allows(&self, url: &Url, user_agent: &str) -> bool {
        let active = self.active_groups(user_agent);
        let path = match url.query() {
            Some(query) => format!("{}?{query}", url.path()),
            None => url.path().to_owned(),
        };
        active
            .flat_map(|group| &group.rules)
            .filter(|rule| pattern_matches(&path, &rule.pattern))
            .max_by_key(|rule| (rule.pattern.trim_end_matches('$').len(), rule.allow))
            .is_none_or(|rule| rule.allow)
    }

    #[must_use]
    pub fn crawl_delay_ms(&self, user_agent: &str) -> Option<i64> {
        self.active_groups(user_agent).filter_map(|group| group.crawl_delay_ms).next()
    }

    #[must_use]
    pub fn sitemaps(&self) -> &[Url] {
        &self.sitemaps
    }

    fn active_groups<'a>(&'a self, user_agent: &str) -> impl Iterator<Item = &'a Group> {
        let agent = user_agent.to_ascii_lowercase();
        let specific = self
            .groups
            .iter()
            .any(|group| group.agents.iter().any(|entry| entry != "*" && agent.contains(entry)));
        self.groups.iter().filter(move |group| {
            group.agents.iter().any(|entry| {
                if specific { entry != "*" && agent.contains(entry) } else { entry == "*" }
            })
        })
    }
}

fn pattern_matches(path: &str, raw: &str) -> bool {
    let anchored = raw.ends_with('$');
    let pattern = raw.strip_suffix('$').unwrap_or(raw);
    let mut parts = pattern.split('*');
    let first = parts.next().unwrap_or_default();
    if !path.starts_with(first) {
        return false;
    }
    let mut remaining = &path[first.len()..];
    let segments: Vec<_> = parts.collect();
    if segments.is_empty() {
        return !anchored || remaining.is_empty();
    }
    for (index, segment) in segments.iter().enumerate() {
        if anchored && index + 1 == segments.len() && !pattern.ends_with('*') {
            return remaining.ends_with(*segment);
        }
        if let Some(index) = remaining.find(segment) {
            remaining = &remaining[index + segment.len()..];
        } else {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_allow_wins_and_delay_is_specific() {
        let source = Url::parse("https://example.test/robots.txt").unwrap();
        let robots = RobotsFile::parse(
            &source,
            "User-agent: *\nDisallow: /private\nCrawl-delay: 2\n\nUser-agent: Aphrody\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 0.5\nSitemap: /sitemap.xml\n",
        );
        assert!(!robots.allows(&source.join("/private/secret").unwrap(), "AphrodyWeb"));
        assert!(robots.allows(&source.join("/private/public/page").unwrap(), "AphrodyWeb"));
        assert_eq!(robots.crawl_delay_ms("AphrodyWeb"), Some(500));
        assert_eq!(robots.sitemaps()[0].as_str(), "https://example.test/sitemap.xml");
    }

    #[test]
    fn wildcard_and_end_anchor_match_paths() {
        let source = Url::parse("https://example.test/robots.txt").unwrap();
        let robots = RobotsFile::parse(&source, "User-agent: *\nDisallow: /*.pdf$\n");
        assert!(!robots.allows(&source.join("/foo.pdf").unwrap(), "Aphrody"));
        assert!(robots.allows(&source.join("/foo.pdf.html").unwrap(), "Aphrody"));
        let robots = RobotsFile::parse(&source, "User-agent: *\nDisallow: /a*b$\n");
        assert!(!robots.allows(&source.join("/abbb").unwrap(), "Aphrody"));
    }
}
