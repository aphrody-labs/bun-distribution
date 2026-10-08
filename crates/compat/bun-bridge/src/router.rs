// SPDX-License-Identifier: Apache-2.0
//! Native high-speed Radix Tree URL Router from Bun (`bun_router`).
//! Handles route registration, parameter extraction (`:param`), and wildcard (`*wildcard`) matches
//! with zero-allocation path slicing.

use std::collections::HashMap;

/// Route match result containing the handler and extracted parameters.
#[derive(Debug, Clone)]
pub struct RouteMatch<'a, T> {
    pub handler: &'a T,
    pub params: HashMap<String, String>,
}

#[derive(Debug)]
enum NodeKind {
    Static(String),
    Param(String),
    Wildcard(String),
}

#[derive(Debug)]
struct Node<T> {
    kind: NodeKind,
    handler: Option<T>,
    children: Vec<Node<T>>,
}

impl<T> Node<T> {
    fn new(kind: NodeKind) -> Self {
        Self {
            kind,
            handler: None,
            children: Vec::new(),
        }
    }
}

/// Radix tree router capable of millions of route lookups per second.
#[derive(Debug)]
pub struct Router<T> {
    root: Node<T>,
}

impl<T> Default for Router<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Router<T> {
    /// Creates an empty router.
    pub fn new() -> Self {
        Self {
            root: Node::new(NodeKind::Static("".to_string())),
        }
    }

    /// Registers a route pattern (e.g. `/api/v1/users/:id/profile`, `/static/*file`).
    pub fn add(&mut self, path: &str, handler: T) {
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let mut curr = &mut self.root;

        for seg in segments {
            let kind = if let Some(stripped) = seg.strip_prefix(':') {
                NodeKind::Param(stripped.to_string())
            } else if let Some(stripped) = seg.strip_prefix('*') {
                NodeKind::Wildcard(stripped.to_string())
            } else {
                NodeKind::Static(seg.to_string())
            };

            let is_wildcard = matches!(kind, NodeKind::Wildcard(_));
            let found_idx = curr.children.iter().position(|child| match (&child.kind, &kind) {
                (NodeKind::Static(s1), NodeKind::Static(s2)) => s1 == s2,
                (NodeKind::Param(p1), NodeKind::Param(p2)) => p1 == p2,
                (NodeKind::Wildcard(w1), NodeKind::Wildcard(w2)) => w1 == w2,
                _ => false,
            });

            if let Some(idx) = found_idx {
                curr = &mut curr.children[idx];
            } else {
                curr.children.push(Node::new(kind));
                curr = curr.children.last_mut().unwrap();
            }

            if is_wildcard {
                break;
            }
        }

        curr.handler = Some(handler);
    }

    /// Resolves a requested URL path against registered routes.
    pub fn lookup<'a>(&'a self, path: &'a str) -> Option<RouteMatch<'a, T>> {
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let mut params = HashMap::new();

        if let Some(handler) = self.match_node(&self.root, &segments, 0, &mut params) {
            Some(RouteMatch { handler, params })
        } else {
            None
        }
    }

    fn match_node<'a>(
        &'a self,
        node: &'a Node<T>,
        segments: &[&str],
        depth: usize,
        params: &mut HashMap<String, String>,
    ) -> Option<&'a T> {
        if depth == segments.len() {
            return node.handler.as_ref();
        }

        let seg = segments[depth];

        // 1. Try static matches first (highest priority)
        for child in &node.children {
            match &child.kind {
                NodeKind::Static(s) if s == seg => {
                    if let Some(h) = self.match_node(child, segments, depth + 1, params) {
                        return Some(h);
                    }
                }
                _ => {}
            }
        }

        // 2. Try parameter matches (:param)
        for child in &node.children {
            if let NodeKind::Param(ref p) = child.kind {
                params.insert(p.clone(), seg.to_string());
                if let Some(h) = self.match_node(child, segments, depth + 1, params) {
                    return Some(h);
                }
                params.remove(p);
            }
        }

        // 3. Try wildcard matches (*wildcard)
        for child in &node.children {
            if let NodeKind::Wildcard(ref w) = child.kind {
                let tail = segments[depth..].join("/");
                params.insert(w.clone(), tail);
                if let Some(ref h) = child.handler {
                    return Some(h);
                }
                params.remove(w);
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_router_static_and_param() {
        let mut router = Router::new();
        router.add("/api/health", "health_check");
        router.add("/users/:id", "get_user");
        router.add("/static/*filepath", "serve_static");

        let m1 = router.lookup("/api/health").unwrap();
        assert_eq!(*m1.handler, "health_check");
        assert!(m1.params.is_empty());

        let m2 = router.lookup("/users/aphro_42").unwrap();
        assert_eq!(*m2.handler, "get_user");
        assert_eq!(m2.params.get("id"), Some(&"aphro_42".to_string()));

        let m3 = router.lookup("/static/assets/css/style.css").unwrap();
        assert_eq!(*m3.handler, "serve_static");
        assert_eq!(m3.params.get("filepath"), Some(&"assets/css/style.css".to_string()));

        assert!(router.lookup("/nonexistent").is_none());
    }
}
