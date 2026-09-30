// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;
use url::Url;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostTraits {
    pub name: String,
    pub proprietary: bool,
    pub needs_referer: bool,
    pub obfuscated: bool,
}

const HOSTS: &[(&[&str], &str, bool, bool)] = &[
    (&["ansembed"], "ansembed", false, false),
    (&["embed4me", "lpayer"], "embed4me", false, false),
    (&["sibnet"], "sibnet", false, false),
    (&["vidmoly"], "vidmoly", false, false),
    (&["oneupload"], "oneupload", false, false),
    (&["sendvid"], "sendvid", false, false),
    (&["movearnpre"], "movearnpre", false, false),
    (&["streamhide", "guccihide", "haghalaz"], "streamhide", false, false),
    (&["vk.com", "vkvideo"], "vk", false, false),
    (&["myvi."], "myvi", false, false),
    (&["anime-sama.fr", "anime-sama.to"], "anime-sama", false, false),
    (&["weneverbeenfree", "filemoon", "kerapoxy", "moon"], "filemoon", false, false),
    (&["streamtape", "strtape", "tapecontent", "streamadblock"], "streamtape", false, false),
    (&["dood", "d000d", "dooood", "ds2play"], "doodstream", false, false),
    (&["mp4upload"], "mp4upload", false, false),
    (&["yourupload"], "yourupload", false, false),
    (&["voe.sx", "voe"], "voe", false, true),
    (&["mail.ru"], "mailru", false, true),
    (&["youtube.com", "youtu.be", "youtube-nocookie"], "youtube", true, false),
    (&["dailymotion"], "dailymotion", true, false),
    (&["vimeo.com"], "vimeo", true, false),
];

pub fn host_traits(embed_url: &str) -> HostTraits {
    let host =
        Url::parse(embed_url).ok().and_then(|url| url.host_str().map(str::to_ascii_lowercase));
    if let Some(host) = &host {
        for (aliases, name, proprietary, obfuscated) in HOSTS {
            if aliases.iter().any(|alias| host.contains(alias)) {
                return HostTraits {
                    name: (*name).to_string(),
                    proprietary: *proprietary,
                    needs_referer: true,
                    obfuscated: *obfuscated,
                };
            }
        }
    }
    HostTraits {
        name: host
            .map(|host| host.trim_start_matches("www.").to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        proprietary: false,
        needs_referer: true,
        obfuscated: false,
    }
}

pub fn host_from_url(embed_url: &str) -> String {
    host_traits(embed_url).name
}

pub fn normalize_embed_url(url: &str) -> String {
    let mut parsed = match Url::parse(url.trim()) {
        Ok(parsed) => parsed,
        Err(_) => return url.trim().to_string(),
    };
    if matches!(parsed.host_str(), Some("vidmoly.to" | "vidmoly.net")) {
        let _ = parsed.set_host(Some("vidmoly.biz"));
    }
    parsed.to_string()
}

pub fn playback_headers(embed_url: &str, user_agent: Option<&str>) -> BTreeMap<String, String> {
    let mut headers = BTreeMap::new();
    if let Some(user_agent) = user_agent {
        headers.insert("User-Agent".to_string(), user_agent.to_string());
    }
    if host_traits(embed_url).needs_referer
        && let Ok(url) = Url::parse(embed_url)
    {
        let origin = url.origin().ascii_serialization();
        if origin != "null" {
            headers.insert("Referer".to_string(), format!("{origin}/"));
            headers.insert("Origin".to_string(), origin);
        }
    }
    headers
}

pub fn expiry_from_url(url: &str) -> Option<u64> {
    let url = Url::parse(url).ok()?;
    for key in ["expires", "expire", "exp", "e", "t", "validto"] {
        let Some((_, raw)) = url.query_pairs().find(|(name, _)| name == key) else { continue };
        if !(9..=14).contains(&raw.len()) || !raw.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }
        let mut millis = raw.parse::<u64>().ok()?;
        if raw.len() < 13 {
            millis = millis.checked_mul(1000)?;
        }
        if (1_577_836_800_000..4_102_444_800_000).contains(&millis) {
            return Some(millis);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_and_headers() {
        assert_eq!(host_from_url("https://video.sibnet.ru/e"), "sibnet");
        assert_eq!(host_from_url("https://www.other.test/e"), "other.test");
        assert!(host_traits("https://youtube.com/embed/x").proprietary);
        assert_eq!(normalize_embed_url("https://vidmoly.to/e"), "https://vidmoly.biz/e");
        assert_eq!(
            playback_headers("https://video.sibnet.ru/e", None)["Referer"],
            "https://video.sibnet.ru/"
        );
        assert_eq!(expiry_from_url("https://x.test/v.mp4?exp=1800000000"), Some(1_800_000_000_000));
    }
}
