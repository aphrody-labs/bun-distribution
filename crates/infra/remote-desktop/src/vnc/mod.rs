// SPDX-License-Identifier: Apache-2.0
//! RFB (VNC): server fed by the capture backend (`vnc-server`, `rustvncserver`) and client
//! driving any VNC server (`vnc-client`, `vnc-rs`). Both are Apache-2.0/MIT.

#[cfg(feature = "vnc-client")]
pub mod client;
#[cfg(feature = "vnc-server")]
pub mod server;

use std::time::Duration;

use anyhow::{Context, Result, bail};
use tokio::io::AsyncReadExt as _;

/// RFB pointer button-mask bits.
pub mod buttons {
    pub const LEFT: u8 = 1;
    pub const MIDDLE: u8 = 1 << 1;
    pub const RIGHT: u8 = 1 << 2;
    pub const WHEEL_UP: u8 = 1 << 3;
    pub const WHEEL_DOWN: u8 = 1 << 4;
    pub const WHEEL_LEFT: u8 = 1 << 5;
    pub const WHEEL_RIGHT: u8 = 1 << 6;
}

/// Read the RFB banner (`RFB 003.008`) of `addr` without authenticating.
pub async fn probe(addr: &str, timeout: Duration) -> Result<String> {
    let banner = tokio::time::timeout(timeout, async {
        let mut stream = tokio::net::TcpStream::connect(addr).await?;
        let mut buf = [0u8; 12];
        stream.read_exact(&mut buf).await?;
        Ok::<_, std::io::Error>(buf)
    })
    .await
    .with_context(|| format!("{addr}: no RFB banner within {timeout:?}"))?
    .with_context(|| format!("{addr}: connection failed"))?;
    if !banner.starts_with(b"RFB ") {
        bail!("{addr}: not an RFB server");
    }
    Ok(String::from_utf8_lossy(&banner).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probe_reads_banner_and_rejects_others() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt as _;
            for banner in [&b"RFB 003.008\n"[..], &b"HTTP/1.1 200"[..]] {
                let (mut s, _) = l.accept().await.unwrap();
                s.write_all(banner).await.unwrap();
            }
        });
        assert_eq!(probe(&addr, Duration::from_secs(2)).await.unwrap(), "RFB 003.008");
        assert!(probe(&addr, Duration::from_secs(2)).await.is_err());
    }
}
