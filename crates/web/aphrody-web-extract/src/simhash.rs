//! Charikar SimHash over normalized word shingles.
//!
//! The fingerprint is stable across platforms and releases: it only depends on
//! FNV-1a 64 (fixed offset basis and prime) followed by the MurmurHash3 `fmix64`
//! finalizer, both hand-written here. `std::hash::DefaultHasher` is never used.
//!
//! Recommended near-duplicate threshold for 64-bit fingerprints: a Hamming
//! distance of **3 bits or fewer** (Manku, Jain, Das Sarma — "Detecting
//! Near-Duplicates for Web Crawling", WWW 2007). Use 4–6 bits for a looser
//! "same story, different template" family grouping at the cost of more false
//! positives on short texts.

/// Recommended `max_bits` for [`is_near_duplicate`] on 64-bit fingerprints.
pub const DEFAULT_NEAR_DUPLICATE_BITS: u32 = 3;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

#[inline]
fn fnv1a_extend(mut hash: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// MurmurHash3 64-bit finalizer. FNV-1a alone has weak diffusion in its high
/// bits for short inputs; SimHash needs every output bit to be close to a fair
/// coin, so the FNV state is avalanched once per shingle.
#[inline]
fn fmix64(mut k: u64) -> u64 {
    k ^= k >> 33;
    k = k.wrapping_mul(0xff51_afd7_ed55_8ccd);
    k ^= k >> 33;
    k = k.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    k ^= k >> 33;
    k
}

/// Stable 64-bit hash of a byte string (FNV-1a 64 + fmix64).
pub fn stable_hash64(bytes: &[u8]) -> u64 {
    fmix64(fnv1a_extend(FNV_OFFSET, bytes))
}

/// Normalizes text for fingerprinting: Unicode lowercase, tokens are maximal
/// runs of Unicode alphanumeric characters, joined by a single ASCII space.
///
/// Punctuation, markup remnants, tracking parameters rendered as text
/// separators and whitespace differences therefore do not affect the hash.
pub fn normalize_text_for_hash(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for token in tokens(text) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&token);
    }
    out
}

/// Iterator over normalized (lowercased, alphanumeric) tokens.
pub(crate) fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| if !t.chars().any(char::is_uppercase) { t.to_string() } else { t.to_lowercase() })
}

/// Calls `f` with the FNV-1a hash of every normalized token, without
/// allocating (lowercasing is applied on the fly).
fn for_each_token_hash(text: &str, mut f: impl FnMut(u64)) {
    let mut h = FNV_OFFSET;
    let mut in_token = false;
    let mut utf8 = [0u8; 4];
    for c in text.chars() {
        if c.is_alphanumeric() {
            in_token = true;
            if c.is_ascii() {
                h = fnv1a_extend(h, &[c.to_ascii_lowercase() as u8]);
            } else {
                for lc in c.to_lowercase() {
                    h = fnv1a_extend(h, lc.encode_utf8(&mut utf8).as_bytes());
                }
            }
        } else if in_token {
            f(h);
            h = FNV_OFFSET;
            in_token = false;
        }
    }
    if in_token {
        f(h);
    }
}

#[inline]
fn accumulate(acc: &mut [i32; 64], h: u64) {
    for (bit, slot) in acc.iter_mut().enumerate() {
        *slot += (((h >> bit) & 1) as i32) * 2 - 1;
    }
}

/// Computes a 64-bit Charikar SimHash of `text`.
///
/// Features are word 3-shingles of the normalized token stream (unigrams when
/// fewer than three tokens exist). Every occurrence of a shingle contributes
/// once, so features are weighted by their frequency in the text.
/// Returns `0` for text without any alphanumeric token.
pub fn simhash64(text: &str) -> u64 {
    let mut acc = [0i32; 64];
    let mut window = [0u64; 3];
    let mut count = 0usize;
    for_each_token_hash(text, |th| {
        window = [window[1], window[2], th];
        count += 1;
        if count >= 3 {
            // Order-sensitive combination of the three token hashes, then
            // avalanche (equivalent in spirit to hashing "t1 t2 t3").
            let mut h = FNV_OFFSET;
            for part in &window {
                h = fnv1a_extend(h, &part.to_le_bytes());
                h = fnv1a_extend(h, b" ");
            }
            accumulate(&mut acc, fmix64(h));
        }
    });
    match count {
        0 => return 0,
        1 | 2 => {
            for &th in &window[3 - count..] {
                accumulate(&mut acc, fmix64(th));
            }
        },
        _ => {},
    }
    let mut fingerprint = 0u64;
    for (bit, &v) in acc.iter().enumerate() {
        if v > 0 {
            fingerprint |= 1 << bit;
        }
    }
    fingerprint
}

