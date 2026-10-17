// SPDX-License-Identifier: Apache-2.0
//! Secure in-memory secret handling with automatic memory scrubbing and redaction.

use std::fmt;

/// A protected string that zeroes its memory when dropped and prevents
/// accidental printing in logs, format strings, or debug dumps.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretString {
    inner: Vec<u8>,
}

impl SecretString {
    pub fn new(s: impl AsRef<str>) -> Self {
        Self {
            inner: s.as_ref().as_bytes().to_vec(),
        }
    }

    /// Explicitly borrow the underlying secret plaintext.
    pub fn expose_secret(&self) -> &str {
        std::str::from_utf8(&self.inner).unwrap_or("<invalid-utf8>")
    }

    /// Length in bytes of the secret.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Provide a masked representation: first 2 and last 2 characters visible.
    pub fn masked_preview(&self) -> String {
        let s = self.expose_secret();
        let len = s.chars().count();
        if len <= 4 {
            return "***".to_string();
        }
        let first: String = s.chars().take(2).collect();
        let last: String = s.chars().skip(len - 2).collect();
        format!("{first}...{last} (len: {len})")
    }
}

impl Drop for SecretString {
    fn drop(&mut self) {
        // Volatile wipe of sensitive bytes in memory
        for b in &mut self.inner {
            unsafe {
                std::ptr::write_volatile(b, 0);
            }
        }
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "***REDACTED***")
    }
}

impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[PROTECTED_SECRET]")
    }
}

impl From<&str> for SecretString {
    fn from(s: &str) -> Self {
        Self::new(s)
    }
}

impl From<String> for SecretString {
    fn from(s: String) -> Self {
        Self::new(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_string_redacts_on_debug_and_display() {
        let secret = SecretString::new("super-secret-token-12345");
        assert_eq!(format!("{secret:?}"), "***REDACTED***");
        assert_eq!(format!("{secret}"), "[PROTECTED_SECRET]");
        assert_eq!(secret.expose_secret(), "super-secret-token-12345");
        assert_eq!(secret.masked_preview(), "su...45 (len: 24)");
    }
}
