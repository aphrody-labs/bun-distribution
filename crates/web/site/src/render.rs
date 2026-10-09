// SPDX-License-Identifier: Apache-2.0
//! Server-rendered product pages. Catalog strings are text, never HTML or script.
//! Native disclosure controls keep the complete documentation and template
//! sources available without client JavaScript, a bundler or a browser runtime.

use serde_json::Value;
use std::{collections::BTreeSet, fmt::Write};

pub const SITE_CSS: &str = include_str!("../assets/site.css");

fn escape(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            _ => output.push(character),
        }
    }
    output
}

fn field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn records(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn tags(value: &Value, output: &mut String) {
    let values = value.get("tags").map(records).unwrap_or(&[]);
    if !values.is_empty() {
        output.push_str("<ul class=\"tags\" aria-label=\"Topics\">");
        for tag in values.iter().filter_map(Value::as_str) {
            let _ = write!(output, "<li>{}</li>", escape(tag));
        }
        output.push_str("</ul>");
    }
}

struct DocControls<'a> {
    all_docs: &'a Value,
    query: &'a str,
    category: &'a str,
}

fn doc_search(controls: &DocControls<'_>, output: &mut String) {
    output.push_str("<form class=\"doc-search\" action=\"/docs\" method=\"get\" role=\"search\" aria-label=\"Documentation\"><div class=\"search-field\"><label for=\"doc-query\">Search documentation</label>");
    let _ = write!(
        output,
        "<input id=\"doc-query\" name=\"q\" type=\"search\" value=\"{}\" maxlength=\"512\" aria-describedby=\"doc-search-help\"></div><div class=\"category-field\"><label for=\"doc-category\">Category</label><select id=\"doc-category\" name=\"category\"><option value=\"\"{}>All categories</option>",
        escape(controls.query),
        if controls.category.is_empty() || controls.category == "All" { " selected" } else { "" }
    );
    let categories: BTreeSet<_> = records(controls.all_docs)
        .iter()
        .map(|article| field(article, "category"))
        .filter(|category| !category.is_empty())
        .collect();
    for category in categories {
        let selected = if controls.category == category { " selected" } else { "" };
        let category = escape(category);
        let _ = write!(output, "<option value=\"{category}\"{selected}>{category}</option>");
    }
    output.push_str("</select></div><button type=\"submit\">Search</button><a class=\"clear-search\" href=\"/docs\">Clear filters</a><p id=\"doc-search-help\">Search article titles, summaries, topics and text.</p></form>");
}

fn documentation(docs: &Value, controls: &DocControls<'_>, output: &mut String) {
    output.push_str("<header class=\"page-heading\"><h1>Documentation</h1><p>Architecture, frameworks and product references.</p></header>");
    doc_search(controls, output);
    let articles = records(docs);
    let _ = write!(
        output,
        "<p class=\"search-results\">{} {}</p>",
        articles.len(),
        if articles.len() == 1 { "article" } else { "articles" }
    );
    if articles.is_empty() {
        if controls.query.is_empty() && controls.category.is_empty() {
            output
                .push_str("<p class=\"empty\">No documentation is available in this catalog.</p>");
        } else {
            output.push_str("<p class=\"empty\">No articles match these filters. Try another search or clear the filters.</p>");
        }
        return;
    }
    for (index, article) in articles.iter().enumerate() {
        let title = escape(field(article, "title"));
        let _ = write!(
            output,
            "<article class=\"document\" aria-labelledby=\"doc-{index}\"><header><p class=\"category\">{}</p><h2 id=\"doc-{index}\">{title}</h2><p class=\"summary\">{}</p>",
            escape(field(article, "category")),
            escape(field(article, "summary"))
        );
        let read_time = field(article, "readTime");
        if !read_time.is_empty() {
            let _ = write!(output, "<p class=\"reading-time\">{}</p>", escape(read_time));
        }
        tags(article, output);
        output.push_str("</header><details class=\"article-content\">");
        let _ = write!(
            output,
            "<summary>Read {title}</summary><pre class=\"prose-source\">{}</pre></details></article>",
            escape(field(article, "content"))
        );
    }
}