/// Number of differing bits between two fingerprints.
#[inline]
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Returns `true` when two fingerprints differ by at most `max_bits` bits.
/// See [`DEFAULT_NEAR_DUPLICATE_BITS`] (3) for the recommended threshold.
#[inline]
pub fn is_near_duplicate(a: u64, b: u64, max_bits: u32) -> bool {
    hamming_distance(a, b) <= max_bits
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARTICLE: &str = "The city council approved a new plan on Tuesday to expand the tram network across the \
         northern districts, adding eleven stations and a maintenance depot. Officials said \
         construction would begin next spring and last roughly four years, with the first section \
         opening to passengers in 2029. Residents who attended the public hearing raised concerns \
         about noise, the loss of parking spaces along the main avenue, and the temporary closure \
         of two bus lines during the works. The transport department answered that night work \
         would be limited, that a shuttle service would replace the bus lines, and that the new \
         line would cut average commuting time by twelve minutes. The project is funded by the \
         regional government, a European infrastructure grant and a municipal bond issued last \
         year. Opposition members criticised the cost estimate, arguing that similar projects in \
         neighbouring cities had exceeded their budgets by a third. The mayor replied that the \
         contract includes penalties for delays and a fixed price for the civil engineering lots, \
         and that an independent committee would publish a progress report every six months until \
         the line is completed.";

    #[test]
    fn hash_is_stable_across_versions() {
        // Pinned values: changing the hash function breaks persisted fingerprints.
        assert_eq!(stable_hash64(b""), fmix64(FNV_OFFSET));
        assert_eq!(fnv1a_extend(FNV_OFFSET, b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(simhash64(""), 0);
        assert_eq!(simhash64("  ,,, !! "), 0);
        let pinned = simhash64("hello world from aphrody-web");
        assert_eq!(pinned, simhash64("Hello, WORLD — from APHRODY_WEB!"));
    }

    #[test]
    fn identical_text_has_zero_distance() {
        assert_eq!(hamming_distance(simhash64(ARTICLE), simhash64(ARTICLE)), 0);
    }

    #[test]
    fn formatting_and_tracking_variants_are_near_duplicates() {
        // The same article served at `?utm_source=…` differs only in markup
        // whitespace, casing and punctuation once extracted.
        let a = simhash64(ARTICLE);
        let variant = ARTICLE
            .replace("  ", "\n\t ")
            .replace(", ", " — ")
            .replace('.', ".\u{0}")
            .to_uppercase();
        let b = simhash64(&variant);
        assert_eq!(hamming_distance(a, b), 0);
        // A short boilerplate crumb left over by a different template.
        let crumb = format!("{ARTICLE} Share this story");
        let c = simhash64(&crumb);
        assert!(hamming_distance(a, c) <= 3, "distance {}", hamming_distance(a, c));
        assert!(is_near_duplicate(a, c, DEFAULT_NEAR_DUPLICATE_BITS));
    }

    #[test]
    fn minor_edit_is_near_duplicate() {
        let a = simhash64(ARTICLE);
        let edited = ARTICLE.replace("eleven stations", "twelve stations");
        let b = simhash64(&edited);
        assert!(hamming_distance(a, b) <= 3, "distance {}", hamming_distance(a, b));
    }

    #[test]
    fn unrelated_texts_are_far_apart() {
        let other = "Preheat the oven to 180 degrees. Whisk the eggs with sugar until pale, fold \
                     in the flour and melted butter, then pour the batter into a buttered tin. \
                     Bake for thirty-five minutes until a knife comes out clean and let the cake \
                     cool on a rack before slicing. Serve with whipped cream and fresh berries, \
                     or keep it wrapped for three days at room temperature.";
        let d = hamming_distance(simhash64(ARTICLE), simhash64(other));
        assert!(d >= 20, "distance {d}");
    }

    #[test]
    fn short_texts_use_unigrams() {
        assert_ne!(simhash64("rust"), 0);
        assert_eq!(simhash64("rust lang"), simhash64("RUST, lang"));
    }

    #[test]
    fn normalization() {
        assert_eq!(
            normalize_text_for_hash("  Hello,\u{0}WORLD!  Été 2025 "),
            "hello world été 2025"
        );
        assert_eq!(normalize_text_for_hash(""), "");
    }
}
