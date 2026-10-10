use crate::store::{Backend, Store, count};

pub struct Client {
    base: String,
}

impl Client {
    pub fn new(base: &str) -> Self {
        Self { base: base.to_owned() }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path)
    }
}

pub fn fetch_into(store: &mut Store) {
    let client = Client::new("http://localhost");
    let url = client.url("data");
    store.put(&url, "payload");
    let _ = count(store);
}
