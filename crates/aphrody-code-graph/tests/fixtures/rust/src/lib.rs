//! Fixture crate for the code-graph parity test.
pub mod config;
pub mod net;
pub mod store;

pub use store::Store;

pub const MAX_ITEMS: usize = 128;
pub static GREETING: &str = "hello";

macro_rules! shout {
    ($e:expr) => {
        $e.to_uppercase()
    };
}

pub fn run(config: &config::Config) -> store::Store {
    let mut store = store::Store::open(&config.path);
    store.insert("greeting", GREETING);
    helper(&mut store);
    net::client::fetch_into(&mut store);
    store
}

fn helper(store: &mut store::Store) {
    store.insert("loud", &shout!("x"));
}
