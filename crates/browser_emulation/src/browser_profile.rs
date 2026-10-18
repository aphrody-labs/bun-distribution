use wreq::{Client, ClientBuilder};
use wreq_util::{Emulation, Platform, Profile};

/// A browser identity to emulate.
///
/// The named variants cover the browsers we routinely emulate, defaulting to a
/// macOS platform (which is what our desktop app and captured cookies use).
/// [`BrowserProfile::Custom`] is the escape hatch for any other `wreq_util`
/// emulation, a different OS, or a User-Agent override (useful when a site
/// advertises a browser version newer than `wreq_util` ships a fingerprint for).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
pub enum BrowserProfile {
    #[default]
    Firefox139,
    Firefox147,
    Chrome131,
    Chrome145,
    Safari18,
    Custom(CustomBrowserProfile),
}

/// A fully-specified browser identity for [`BrowserProfile::Custom`].
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CustomBrowserProfile {
    /// The `wreq_util` fingerprint to emulate.
    pub emulation: Profile,

    /// The operating system to present (drives `sec-ch-ua-platform`, the UA, …).
    pub os: Platform,

    /// Overrides the User-Agent the emulation would otherwise send. Leave `None`
    /// to use the emulation's built-in UA.
    pub maybe_user_agent: Option<String>,
}

impl BrowserProfile {
    /// A macOS Safari profile with an explicit User-Agent override.
    ///
    /// Use this when the UA must EXACTLY match another client's — e.g. an
    /// embedded webview that captured the cookies, since Cloudflare's
    /// `cf_clearance` is bound to the exact User-Agent string.
    pub fn safari_macos_with_user_agent(user_agent: impl Into<String>) -> Self {
        Self::Custom(CustomBrowserProfile {
            emulation: Profile::Safari18,
            os: Platform::MacOS,
            maybe_user_agent: Some(user_agent.into()),
        })
    }

    /// The profile that best matches a User-Agent captured from another client
    /// (typically the login webview that earned the site's cookies), keeping
    /// that exact UA string.
    ///
    /// Use this whenever cookies are replayed: bot-protection clearances
    /// (Cloudflare `cf_clearance`, DataDome) are bound to the UA and checked
    /// against the TLS/HTTP fingerprint, so the replaying client should present
    /// the same UA on the fingerprint of the same browser family. WebKit-based
    /// UAs (Safari, WKWebView) map to Safari; Chrome/Chromium/Edge to Chrome;
    /// Firefox to Firefox. Anything else falls back to Safari, since our
    /// webviews are WebKit.
    pub fn matching_user_agent(user_agent: impl Into<String>) -> Self {
        let user_agent = user_agent.into();
        let emulation = emulation_for_user_agent(&user_agent);
        Self::Custom(CustomBrowserProfile {
            emulation,
            os: os_for_user_agent(&user_agent),
            maybe_user_agent: Some(user_agent),
        })
    }

    /// Build a ready-to-use client carrying this profile's full fingerprint and
    /// identity headers. This is the usual entry point.
    pub fn build_client(&self) -> Result<Client, wreq::Error> {
        self.configure_client_builder(Client::builder()).build()
    }

    /// Apply this profile to an existing [`ClientBuilder`], so callers can layer
    /// on their own settings (timeouts, proxies, …) before building.
    pub fn configure_client_builder(&self, builder: ClientBuilder) -> ClientBuilder {
        let builder = builder.emulation(self.emulation_option());
        match self.maybe_user_agent_override() {
            Some(user_agent) => builder.user_agent(user_agent),
            None => builder,
        }
    }

    /// The `wreq` emulation factory (fingerprint + coherent identity headers)
    /// for this profile. Pass it to any `wreq` `emulation(...)` method — e.g. to
    /// emulate at the request level (`RequestBuilder`) or on a websocket upgrade
    /// (`WebSocketRequestBuilder`) instead of at the client level.
    ///
    /// Note: this does NOT include the User-Agent override — that is applied by
    /// [`Self::configure_client_builder`]. When emulating at the request level,
    /// apply any override yourself with a `user-agent` header.
    pub fn emulation_option(&self) -> Emulation {
        Emulation::builder()
            .profile(self.emulation())
            .platform(self.os())
            .build()
    }

    /// The underlying `wreq_util` emulation for this profile.
    pub fn emulation(&self) -> Profile {
        match self {
            Self::Firefox139 => Profile::Firefox139,
            Self::Firefox147 => Profile::Firefox147,
            Self::Chrome131 => Profile::Chrome131,
            Self::Chrome145 => Profile::Chrome145,
            Self::Safari18 => Profile::Safari18,
            Self::Custom(custom) => custom.emulation,
        }
    }

    /// The operating system this profile presents. Named variants default to
    /// macOS.
    pub fn os(&self) -> Platform {
        match self {
            Self::Custom(custom) => custom.os,
            _ => Platform::MacOS,
        }
    }

