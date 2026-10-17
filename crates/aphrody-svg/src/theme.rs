// SPDX-License-Identifier: Apache-2.0

//! Colour theming: bake `currentColor`, CSS custom properties (`var(--md-sys-color-primary,
//! #6750a4)`) and explicit colour remaps into an SVG so it renders identically outside a
//! browser cascade (rasterizer, favicon, native renderer, e-mail).

use std::collections::HashMap;

use roxmltree::Node;

use crate::{
    Result,
    xml::{self, Rules},
};

/// Presentation attributes and CSS properties that carry a colour.
const PAINT_PROPERTIES: &[&str] = &[
    "fill",
    "stroke",
    "stop-color",
    "flood-color",
    "lighting-color",
    "color",
];

/// A colour substitution table.
#[derive(Debug, Clone, Default)]
pub struct Theme {
    current_color: Option<String>,
    root_paint: Option<String>,
    vars: HashMap<String, String>,
    remap: Vec<(svgtypes::Color, String)>,
}

impl Theme {
    /// Empty theme (identity transform).
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Value substituted for `currentColor`.
    #[must_use]
    pub fn current_color(mut self, color: impl Into<String>) -> Self {
        self.current_color = Some(color.into());
        self
    }

    /// Tints a monochrome icon: `currentColor` becomes `color`, and the root `<svg>` gets
    /// `fill` and `color` set to it (replacing its own), so unpainted shapes take it too.
    /// Shapes with an explicit colour keep it.
    #[must_use]
    pub fn tint(mut self, color: impl Into<String>) -> Self {
        let color = color.into();
        self.current_color = Some(color.clone());
        self.root_paint = Some(color);
        self
    }

    /// Value for `var(--name)`; `name` may be given with or without the leading `--`.
    #[must_use]
    pub fn var(mut self, name: &str, value: impl Into<String>) -> Self {
        self.vars
            .insert(name.trim_start_matches("--").to_owned(), value.into());
        self
    }

    /// Adds every `(name, value)` pair as a custom property.
    #[must_use]
    pub fn vars<K: AsRef<str>, V: Into<String>>(
        mut self,
        pairs: impl IntoIterator<Item = (K, V)>,
    ) -> Self {
        for (k, v) in pairs {
            self = self.var(k.as_ref(), v);
        }
        self
    }

    /// Replaces every paint equal to `from` (any CSS colour syntax) by `to`. Ignored when `from`
    /// does not parse as a colour.
    #[must_use]
    pub fn remap(mut self, from: &str, to: impl Into<String>) -> Self {
        if let Ok(color) = from.trim().parse::<svgtypes::Color>() {
            self.remap.push((color, to.into()));
        }
        self
    }

    /// Theme exposing the Material 3 colour roles as `--md-sys-color-<role>` and
    /// `currentColor` as `on-surface`.
    #[cfg(feature = "m3")]
    #[must_use]
    pub fn m3(roles: &aphrody_m3_tokens::color::ColorRoles) -> Self {
        let vars = aphrody_m3_tokens::color::color_vars(roles);
        let on_surface = vars
            .iter()
            .find(|(k, _)| *k == "on-surface")
            .map(|(_, v)| v.clone());
        let mut theme = Self::new();
        for (role, value) in vars {
            theme = theme.var(&format!("md-sys-color-{role}"), value);
        }
        if let Some(color) = on_surface {
            theme = theme.current_color(color);
        }
        theme
    }

    /// Resolves every `var(--x[, fallback])` whose name is known (or has a fallback).
    #[must_use]
    pub fn resolve_vars(&self, value: &str) -> String {
        let mut out = String::with_capacity(value.len());
        let mut rest = value;
        while let Some(start) = rest.find("var(") {
            out.push_str(&rest[..start]);
            let after = &rest[start + 4..];
            let Some(end) = matching_paren(after) else {
                out.push_str(&rest[start..]);
                return out;
            };
            let inner = &after[..end];
            let (name, fallback) = match inner.split_once(',') {
                Some((n, f)) => (n.trim(), Some(f.trim())),
                None => (inner.trim(), None),
            };
            match self.vars.get(name.trim_start_matches("--")) {
                Some(v) => out.push_str(v),
                None => match fallback {
                    Some(f) => out.push_str(&self.resolve_vars(f)),
                    None => out.push_str(&rest[start..start + 4 + end + 1]),
                },
            }
            rest = &after[end + 1..];
        }
        out.push_str(rest);
        out
    }

