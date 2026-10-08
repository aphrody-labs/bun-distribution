// SPDX-License-Identifier: Apache-2.0
//! Fast HTTP request/response parsing inspired by `bun_picohttp`.

/// A parsed HTTP header view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HttpHeader<'a> {
    /// Header name (case-preserving).
    pub name: &'a str,
    /// Header value.
    pub value: &'a str,
}

/// A parsed HTTP/1.1 request head.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequestHead<'a> {
    /// HTTP method (e.g. "GET", "POST").
    pub method: &'a str,
    /// Request target / path.
    pub path: &'a str,
    /// Minor version (e.g. 1 for HTTP/1.1).
    pub minor_version: u8,
    /// Parsed headers.
    pub headers: Vec<HttpHeader<'a>>,
    /// Number of bytes consumed from input buffer.
    pub bytes_read: usize,
}

/// Parse an HTTP/1.1 request from a byte slice.
pub fn parse_http_request(buf: &[u8]) -> Result<Option<HttpRequestHead<'_>>, String> {
    let s = match std::str::from_utf8(buf) {
        Ok(s) => s,
        Err(_) => return Err("Invalid UTF-8 in HTTP header".to_string()),
    };

    // Header block ends with \r\n\r\n or \n\n
    let header_end = if let Some(pos) = s.find("\r\n\r\n") {
        pos + 4
    } else if let Some(pos) = s.find("\n\n") {
        pos + 2
    } else {
        return Ok(None); // Incomplete headers
    };

    let header_str = &s[..header_end];
    let mut lines = header_str.lines();

    let request_line = match lines.next() {
        Some(l) => l,
        None => return Ok(None),
    };

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 3 {
        return Err("Malformed HTTP request line".to_string());
    }

    let method = parts[0];
    let path = parts[1];
    let version = parts[2];
    let minor_version = if version == "HTTP/1.1" {
        1
    } else if version == "HTTP/1.0" {
        0
    } else {
        1
    };

    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some(colon) = line.find(':') {
            let name = line[..colon].trim();
            let value = line[colon + 1..].trim();
            headers.push(HttpHeader { name, value });
        }
    }

    Ok(Some(HttpRequestHead {
        method,
        path,
        minor_version,
        headers,
        bytes_read: header_end,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_http() {
        let req = b"GET /api/v1/health HTTP/1.1\r\nHost: localhost:8080\r\nUser-Agent: Aphrody/1.0\r\n\r\n";
        let parsed = parse_http_request(req).unwrap().unwrap();
        assert_eq!(parsed.method, "GET");
        assert_eq!(parsed.path, "/api/v1/health");
        assert_eq!(parsed.headers.len(), 2);
        assert_eq!(parsed.headers[0].name, "Host");
        assert_eq!(parsed.headers[0].value, "localhost:8080");
    }
}
