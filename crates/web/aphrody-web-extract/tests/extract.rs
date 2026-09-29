//! Behavioural tests for `extract_main` and friends.

use aphrody_web_extract::{
    BlockKind, ExtractOptions, chunk_blocks, extract_main, extract_main_json,
    extract_main_with_options, hamming_distance, simhash64,
};

const ARTICLE_PARAGRAPHS: [&str; 5] = [
    "The city council approved the northern tram extension on Tuesday, ending a planning process \
     that lasted eleven years, three public inquiries and several redesigns of the route along \
     the old canal.",
    "Engineers found a layer of soft peat under a third of the alignment, which meant piling, \
     vibration studies and, eventually, a compensation fund for the owners of forty Victorian \
     terraces along the towpath.",
    "Heritage officers asked for a slimmer steel bridge beside the listed swing bridge from 1887, \
     and required the original structure to be restored at the project's expense as a condition \
     of consent.",
    "The regional government agreed to close the funding gap once the council signed a \
     fixed-price contract with penalties for late delivery, while a developer paid for two of the \
     seven stops.",
    "Services are expected to start in the spring of 2029, and the council now publishes a \
     monthly progress dashboard so that residents can follow the works without waiting for \
     rumours.",
];

fn boilerplate_heavy_page() -> String {
    let nav: String = (0..40)
        .map(|i| format!("<li><a href=\"/section/{i}\">Section number {i}</a></li>"))
        .collect();
    let related: String = (0..8)
        .map(|i| {
            format!(
                "<div class=\"card\"><a href=\"/story/{i}\"><h3>Related story headline number {i} \
                 about something else</h3></a><p>Teaser {i}.</p></div>"
            )
        })
        .collect();
    let comments: String = (0..6)
        .map(|i| {
            format!(
                "<li class=\"comment\"><p>Comment {i}: I completely disagree with the council and \
                 think the tram is a waste of money, buses would be cheaper and faster to \
                 deploy.</p></li>"
            )
        })
        .collect();
    let footer: String =
        (0..60).map(|i| format!("<a href=\"/f/{i}\">Footer link {i}</a> ")).collect();
    let body: String = ARTICLE_PARAGRAPHS
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let mut s = format!("<p>{p}</p>");
            if i == 1 {
                s.push_str("<h2>Funding and heritage</h2>");
                s.push_str("<div class=\"ad-slot\"><span>Advertisement</span></div>");
            }
            if i == 2 {
                s.push_str(
                    "<ul><li>Regional grant: 140 million</li><li>Municipal bond: 96 \
                     million</li></ul>",
                );
            }
            s
        })
        .collect();
    format!(
        r#"<!doctype html><html lang="en-GB"><head>
<title>Tram extension approved after eleven years | Metro Times</title>
<meta property="og:site_name" content="Metro Times">
<meta name="author" content="Maya Lindqvist">
<link rel="canonical" href="/news/tram-extension?utm_source=feed#top">
<script type="application/ld+json">{{"@context":"https://schema.org","@graph":[{{"@type":"WebSite","name":"Metro Times"}},{{"@type":"NewsArticle","headline":"Tram extension approved after eleven years","datePublished":"2025-03-14T08:30:00+01:00"}}]}}</script>
<style>.x{{color:red}}</style>
</head><body>
<div id="cookie-banner" class="cookie-consent"><p>We use cookies to personalise content and ads, to provide social media features and to analyse our traffic. Accept all cookies or manage your preferences.</p><button>Accept</button></div>
<header class="site-header"><nav class="main-nav"><ul>{nav}</ul></nav></header>
<div class="breadcrumb"><a href="/">Home</a> › <a href="/news">News</a></div>
<main><article>
<h1>Tram extension approved after eleven years</h1>
<div class="share-bar"><a href="https://twitter.com/share">Share on X</a> <a href="https://facebook.com/share">Share on Facebook</a></div>
<div class="article-body">{body}</div>
<div class="newsletter-signup"><h3>Get our newsletter</h3><p>Sign up for the morning briefing and get the day's top stories in your inbox every weekday.</p><form><input type="email"><button>Subscribe</button></form></div>
</article>
<section class="related-posts"><h2>More stories</h2>{related}</section>
<section id="comments"><h2>Comments</h2><ol>{comments}</ol></section>
</main>
<aside class="sidebar"><h3>Most read</h3><ol><li><a href="/a">Most read story one with a long headline</a></li><li><a href="/b">Most read story two with a long headline</a></li></ol></aside>
<footer class="site-footer">{footer}<p>© 2025 Metro Times. All rights reserved. Registered office: 12 Harbour Street.</p></footer>
<script>window.__STATE__ = {{"article": "{p0}"}};</script>
</body></html>"#,
        p0 = ARTICLE_PARAGRAPHS[0]
    )
}