    /// Resolves one paint value (`currentColor`, `var()`, remapped colours).
    #[must_use]
    pub fn resolve_paint(&self, value: &str) -> String {
        let resolved = self.resolve_vars(value);
        let trimmed = resolved.trim();
        if trimmed.eq_ignore_ascii_case("currentcolor")
            && let Some(c) = &self.current_color
        {
            return c.clone();
        }
        if let Ok(color) = trimmed.parse::<svgtypes::Color>()
            && let Some((_, to)) = self.remap.iter().find(|(from, _)| *from == color)
        {
            return to.clone();
        }
        resolved
    }

    fn resolve_declarations(&self, css: &str) -> String {
        css.split(';')
            .map(|decl| match decl.split_once(':') {
                Some((prop, value)) if PAINT_PROPERTIES.contains(&prop.trim()) => {
                    format!("{}:{}", prop, self.resolve_paint(value))
                }
                Some((prop, value)) => format!("{}:{}", prop, self.resolve_vars(value)),
                None => decl.to_owned(),
            })
            .collect::<Vec<_>>()
            .join(";")
    }

    fn resolve_stylesheet(&self, css: &str) -> String {
        let mut out = String::with_capacity(css.len());
        let mut rest = css;
        while let Some(open) = rest.find('{') {
            let Some(close) = rest[open..].find('}') else {
                break;
            };
            out.push_str(&rest[..=open]);
            out.push_str(&self.resolve_declarations(&rest[open + 1..open + close]));
            out.push('}');
            rest = &rest[open + close + 1..];
        }
        out.push_str(rest);
        out
    }
}

fn matching_paren(s: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => return Some(i),
            ')' => depth -= 1,
            _ => {}
        }
    }
    None
}

impl Rules for Theme {
    fn attribute(
        &self,
        node: Node<'_, '_>,
        local: &str,
        ns: Option<&str>,
        value: &str,
    ) -> Option<String> {
        if ns.is_some() {
            return Some(value.to_owned());
        }
        if self.root_paint.is_some()
            && node.parent_element().is_none()
            && matches!(local, "fill" | "color")
        {
            return None;
        }
        Some(if PAINT_PROPERTIES.contains(&local) {
            self.resolve_paint(value)
        } else if local == "style" {
            self.resolve_declarations(value)
        } else {
            value.to_owned()
        })
    }

    fn extra_attributes(&self, node: Node<'_, '_>) -> Vec<(String, String)> {
        match &self.root_paint {
            Some(paint) if node.parent_element().is_none() => {
                vec![
                    ("fill".to_owned(), paint.clone()),
                    ("color".to_owned(), paint.clone()),
                ]
            }
            _ => Vec::new(),
        }
    }

    fn text(&self, parent: Node<'_, '_>, text: &str) -> Option<String> {
        Some(if parent.tag_name().name() == "style" {
            self.resolve_stylesheet(text)
        } else {
            text.to_owned()
        })
    }

    fn keep_comments(&self) -> bool {
        true
    }
}

/// Applies `theme` to every paint of `svg`.
///
/// # Errors
/// Malformed XML or non-SVG root.
pub fn apply(svg: &str, theme: &Theme) -> Result<String> {
    let doc = xml::parse(svg)?;
    Ok(xml::write_document(&doc, theme))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bakes_current_color_vars_and_remaps() {
        let theme = Theme::new()
            .current_color("#1d1b20")
            .var("--md-sys-color-primary", "#6750A4")
            .remap("black", "#ffffff");
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:var(--md-sys-color-primary)}</style><path fill="currentColor"/><path stroke="#000"/><path style="fill:var(--unknown, red);opacity:.5"/><path fill="var(--nope)"/></svg>"##;
        let out = apply(svg, &theme).expect("ok");
        assert!(out.contains(".a{fill:#6750A4}"), "{out}");
        assert!(out.contains(r##"fill="#1d1b20""##));
        assert!(out.contains(r##"stroke="#ffffff""##));
        assert!(out.contains("fill:red;opacity:.5"), "{out}");
        assert!(out.contains(r#"fill="var(--nope)""#));
    }

    #[test]
    fn tint_paints_the_root_and_current_color() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" fill="#000" viewBox="0 0 1 1"><path d="M0 0"/><path stroke="currentColor"/><path fill="red"/></svg>"##;
        let out = apply(svg, &Theme::new().tint("#6750a4")).expect("ok");
        assert_eq!(out.matches("#6750a4").count(), 3, "{out}");
        assert!(!out.contains(r##"fill="#000""##), "{out}");
        assert!(out.contains(r#"fill="red""#), "{out}");
    }

    #[cfg(feature = "m3")]
    #[test]
    fn m3_theme_exposes_roles() {
        let theme = Theme::m3(&aphrody_m3_tokens::color::BASELINE);
        assert_eq!(
            theme.resolve_paint("var(--md-sys-color-primary)"),
            "#6750A4"
        );
    }
}