fn template_catalog(templates: &Value, output: &mut String) {
    output.push_str("<header class=\"page-heading\"><h1>Templates</h1><p>Project definitions, dependencies and source files from the template catalog.</p></header>");
    let entries = records(templates);
    if entries.is_empty() {
        output.push_str("<p class=\"empty\">No templates are available in this catalog.</p>");
        return;
    }
    for (index, template) in entries.iter().enumerate() {
        let _ = write!(
            output,
            "<article class=\"template\" aria-labelledby=\"template-{index}\"><header><h2 id=\"template-{index}\">{}</h2><p class=\"tagline\">{}</p><p>{}</p>",
            escape(field(template, "name")),
            escape(field(template, "tagline")),
            escape(field(template, "description"))
        );
        tags(template, output);
        output.push_str("</header>");
        let command = field(template, "cliCommand");
        if !command.is_empty() {
            let _ = write!(
                output,
                "<h3>Project command</h3><pre class=\"command\"><code>{}</code></pre>",
                escape(command)
            );
        }
        if let Some(dependencies) = template.get("dependencies").and_then(Value::as_object)
            && !dependencies.is_empty()
        {
            output.push_str("<details><summary>Dependencies</summary><dl class=\"dependencies\">");
            for (name, version) in dependencies {
                let version =
                    version.as_str().map(str::to_owned).unwrap_or_else(|| version.to_string());
                let _ = write!(output, "<dt>{}</dt><dd>{}</dd>", escape(name), escape(&version));
            }
            output.push_str("</dl></details>");
        }
        let files = template.get("files").map(records).unwrap_or(&[]);
        if !files.is_empty() {
            output.push_str("<section class=\"template-files\" aria-label=\"Source files\"><h3>Source files</h3>");
            for file in files {
                let path = field(file, "path");
                let name = if path.is_empty() { field(file, "name") } else { path };
                let _ = write!(
                    output,
                    "<details><summary><span>{}</span><span class=\"file-language\">{}</span></summary><pre class=\"file-source\"><code>{}</code></pre></details>",
                    escape(name),
                    escape(field(file, "language")),
                    escape(field(file, "content"))
                );
            }
            output.push_str("</section>");
        }
        output.push_str("</article>");
    }
}

fn material(output: &mut String) {
    output.push_str("<header class=\"page-heading\"><h1>Material 3</h1><p>Semantic color roles, clear type and native controls.</p></header><section class=\"material-intro\"><h2>One visual language</h2><p>These pages use Material 3 color roles from the Aphrody token system. Navigation, source disclosure and keyboard focus use native HTML elements.</p><a class=\"button-link\" href=\"/docs\">Read the documentation</a></section><section class=\"palette-section\" aria-labelledby=\"palette-heading\"><h2 id=\"palette-heading\">Color roles</h2><ul class=\"palette\"><li class=\"swatch primary\">Primary</li><li class=\"swatch primary-container\">Primary container</li><li class=\"swatch secondary-container\">Secondary container</li><li class=\"swatch surface\">Surface</li></ul></section><section class=\"type-section\"><h2>Readable hierarchy</h2><p class=\"type-display\">Build with Aphrody</p><p class=\"type-title\">Tools, templates and documentation</p><p>Body text stays within a comfortable reading width. Source code preserves whitespace and can scroll when a line needs more room.</p><details><summary>Native disclosure control</summary><p>This control works with the keyboard and without JavaScript. The same element reveals documentation and template source files.</p></details></section>");
}

/// Render one product section. Unknown sections show the product landing page;
/// no catalog value is interpreted as HTML, URL, selector or script.
pub fn render_page(section: &str, docs: &Value, templates: &Value) -> String {
    render_with_controls(
        section,
        docs,
        templates,
        &DocControls { all_docs: docs, query: "", category: "" },
    )
}

/// Render the docs selected by the canonical Catalog search. Category choices
/// use the full source catalog; query/category stay visible after GET submit.
/// This renderer does not repeat the owner's search algorithm.
pub fn render_docs_page(
    all_docs: &Value,
    filtered_docs: &Value,
    templates: &Value,
    query: &str,
    category: &str,
) -> String {
    render_with_controls(
        "docs",
        filtered_docs,
        templates,
        &DocControls { all_docs, query, category },
    )
}