#[test]
fn boilerplate_heavy_page_keeps_article_and_drops_chrome() {
    let html = boilerplate_heavy_page();
    let e =
        extract_main(&html, Some("https://metrotimes.example/news/tram-extension?utm_source=x"));
    for p in ARTICLE_PARAGRAPHS {
        assert!(e.text.contains(p), "missing paragraph: {p}\n---\n{}", e.text);
    }
    assert!(e.text.contains("Funding and heritage"));
    assert!(e.text.contains("Regional grant: 140 million"));
    for junk in [
        "cookies",
        "Section number",
        "Share on X",
        "Advertisement",
        "newsletter",
        "Related story headline",
        "I completely disagree",
        "Most read story",
        "Footer link",
        "Registered office",
        "color:red",
        "__STATE__",
    ] {
        assert!(!e.text.contains(junk), "boilerplate leaked: {junk}\n---\n{}", e.text);
    }
    assert_eq!(e.title, "Tram extension approved after eleven years");
    assert_eq!(e.byline.as_deref(), Some("Maya Lindqvist"));
    assert_eq!(e.published.as_deref(), Some("2025-03-14T08:30:00+01:00"));
    assert_eq!(e.lang.as_deref(), Some("en-GB"));
    assert_eq!(e.site_name.as_deref(), Some("Metro Times"));
    assert_eq!(
        e.canonical.as_deref(),
        Some("https://metrotimes.example/news/tram-extension?utm_source=feed")
    );
    assert_eq!(e.simhash.len(), 16);
    assert_eq!(e.word_count, e.text.split_whitespace().count());
    assert!(e.markdown.contains("## Funding and heritage"), "{}", e.markdown);
    assert!(e.markdown.contains("- Regional grant: 140 million"), "{}", e.markdown);
}

#[test]
fn comments_are_optional() {
    let html = boilerplate_heavy_page();
    let with = extract_main_with_options(
        &html,
        None,
        &ExtractOptions { include_comments: true, ..ExtractOptions::default() },
    );
    assert!(ARTICLE_PARAGRAPHS.iter().all(|p| with.text.contains(p)));
    let without = extract_main(&html, None);
    assert!(!without.text.contains("I completely disagree"));
}

#[test]
fn blocks_carry_heading_paths_and_match_text_verbatim() {
    let html = r#"<html><body><article>
<h1>Guide</h1><p>Intro paragraph that explains what this guide is about in enough words to count as content.</p>
<h2>Install</h2><p>Run the installer and follow the prompts, which should take less than five minutes on most machines.</p>
<pre><code class="language-bash">cargo install aphrody-web

aphrody-web --help</code></pre>
<h3>Linux</h3><ul><li>Use the tarball, it contains a static binary.</li><li>Or use the package manager of your distribution.</li></ul>
<h2>Configure</h2><blockquote><p>Configuration lives in a single TOML file.</p></blockquote>
<table><tr><th>Key</th><th>Default</th></tr><tr><td>threads</td><td>4</td></tr></table>
</article></body></html>"#;
    let e = extract_main(html, Some("https://docs.example/guide"));
    let kinds: Vec<BlockKind> = e.blocks.iter().map(|b| b.kind).collect();
    assert!(kinds.contains(&BlockKind::Heading));
    assert!(kinds.contains(&BlockKind::Code));
    assert!(kinds.contains(&BlockKind::ListItem));
    assert!(kinds.contains(&BlockKind::Quote));
    assert!(kinds.contains(&BlockKind::Table));
    let linux_item =
        e.blocks.iter().find(|b| b.text.starts_with("Use the tarball")).expect("list item");
    assert_eq!(linux_item.heading_path, vec!["Guide", "Install", "Linux"]);
    let configure = e.blocks.iter().find(|b| b.text == "Configure").expect("heading");
    assert_eq!(configure.level, Some(2));
    assert_eq!(configure.heading_path, vec!["Guide"]);
    let quote = e.blocks.iter().find(|b| b.kind == BlockKind::Quote).expect("quote");
    assert_eq!(quote.heading_path, vec!["Guide", "Configure"]);

    // Contract relied upon by the FFI bridge: block texts appear verbatim in
    // `text`, in order, separated by exactly one blank line.
    let joined: Vec<&str> = e.blocks.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(e.text, joined.join("\n\n"));
    assert!(
        e.markdown.contains("```bash\ncargo install aphrody-web\n\naphrody-web --help\n```"),
        "{}",
        e.markdown
    );

    let chunks = chunk_blocks(&e.blocks, 160, 20);
    assert!(chunks.len() >= 3);
    assert!(chunks.iter().all(|c| c.text.chars().count() <= 160));
    assert!(
        chunks
            .iter()
            .any(|c| c.heading_path.starts_with(&["Guide".to_string(), "Install".to_string()]))
    );
}

