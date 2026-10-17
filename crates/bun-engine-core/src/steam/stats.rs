//! Achievements and stats: a read-only stub. The engine has no achievement definitions yet; a
//! real AppID declares them in Steamworks and the engine would unlock them through
//! `UserStats::achievement(name).set()` followed by `store_stats()`. Nothing here writes to the
//! user's Steam profile.

use steamworks::Client;

#[derive(Debug, serde::Serialize)]
pub struct Achievement {
    pub name: String,
    pub achieved: bool,
}

/// The achievements Steam declares for the running AppID and whether the user has them.
pub fn achievements(client: &Client) -> Vec<Achievement> {
    let stats = client.user_stats();
    stats
        .get_achievement_names()
        .unwrap_or_default()
        .into_iter()
        .map(|name| {
            let achieved = stats.achievement(&name).get().unwrap_or(false);
            Achievement { name, achieved }
        })
        .collect()
}