    /// The User-Agent override, if this profile sets one. Named variants use the
    /// emulation's built-in UA and return `None`.
    pub fn maybe_user_agent_override(&self) -> Option<&str> {
        match self {
            Self::Custom(custom) => custom.maybe_user_agent.as_deref(),
            _ => None,
        }
    }

    /// A short human label for logs and debugging.
    pub fn label(&self) -> String {
        match self {
            Self::Firefox139 => "firefox139".to_string(),
            Self::Firefox147 => "firefox147".to_string(),
            Self::Chrome131 => "chrome131".to_string(),
            Self::Chrome145 => "chrome145".to_string(),
            Self::Safari18 => "safari18".to_string(),
            Self::Custom(custom) => {
                format!("custom({:?} on {:?})", custom.emulation, custom.os)
            }
        }
    }
}

/// The newest fingerprint we ship for the UA's browser family.
fn emulation_for_user_agent(user_agent: &str) -> Profile {
    let lower = user_agent.to_ascii_lowercase();
    if lower.contains("firefox/") {
        Profile::Firefox147
    } else if lower.contains("chrome/") || lower.contains("chromium/") || lower.contains("edg/") {
        Profile::Chrome145
    } else {
        // Safari proper, WKWebView UAs ("AppleWebKit/... Safari/..." without
        // "Chrome/"), and anything unrecognized: our webviews are WebKit.
        Profile::Safari18
    }
}

fn os_for_user_agent(user_agent: &str) -> Platform {
    let lower = user_agent.to_ascii_lowercase();
    if lower.contains("windows") {
        Platform::Windows
    } else if lower.contains("android") {
        Platform::Android
    } else if lower.contains("iphone") || lower.contains("ipad") {
        Platform::IOS
    } else if lower.contains("linux") || lower.contains("x11") {
        Platform::Linux
    } else {
        Platform::MacOS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WKWEBVIEW_MAC_UA: &str =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    const SAFARI_MAC_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
    const CHROME_MAC_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
    const FIREFOX_WIN_UA: &str =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";

    #[test]
    fn matching_user_agent_picks_family_and_keeps_exact_ua() {
        let safari = BrowserProfile::matching_user_agent(SAFARI_MAC_UA);
        assert_eq!(safari.emulation(), Profile::Safari18);
        assert_eq!(safari.os(), Platform::MacOS);
        assert_eq!(safari.maybe_user_agent_override(), Some(SAFARI_MAC_UA));

        // WKWebView says "Safari/..."-less AppleWebKit; still WebKit.
        assert_eq!(
            BrowserProfile::matching_user_agent(WKWEBVIEW_MAC_UA).emulation(),
            Profile::Safari18
        );

        // Chrome also says "Safari/537.36" — "Chrome/" must win.
        let chrome = BrowserProfile::matching_user_agent(CHROME_MAC_UA);
        assert_eq!(chrome.emulation(), Profile::Chrome145);
        assert_eq!(chrome.os(), Platform::MacOS);

        let firefox = BrowserProfile::matching_user_agent(FIREFOX_WIN_UA);
        assert_eq!(firefox.emulation(), Profile::Firefox147);
        assert_eq!(firefox.os(), Platform::Windows);
    }

    #[test]
    fn matching_user_agent_builds_a_client() {
        BrowserProfile::matching_user_agent(CHROME_MAC_UA)
            .build_client()
            .unwrap();
    }

    #[test]
    fn default_is_firefox139() {
        assert_eq!(BrowserProfile::default(), BrowserProfile::Firefox139);
        assert_eq!(BrowserProfile::default().emulation(), Profile::Firefox139);
    }

    #[test]
    fn named_variants_default_to_macos_and_no_ua_override() {
        assert_eq!(BrowserProfile::Chrome145.os(), Platform::MacOS);
        assert_eq!(BrowserProfile::Chrome145.maybe_user_agent_override(), None);
    }

    #[test]
    fn custom_carries_os_and_ua_override() {
        let profile = BrowserProfile::Custom(CustomBrowserProfile {
            emulation: Profile::Chrome145,
            os: Platform::Windows,
            maybe_user_agent: Some("custom-agent/1.0".to_string()),
        });
        assert_eq!(profile.emulation(), Profile::Chrome145);
        assert_eq!(profile.os(), Platform::Windows);
        assert_eq!(
            profile.maybe_user_agent_override(),
            Some("custom-agent/1.0")
        );
    }

    #[test]
    fn every_profile_builds_a_client() {
        for profile in [
            BrowserProfile::Firefox139,
            BrowserProfile::Firefox147,
            BrowserProfile::Chrome131,
            BrowserProfile::Chrome145,
            BrowserProfile::Safari18,
        ] {
            profile.build_client().unwrap_or_else(|err| {
                panic!(
                    "profile {} failed to build a client: {err}",
                    profile.label()
                )
            });
        }
    }
}
