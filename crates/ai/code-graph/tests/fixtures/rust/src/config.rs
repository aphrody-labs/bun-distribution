use std::path::PathBuf;

/// Runtime configuration.
#[derive(Debug, Clone)]
pub struct Config {
    pub path: PathBuf,
    pub mode: Mode,
    pub retries: Retry,
}

#[derive(Debug, Clone, Copy)]
pub enum Mode {
    Fast,
    Careful(Retry),
    Custom { limit: usize, retry: Retry },
}

#[derive(Debug, Clone, Copy)]
pub struct Retry(pub u32);

impl Default for Config {
    fn default() -> Self {
        Self { path: PathBuf::from("."), mode: Mode::Fast, retries: Retry(3) }
    }
}

impl Config {
    pub fn with_mode(mut self, mode: Mode) -> Self {
        self.mode = mode;
        self
    }

    pub const DEFAULT_LIMIT: usize = 10;
}
