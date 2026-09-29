//! Unit tests for the canonical HTML → GitHub-flavoured Markdown converter.

use aphrody_web_extract::html_to_markdown;

fn md(html: &str) -> String {
    html_to_markdown(html, None)
}

#[test]
fn drops_non_rendered_elements() {
    let out = md("<head><title>T</title><style>body{color:red}</style></head><body><p>hello</\
                  p><script>alert(1)</script><noscript>enable \
                  js</noscript><template><p>tpl</p></template><svg><text>vector</text></\
                  svg><iframe src=x>frame</iframe></body>");
    assert!(out.contains("hello"));
    for bad in ["color:red", "alert", "enable js", "tpl", "vector", "frame", "T\n"] {
        assert!(!out.contains(bad), "{bad} leaked into {out:?}");
    }
}

#[test]
fn atx_headings() {
    assert!(md("<h1>Title</h1>").contains("# Title"));
    assert_eq!(md("<h3>Sub <em>part</em></h3>").trim(), "### Sub *part*");
    assert_eq!(md("<h6>Six</h6>").trim(), "###### Six");
}

#[test]
fn links_are_resolved_and_javascript_dropped() {
    assert!(md(r#"<a href="https://x.com">go</a>"#).contains("[go](https://x.com)"));
    let out = html_to_markdown(
        r#"<p><a href="/docs/a b">docs</a> <a href="page2.html#s">next</a></p>"#,
        Some("https://example.com/dir/index.html"),
    );
    assert!(out.contains("[docs](https://example.com/docs/a%20b)"), "{out}");
    assert!(out.contains("[next](https://example.com/dir/page2.html#s)"), "{out}");
    let js = md(r#"<a href="javascript:void(0)">click</a> <a href=" JavaScript:alert(1)">x</a>"#);
    assert!(js.contains("click"));
    assert!(!js.to_lowercase().contains("javascript:"));
    assert!(!js.contains("]("));
}

#[test]
fn base_href_is_honoured() {
    let out = html_to_markdown(
        r#"<head><base href="https://cdn.example.org/assets/"></head><body><img src="a.png" alt="A"></body>"#,
        Some("https://example.org/page"),
    );
    assert!(out.contains("![A](https://cdn.example.org/assets/a.png)"), "{out}");
}

#[test]
fn images() {
    assert!(md(r#"<img src="/a.png" alt="pic">"#).contains("![pic](/a.png)"));
    let abs = html_to_markdown(r#"<img src="/a.png" alt="pic">"#, Some("https://site.test/x/y"));
    assert!(abs.contains("![pic](https://site.test/a.png)"), "{abs}");
    let lazy = md(r#"<img src="data:image/gif;base64,R0lGOD" data-src="/real.jpg" alt="lazy">"#);
    assert!(lazy.contains("![lazy](/real.jpg)"), "{lazy}");
    assert!(md(r#"<img alt="no source">"#).trim().is_empty());
    let linked = md(r#"<a href="/big.png"><img src="/small.png" alt="thumb"></a>"#);
    assert!(linked.contains("[![thumb](/small.png)](/big.png)"), "{linked}");
}

#[test]
fn emphasis_and_inline_code() {
    assert!(md("<strong>b</strong>").contains("**b**"));
    assert!(md("<b>b</b>").contains("**b**"));
    assert!(md("<em>i</em>").contains("*i*"));
    assert!(md("<code>x</code>").contains("`x`"));
    assert!(md("<del>gone</del>").contains("~~gone~~"));
    assert_eq!(md("<p>a<strong> spaced </strong>b</p>").trim(), "a **spaced** b");
    assert_eq!(md("<p><strong><strong>nested</strong></strong></p>").trim(), "**nested**");
    assert_eq!(md("<p><em>   </em>x</p>").trim(), "x");
    assert_eq!(md("<p>use <code>a`b</code></p>").trim(), "use `` a`b ``");
}

#[test]
fn unordered_and_nested_lists() {
    let out = md("<ul><li>one</li><li>two<ul><li>two.a</li><li>two.b<ol><li>deep</li></ol></li></\
                  ul></li><li>three</li></ul>");
    assert_eq!(out, "- one\n- two\n  - two.a\n  - two.b\n    1. deep\n- three\n", "{out}");
}

#[test]
fn ordered_lists_with_start() {
    let out =
        md(r#"<ol start="9"><li>nine</li><li>ten<ul><li>sub</li></ul></li><li>eleven</li></ol>"#);
    assert_eq!(out, "9. nine\n10. ten\n    - sub\n11. eleven\n", "{out}");
}

#[test]
fn list_item_with_paragraphs() {
    let out = md("<ul><li><p>first para</p><p>second para</p></li><li>next</li></ul>");
    assert!(out.starts_with("- first para\n\n  second para\n"), "{out}");
    assert!(out.contains("- next"));
}

#[test]
fn fenced_code_blocks_keep_language_and_indentation() {
    let out = md(r#"<pre><code class="language-rust">fn f() {
    return 42;
}</code></pre>"#);
    assert!(out.starts_with("```rust\nfn f() {\n    return 42;\n}\n```"), "{out}");
    let gh = md(
        r#"<div class="highlight highlight-source-python"><pre><span class="k">def</span> <span>f</span>():
    <span>pass</span></pre></div>"#,
    );
    assert!(gh.contains("```python\ndef f():\n    pass\n```"), "{gh}");
    let backticks = md("<pre>```\ninner\n```</pre>");
    assert!(backticks.starts_with("````\n```\ninner\n```\n````"), "{backticks}");
    let plain = md("<pre><code>function f() {\n    return 42;\n}</code></pre>");
    assert!(plain.contains("    return 42;"));
    assert!(plain.starts_with("```\n"));
}

#[test]
fn code_block_inside_list_is_indented() {
    let out = md("<ol><li>Run:<pre><code>cargo test\ncargo build</code></pre></li></ol>");
    assert_eq!(out, "1. Run:\n\n   ```\n   cargo test\n   cargo build\n   ```\n", "{out}");
}

#[test]
fn blockquotes() {
    let out = md("<blockquote><p>quoted one</p><p>quoted \
            two</p><blockquote>inner</blockquote></blockquote>");
    assert_eq!(out, "> quoted one\n>\n> quoted two\n>\n> > inner\n", "{out}");
}

#[test]
fn line_breaks_and_rules() {
    let out = md("<p>line one<br>line two</p><hr><p>after</p>");
    assert_eq!(out, "line one  \nline two\n\n---\n\nafter\n", "{out}");
}

#[test]
fn gfm_tables_without_padding() {
    let out = md("<table><thead><tr><th>Name</th><th>Value | \
                  pipe</th></tr></thead><tbody><tr><td>a</td><td><b>1</b></td></\
                  tr><tr><td>longer cell text</td><td></td></tr></tbody></table>");
    assert_eq!(
        out, "| Name | Value \\| pipe |\n| --- | --- |\n| a | **1** |\n| longer cell text | |\n",
        "{out}"
    );
}

#[test]
fn table_with_colspan_and_caption() {
    let out = md(
        r#"<table><caption>Stats</caption><tr><th colspan="2">Wide</th></tr><tr><td>x</td><td>y<br>z</td></tr></table>"#,
    );
    assert!(out.starts_with("Stats\n\n| Wide | |\n| --- | --- |\n| x | y z |"), "{out}");
}

#[test]
fn layout_tables_render_as_blocks() {
    let out =
        md("<table><tr><td><p>Only one column paragraph.</p><p>Second.</p></td></tr></table>");
    assert!(!out.contains('|'), "{out}");
    assert!(out.contains("Only one column paragraph.\n\nSecond."), "{out}");
}

#[test]
fn long_cell_table_output_stays_linear() {
    let long_cell = "word ".repeat(4000);
    let mut html = String::from("<html><body><table><tr><th>k</th><th>v</th></tr>");
    for i in 0..60 {
        html.push_str(&format!(
            "<tr><td>row{i}</td><td>{}</td></tr>",
            if i == 0 { long_cell.as_str() } else { "short" }
        ));
    }
    html.push_str("</table></body></html>");
    let out = md(&html);
    assert!(out.len() <= 3 * html.len(), "markdown {} > 3 * html {}", out.len(), html.len());
    assert!(
        out.lines().nth(3).is_some_and(|l| l == "| row1 | short |"),
        "{}",
        &out[out.len().saturating_sub(200)..]
    );
}

#[test]
fn whitespace_collapsing_and_entities() {
    let out = md("<p>a &amp; b &copy; &#39;c&#39;</p>\n\n\n\n   \n<p>  spaced\n\t out  </p>");
    assert!(out.contains("a & b © 'c'"));
    assert!(out.contains("spaced out"));
    assert!(!out.contains("\n\n\n"));
}

#[test]
fn escapes_markdown_significant_text() {
    let out = md("<p>2 * 3 = 6 and [not a link](x) and _emph_ but snake_case</p><p># not \
                  heading</p><p>1. not a list</p>");
    assert!(out.contains("2 \\* 3"), "{out}");
    assert!(out.contains("\\[not a link\\](x)"), "{out}");
    assert!(out.contains("\\_emph\\_"), "{out}");
    assert!(out.contains("snake_case"), "{out}");
    assert!(out.contains("\\# not heading"), "{out}");
    assert!(out.contains("1\\. not a list"), "{out}");
}

#[test]
fn empty_and_hostile_input() {
    assert_eq!(md("").trim(), "");
    assert_eq!(md("\u{0}\u{0}\u{0}").trim(), "\u{FFFD}\u{FFFD}\u{FFFD}".trim_matches('\u{FFFD}'));
    let _ = md("<table><td><table><td><ul><li><pre>");
    let deep = "<div>".repeat(50_000) + "deep text" + &"</div>".repeat(50_000);
    assert!(md(&deep).contains("deep text"));
    let nested_lists = "<ul><li>".repeat(5_000) + "x";
    assert!(md(&nested_lists).contains('x'));
}
