//! Attribute signature classification (id / class / role / aria-label / itemprop).
//!
//! Patterns are generic CMS / framework conventions (Readability's
//! "unlikely candidates" family extended with modern consent, newsletter and
//! recommendation widgets). They are compiled once per process.

use std::sync::OnceLock;

use regex::Regex;

pub(crate) struct Patterns {
    /// Boilerplate that is never main content, even when the signature also
    /// contains a positive word (`cookie-content`, `related-posts-text`).
    pub hard: Regex,
    /// Comment sections (dropped unless comments are requested).
    pub comments: Regex,
    /// Layout chrome that may be overridden by a positive word
    /// (`content-with-sidebar`, `entry-header`).
    pub soft: Regex,
    /// Words that cancel a `soft` match (Readability's "maybe a candidate").
    pub overrides: Regex,
    /// Positive content hints.
    pub positive: Regex,
    /// Negative scoring hints that do not justify dropping on their own.
    pub negative: Regex,
    /// Byline containers.
    pub byline: Regex,
}

pub(crate) fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| {
        let build = |s: &str| Regex::new(s).unwrap_or_else(|_| Regex::new("$^").unwrap_or_else(|_| unreachable!()));
        Patterns {
            hard: build(concat!(
                r"cookie|consent|gdpr|\bccpa\b|newsletter|breadcrumb|\bshare\b|sharing|sharebar|share-?buttons|social|",
                r"related|recommend|outbrain|taboola|zergnet|sponsor|advert|adsense|\bads?\b|\bad-|-ad\b|adslot|ad-?unit|dfp-|",
                r"promo|trending|most-?read|most-?popular|more-stories|you-may-like|read-?next|up-?next|",
                r"popup|modal|lightbox|overlay|\bsubscribe|signup|sign-up|\blogin\b|sign-?in\b|paywall-?prompt|",
                r"author-?bio|about-?the-?author|author-?box|author-?card|skip-?link|skip-?to|jump-?to|back-?to-?top|",
                r"screen-?reader|\bsr-only\b|visually-?hidden|visuallyhidden|\boffscreen\b|",
                r"editsection|edit-?section|\bedit-?link|noprint|no-?print|print-?none|d-print-none|",
                r"pagination|\bpager\b|navbar|\bmenu|menubar|mega-?menu|\bdrawer\b|off-?canvas|",
                r"tag-?list|tag-?cloud|post-?tags|entry-?tags|article-?tags|\btags\b|categories|",
                r"copyright|\blegal\b|disclaimer|shoutbox|\brss\b|feedback|rating|print-?button|signature|",
                r"alert-?bar|announcement|notification|toast|\bcta\b|call-?to-?action|",
                r"^navigation$|\bsearch\b|search-?form|searchbox|complementary|contentinfo|alertdialog|\bdialog\b|\btoolbar\b|\btablist\b"
            )),
            comments: build(r"comment|disqus|\breplies\b|respond\b|\breply\b|discussion-?thread|\breviews\b|customer-?reviews?|product-?reviews?|user-?reviews?"),
            soft: build(concat!(
                r"sidebar|side-?bar|\baside\b|\bfooter|\bfoot\b|\bheader\b|site-?header|global-?header|masthead|",
                r"\bauthor\b|postprofile|user-?info|user-?details|poster-?info|message-?attribution|\bpostedit|last-?edit|",
                r"reflist|\breferences\b|footnotes|bibliography|\bcitations\b|",
                r"\bnav\b|\bnav-|-nav\b|_nav\b|navigation|\bbanner\b|\bwidget|\bmeta\b|metadata|byline|dateline|",
                r"\btoc\b|table-?of-?contents|toolbox|\btools\b|\bextra\b|supplemental|infobox|navbox|catlinks|",
                r"\bbadge|\bbutton|\bbtn\b|\bicons?\b|\blogo\b|\bhero\b|\bsticky\b|\bfixed\b|\bmasthead\b|\bcredits?\b"
            )),
            overrides: build(r"\band\b|article|body|column|content|\bmain\b|shadow|\bentry|prose|markdown|\bstory"),
            positive: build(concat!(
                r"article|\bbody\b|-body\b|content|\bentry|hentry|h-entry|e-content|\bmain\b|\bpage\b|\bpost\b|post-|",
                r"\btext\b|-text\b|\bblog|\bstory|prose|markdown|rich-?text|\bdocument\b|\breadme\b|articlebody|recipe|instructions|ingredients|description|answer|question"
            )),
            negative: build(concat!(
                r"-ad-|\bhid\b|combx|\bcom-|contact|footnote|\bmedia\b|outbrain|scroll|shopping|skyscraper|",
                r"\btool|widget|\bthumb|\bcard\b|\bteaser|\bpromo|\bcaption\b|\bgallery\b|carousel|\bslider\b"
            )),
            byline: build(r"byline|\bauthor|\bwriter\b|\bcontributor|\bdateline\b|posted-?by|article-?by"),
        }
    })
}

/// Lowercased signature of an element for pattern matching.
pub(crate) fn signature(parts: &[Option<&str>]) -> String {
    let mut s = String::new();
    for p in parts.iter().flatten() {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        if !s.is_empty() {
            s.push(' ');
        }
        // Signatures longer than this are Tailwind-style utility soups; the
        // semantic hints we care about appear early in practice.
        let take = p.len().min(512);
        let mut end = take;
        while !p.is_char_boundary(end) {
            end -= 1;
        }
        s.push_str(&p[..end].to_lowercase());
    }
    s
}
