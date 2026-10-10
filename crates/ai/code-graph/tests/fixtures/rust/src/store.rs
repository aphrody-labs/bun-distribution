use std::collections::HashMap;
use std::path::Path;

use crate::config::Config;

pub trait Backend {
    fn put(&mut self, key: &str, value: &str);
    fn get(&self, key: &str) -> Option<String>;
}

pub struct Store {
    items: HashMap<String, String>,
    config: Option<Config>,
}

impl Store {
    pub fn open(path: &Path) -> Self {
        let _ = path;
        Self { items: HashMap::new(), config: None }
    }

    pub fn insert(&mut self, key: &str, value: &str) {
        self.put(key, value);
        self.audit(key);
    }

    fn audit(&self, key: &str) -> bool {
        self.items.contains_key(key)
    }
}

impl Backend for Store {
    fn put(&mut self, key: &str, value: &str) {
        self.items.insert(key.to_owned(), value.to_owned());
    }

    fn get(&self, key: &str) -> Option<String> {
        self.items.get(key).cloned()
    }
}

pub fn count(store: &Store) -> usize {
    store.items.len()
}
