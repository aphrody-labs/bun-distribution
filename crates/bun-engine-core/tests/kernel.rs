use bun_engine::{Engine, EngineConfig, EngineContext, Plugin};

#[derive(Default)]
struct Counter(u64);

impl Plugin for Counter {
    fn name(&self) -> &'static str {
        "counter"
    }

    fn start(&mut self, context: &mut EngineContext) {
        self.0 = context.tick;
    }

    fn fixed_update(&mut self, context: &mut EngineContext) {
        self.0 = context.tick;
    }
}

#[test]
fn deterministic_fixed_step_advances_once() {
    let config = EngineConfig::default();
    let fixed_step = config.fixed_step;
    let mut engine = Engine::new(config);
    engine.add_plugin(Counter::default());
    engine.fixed_update();
    assert_eq!(engine.context().tick, 1);
    assert_eq!(engine.context().elapsed, fixed_step);
}

#[test]
#[should_panic(expected = "plugin names must be unique")]
fn rejects_duplicate_plugin_owners() {
    let mut engine = Engine::new(EngineConfig::default());
    engine.add_plugin(Counter::default());
    engine.add_plugin(Counter::default());
}
