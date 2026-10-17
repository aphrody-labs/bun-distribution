#![deny(unsafe_op_in_unsafe_fn)]

pub mod backend;
pub mod binary;
#[cfg(feature = "cartridge")]
pub mod cartridge;
pub mod ffi;
#[cfg(feature = "host")]
pub mod host;
pub mod machine;
pub mod recomp;
#[cfg(feature = "window")]
pub mod window;

use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineConfig {
    pub application_name: String,
    pub fixed_step: Duration,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            application_name: "Bun Engine".into(),
            fixed_step: Duration::from_nanos(16_666_667),
        }
    }
}

pub trait Plugin: Send {
    fn name(&self) -> &'static str;
    fn start(&mut self, context: &mut EngineContext);
    fn fixed_update(&mut self, context: &mut EngineContext);
}

#[derive(Debug, Default)]
pub struct EngineContext {
    pub tick: u64,
    pub elapsed: Duration,
}

pub struct Engine {
    config: EngineConfig,
    context: EngineContext,
    plugins: Vec<Box<dyn Plugin>>,
    started: bool,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Self {
            config,
            context: EngineContext::default(),
            plugins: Vec::new(),
            started: false,
        }
    }

    pub fn add_plugin(&mut self, plugin: impl Plugin + 'static) {
        assert!(!self.started, "plugins must be registered before startup");
        assert!(
            self.plugins.iter().all(|item| item.name() != plugin.name()),
            "plugin names must be unique"
        );
        self.plugins.push(Box::new(plugin));
    }

    pub fn start(&mut self) {
        if self.started {
            return;
        }
        for plugin in &mut self.plugins {
            plugin.start(&mut self.context);
        }
        self.started = true;
    }

    pub fn fixed_update(&mut self) {
        self.start();
        self.context.tick += 1;
        self.context.elapsed += self.config.fixed_step;
        for plugin in &mut self.plugins {
            plugin.fixed_update(&mut self.context);
        }
    }

    pub fn context(&self) -> &EngineContext {
        &self.context
    }
}
