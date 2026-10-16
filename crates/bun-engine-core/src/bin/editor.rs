use bun_engine::{Engine, EngineConfig};

fn main() {
    let mut engine = Engine::new(EngineConfig::default());
    engine.fixed_update();
    println!("Bun Engine Editor tick {}", engine.context().tick);
}