#[test]
fn json_output_is_valid_and_complete() {
    let json = extract_main_json(&boilerplate_heavy_page(), None);
    let v: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
    for key in [
        "title",
        "byline",
        "published",
        "lang",
        "canonical",
        "site_name",
        "description",
        "text",
        "markdown",
        "blocks",
        "simhash",
        "word_count",
    ] {
        assert!(v.get(key).is_some(), "missing key {key}");
    }
    assert_eq!(v["blocks"][0]["kind"], "heading");
}

#[test]
fn empty_nul_and_malformed_inputs_do_not_panic() {
    let inputs: Vec<String> = vec![
        String::new(),
        "\u{0}".repeat(1000),
        "<".repeat(10_000),
        "<html><body><p>unclosed <b>bold <i>italic <a href='x'>link".to_string(),
        "<table><tr><td><table><td><div><li><pre><code>".repeat(200),
        format!("<p>{}</p>", "\u{0}text\u{0} with NUL ".repeat(200)),
        "<svg><foreignObject><p>inside svg</p></foreignObject></svg><math><mi>x</mi></math>"
            .to_string(),
        "<script>document.write('</scr'+'ipt><p>x</p>')</script><!-- <script> --> <p>after</p>"
            .to_string(),
        "<div>".repeat(100_000),
        "<ul><li>".repeat(20_000) + "deep list text",
        String::from_utf8_lossy(&(0u8..=255).cycle().take(50_000).collect::<Vec<u8>>())
            .into_owned(),
    ];
    for input in &inputs {
        let e = extract_main(input, Some("not a url"));
        assert_eq!(e.simhash.len(), 16);
        let _ = extract_main_json(input, None);
        let _ = aphrody_web_extract::html_to_markdown(input, Some("https://example.com/"));
        let _ = aphrody_web_extract::resolve_canonical(input, Some("https://example.com/"));
        let _ = chunk_blocks(&e.blocks, 50, 10);
    }
    let e = extract_main("", None);
    assert!(e.text.is_empty());
    assert_eq!(e.simhash, "0000000000000000");
}

#[test]
fn large_document_is_linear() {
    let paragraph = format!(
        "<div class=\"post\"><p>{}</p><a href=\"/x\">link</a></div>",
        ARTICLE_PARAGRAPHS.join(" ")
    );
    let html = format!("<html><body><main>{}</main></body></html>", paragraph.repeat(4000));
    assert!(html.len() > 3_000_000);
    let start = std::time::Instant::now();
    let e = extract_main(&html, None);
    let elapsed = start.elapsed();
    assert!(e.word_count > 100_000, "{}", e.word_count);
    // Generous bound: catches accidental quadratic behaviour, not micro-regressions.
    assert!(elapsed.as_secs() < 30, "took {elapsed:?}");
}

#[test]
fn near_duplicate_templates_share_simhash() {
    let a = boilerplate_heavy_page();
    // Same article, different template chrome and tracking parameters.
    let p = ARTICLE_PARAGRAPHS;
    let b = format!(
        "<html><body><div class=\"menu\"><a href=\"/\">Home</a> <a href=\"/about\">About \
         us</a></div><div class=\"content\"><h1>Tram extension approved after eleven \
         years</h1><p>{}</p><p>{}</p><h2>Funding and heritage</h2><p>{}</p><ul><li>Regional \
         grant: 140 million</li><li>Municipal bond: 96 \
         million</li></ul><p>{}</p><p>{}</p></div><div class=\"footer\">Other site footer, all \
         rights reserved</div></body></html>",
        p[0], p[1], p[2], p[3], p[4]
    );
    let ea = extract_main(&a, Some("https://a.example/news/1?utm_source=x"));
    let eb = extract_main(&b, Some("https://b.example/amp/news/1"));
    let d = hamming_distance(
        u64::from_str_radix(&ea.simhash, 16).unwrap_or(0),
        u64::from_str_radix(&eb.simhash, 16).unwrap_or(0),
    );
    assert!(d <= 3, "distance {d}\n{}\n---\n{}", ea.text, eb.text);
    let unrelated = simhash64(
        "Preheat the oven, whisk eggs with sugar, fold in flour and bake for thirty minutes.",
    );
    assert!(hamming_distance(simhash64(&ea.text), unrelated) >= 16);
}