fn render_with_controls(
    section: &str,
    docs: &Value,
    templates: &Value,
    controls: &DocControls<'_>,
) -> String {
    let (current, title) = match section.trim_matches('/') {
        "docs" | "documentation" => ("docs", "Documentation"),
        "templates" => ("templates", "Templates"),
        "material3" | "m3" | "material" => ("material3", "Material 3"),
        _ => ("home", "Aphrody"),
    };
    let mut html = String::with_capacity(16 * 1024);
    let _ = write!(
        html,
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\"><title>{title} · Aphrody</title><link rel=\"stylesheet\" href=\"/assets/site.css\"></head><body><a class=\"skip-link\" href=\"#main\">Skip to content</a><header class=\"site-header\"><a class=\"brand\" href=\"/\" aria-label=\"Aphrody home\">Aphrody</a><nav aria-label=\"Main navigation\"><ul>"
    );
    for (id, href, label) in [
        ("docs", "/docs", "Documentation"),
        ("templates", "/templates", "Templates"),
        ("material3", "/material3", "Material 3"),
    ] {
        let selected = if current == id { " aria-current=\"page\"" } else { "" };
        let _ = write!(html, "<li><a href=\"{href}\"{selected}>{label}</a></li>");
    }
    html.push_str("</ul></nav></header><main id=\"main\" tabindex=\"-1\">");
    match current {
        "docs" => documentation(docs, controls, &mut html),
        "templates" => template_catalog(templates, &mut html),
        "material3" => material(&mut html),
        _ => {
            html.push_str("<header class=\"page-heading landing\"><h1>Aphrody</h1><p>Documentation and project templates, together.</p></header><section class=\"landing-links\" aria-label=\"Explore Aphrody\"><a href=\"/docs\"><h2>Documentation</h2><p>Explore the architecture and framework references.</p>");
            let _ = write!(
                html,
                "<span class=\"catalog-count\">{} articles</span></a><a href=\"/templates\"><h2>Templates</h2><p>Read project definitions and their source files.</p><span class=\"catalog-count\">{} templates</span></a><a href=\"/material3\"><h2>Material 3</h2><p>Explore the visual roles used across these pages.</p></a></section>",
                records(docs).len(),
                records(templates).len()
            );
        },
    }
    html.push_str("</main><footer class=\"site-footer\"><p>Aphrody</p><nav aria-label=\"Catalog data\"><a href=\"/api/docs\">Documentation JSON</a><a href=\"/api/templates\">Templates JSON</a></nav></footer></body></html>");
    html
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hostile_document_metadata_is_never_markup() {
        let attack = "<script>alert(1)</script>\"'&";
        let html = render_page(
            "docs",
            &json!([{"id": attack, "title": attack, "category": attack, "summary": attack, "tags":[attack], "readTime":attack, "content":attack}]),
            &json!([]),
        );
        assert!(!html.contains("<script"));
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;"));
        assert!(html.contains("id=\"doc-0\""));
        assert!(html.contains("aria-current=\"page\">Documentation"));
    }

    #[test]
    fn template_source_dependencies_and_paths_are_escaped() {
        let attack = "</code><img src=x onerror=alert(1)>";
        let html = render_page(
            "templates",
            &json!([]),
            &json!([{"name":attack,"tagline":attack,"description":attack,"tags":[attack],"cliCommand":attack,"dependencies":{attack: attack},"files":[{"path":attack,"language":attack,"content":attack}]}]),
        );
        assert!(!html.contains("<img"));
        assert!(!html.contains("<script"));
        assert!(html.contains("&lt;/code&gt;&lt;img src=x onerror=alert(1)&gt;"));
        assert!(html.contains("<details>"));
    }

    #[test]
    fn empty_catalogs_and_unknown_sections_have_working_navigation() {
        let empty = render_page("/docs/", &Value::Null, &Value::Null);
        assert!(empty.contains("No documentation is available"));
        let home = render_page("<script>", &json!([]), &json!([]));
        assert!(home.contains("0 articles"));
        assert!(home.contains("href=\"#main\""));
        assert!(!home.contains("<script"));
        let material = render_page("m3", &Value::Null, &Value::Null);
        assert!(material.contains("aria-current=\"page\">Material 3"));
        assert!(SITE_CSS.contains("prefers-color-scheme"));
    }

    #[test]
    fn search_form_preserves_escaped_query_and_full_catalog_categories() {
        let attack = "\" autofocus onfocus=alert(1) <script>&";
        let docs = json!([
            {"title":"API", "category":"Architecture"},
            {"title":"Themes", "category":"Material <3>"},
            {"title":"More API", "category":"Architecture"}
        ]);
        let filtered = json!([docs[1].clone()]);
        let html = render_docs_page(&docs, &filtered, &json!([]), attack, "Material <3>");
        assert!(html.contains("action=\"/docs\" method=\"get\""));
        assert!(html.contains("name=\"q\" type=\"search\""));
        assert!(html.contains("value=\"&quot; autofocus onfocus=alert(1) &lt;script&gt;&amp;\""));
        assert!(!html.contains("<script"));
        assert!(html.contains("value=\"Material &lt;3&gt;\" selected"));
        assert_eq!(html.matches("value=\"Architecture\"").count(), 1);
        assert!(html.contains("1 article"));
        assert!(!html.contains("<h2 id=\"doc-0\">API"));
    }

    #[test]
    fn unmatched_docs_keep_the_search_form_and_reset_link() {
        let html = render_docs_page(&json!([]), &json!([]), &json!([]), "missing", "");
        assert!(html.contains("No articles match these filters"));
        assert!(html.contains("Clear filters"));
        assert!(html.contains("value=\"missing\""));
        assert!(html.contains("<option value=\"\" selected>All categories"));
    }
}
