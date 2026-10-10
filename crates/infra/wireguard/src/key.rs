// SPDX-License-Identifier: Apache-2.0
//! Curve25519 keys in the WireGuard base64 encoding (`wg genkey`, `wg pubkey`, `wg genpsk`).

use std::fmt;
use std::str::FromStr;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::{Error, Result};

/// A 32-byte WireGuard key (private, public or preshared).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Key(pub [u8; 32]);

impl Key {
    /// A fresh clamped Curve25519 private key (`wg genkey`).
    pub fn generate_private() -> Result<Self> {
        let mut bytes = random_bytes()?;
        bytes[0] &= 248;
        bytes[31] &= 127;
        bytes[31] |= 64;
        Ok(Self(bytes))
    }

    /// A fresh symmetric preshared key (`wg genpsk`).
    pub fn generate_preshared() -> Result<Self> {
        Ok(Self(random_bytes()?))
    }

    /// The public half of this private key (`wg pubkey`).
    #[must_use]
    pub fn public(&self) -> Self {
        let secret = x25519_dalek::StaticSecret::from(self.0);
        Self(x25519_dalek::PublicKey::from(&secret).to_bytes())
    }

    /// Base64 form used by every WireGuard tool.
    #[must_use]
    pub fn to_base64(&self) -> String {
        STANDARD.encode(self.0)
    }

    /// Lower-case hex form used by the cross-platform UAPI.
    #[must_use]
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Whether every byte is zero (WireGuard's "unset" key).
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|b| *b == 0)
    }
}

fn random_bytes() -> Result<[u8; 32]> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| Error::Key(format!("entropy: {e}")))?;
    Ok(bytes)
}

impl FromStr for Key {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        let raw =
            STANDARD.decode(s.trim()).map_err(|e| Error::Key(format!("base64 invalide: {e}")))?;
        let bytes: [u8; 32] = raw.try_into().map_err(|v: Vec<u8>| {
            Error::Key(format!("longueur {} au lieu de 32 octets", v.len()))
        })?;
        Ok(Self(bytes))
    }
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_base64())
    }
}

/// Keys never print their bytes in debug output.
impl fmt::Debug for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Key(..)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc7748_public_key() {
        // RFC 7748 §6.1 Alice's key pair.
        let private =
            Key(hex32("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"));
        let public = hex32("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
        assert_eq!(private.public().0, public);
    }

    #[test]
    fn roundtrip_and_clamp() {
        let k = Key::generate_private().unwrap();
        assert_eq!(k.0[0] & 7, 0);
        assert_eq!(k.0[31] & 0xc0, 0x40);
        let parsed: Key = k.to_base64().parse().unwrap();
        assert_eq!(parsed, k);
        assert!("abc".parse::<Key>().is_err());
        assert!(!Key::generate_preshared().unwrap().is_zero());
    }

    fn hex32(s: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
            out[i] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
        }
        out
    }
}
