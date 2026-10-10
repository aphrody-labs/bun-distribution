// SPDX-License-Identifier: Apache-2.0
//! Synchronous facade over the shared crawl scheduler for synchronous domain consumers.
use crate::{
    AddRequest, CrawlOptions, CrawlTransport, FetchResult, Frontier, FrontierOptions,
    ObscuraTransport, crawl_bounded,
};
use std::{
    cell::RefCell,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::runtime::{Builder, Runtime};
use url::Url;

struct RecordingTransport {
    inner: ObscuraTransport,
    body: RefCell<Option<String>>,
}

impl CrawlTransport for RecordingTransport {
    async fn fetch(&self, url: &Url) -> Result<FetchResult, String> {
        let response = self.inner.fetch(url).await?;
        if (200..300).contains(&response.status) {
            *self.body.borrow_mut() = Some(response.body.clone());
        }
        Ok(response)
    }
}

/// One native transport/frontier owns retries, per-host pacing and acquired HTML.
/// Domain consumers retain only their parsing and optional persistent result cache.
pub struct BlockingCrawler {
    runtime: Runtime,
    frontier: RefCell<Frontier>,
    transport: RecordingTransport,
    max_attempts: usize,
}

impl BlockingCrawler {
    pub fn new(user_agent: &str, delay_ms: u64, max_attempts: u32) -> Result<Self, String> {
        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?;
        let client = obscura_net::ObscuraHttpClient::new();
        runtime.block_on(client.set_user_agent(user_agent));
        let frontier = Frontier::memory(FrontierOptions {
            per_host_delay_ms: i64::try_from(delay_ms).unwrap_or(i64::MAX),
            max_retries: max_attempts.saturating_sub(1),
            ..FrontierOptions::default()
        })
        .map_err(|error| error.to_string())?;
        Ok(Self {
            runtime,
            frontier: RefCell::new(frontier),
            transport: RecordingTransport {
                inner: ObscuraTransport::new(client),
                body: RefCell::new(None),
            },
            max_attempts: usize::try_from(max_attempts.max(1)).unwrap_or(3),
        })
    }

    pub fn get(&self, value: &str) -> Result<String, String> {
        let url = Url::parse(value).map_err(|error| error.to_string())?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("crawler accepts HTTP(S) URLs only".into());
        }
        let now_ms = i64::try_from(
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        )
        .unwrap_or(i64::MAX);
        let mut frontier = self.frontier.borrow_mut();
        frontier
            .enqueue_or_refresh(AddRequest::seed(value), now_ms)
            .map_err(|error| error.to_string())?;
        let options = CrawlOptions {
            max_depth: 0,
            max_requests: self.max_attempts,
            max_concurrency: 1,
            ..CrawlOptions::default()
        };
        let report = self
            .runtime
            .block_on(crawl_bounded(&mut frontier, &self.transport, &options))
            .map_err(|error| error.to_string())?;
        self.transport.body.borrow_mut().take().ok_or_else(|| {
            report.errors.last().map_or_else(
                || "native crawler returned no body".into(),
                |(_, error)| error.clone(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::Arc,
    };

    #[test]
    fn blocking_consumer_uses_owner_retries_and_can_refresh_without_retaining_bodies() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for (status, body) in [(500, "retry"), (200, "first"), (200, "fresh")] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                let read = stream.read(&mut request).unwrap();
                assert!(read > 0, "the client sent a request");
                write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let mut crawler = BlockingCrawler::new("AphrodyWebTest", 1, 2).unwrap();
        crawler.transport.inner =
            ObscuraTransport::new(obscura_net::ObscuraHttpClient::with_full_options(
                Arc::new(obscura_net::CookieJar::new()),
                None,
                true,
            ));
        assert_eq!(crawler.get(&url).unwrap(), "first");
        assert!(crawler.transport.body.borrow().is_none());
        assert_eq!(crawler.get(&url).unwrap(), "fresh");
        assert!(crawler.transport.body.borrow().is_none());
        assert!(crawler.get("file:///etc/passwd").is_err());
        server.join().unwrap();
    }
}
