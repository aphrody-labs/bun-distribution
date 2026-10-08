// SPDX-License-Identifier: Apache-2.0
//! Pure, deterministic combat simulation shared by browser WASM and native services.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Player {
    pub x: f32,
    pub y: f32,
    pub vy: f32,
    pub hp: f32,
    pub energy: f32,
    pub facing: f32,
    pub cooldown: f32,
    pub combo: u8,
    pub transformed: f32,
    pub style: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Enemy {
    pub x: f32,
    pub y: f32,
    pub hp: f32,
    pub cooldown: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Shot {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub damage: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Game {
    pub player: Player,
    pub enemies: Vec<Enemy>,
    pub shots: Vec<Shot>,
    pub wave: u8,
    pub score: u32,
    pub time: f32,
    pub spawn: f32,
    pub status: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Input {
    pub left: bool,
    pub right: bool,
    pub jump: bool,
    pub charge: bool,
    pub transform: bool,
    pub punch: bool,
    pub blast: bool,
}

impl Game {
    #[must_use]
    pub fn new(style: &str) -> Self {
        Self {
            player: Player {
                x: 160.0,
                y: 320.0,
                vy: 0.0,
                hp: 100.0,
                energy: 40.0,
                facing: 1.0,
                cooldown: 0.0,
                combo: 0,
                transformed: 0.0,
                style: if style == "speed" || style == "power" { style } else { "balanced" }
                    .to_owned(),
            },
            enemies: Vec::new(),
            shots: Vec::new(),
            wave: 0,
            score: 0,
            time: 0.0,
            spawn: 0.0,
            status: "playing".to_owned(),
        }
    }

    pub fn step(&mut self, input: Input, elapsed: f32) {
        if self.status != "playing" {
            return;
        }
        let dt = if elapsed.is_finite() { elapsed.clamp(0.0, 0.05) } else { 0.0 };
        let p = &mut self.player;
        self.time += dt;
        p.cooldown = (p.cooldown - dt).max(0.0);
        p.transformed = (p.transformed - dt).max(0.0);
        let movement = f32::from(input.right) - f32::from(input.left);
        if movement != 0.0 {
            p.facing = movement;
        }
        let speed = if p.style == "speed" { 280.0 } else { 215.0 };
        p.x = (p.x + movement * speed * dt).clamp(24.0, 936.0);
        if input.jump && p.y >= 320.0 {
            p.vy = -420.0;
        }
        p.vy += 980.0 * dt;
        p.y = (p.y + p.vy * dt).min(320.0);
        if p.y == 320.0 {
            p.vy = 0.0;
        }
        p.energy = (p.energy + if input.charge { 28.0 } else { 5.0 } * dt).min(100.0);
        if input.transform && p.energy >= 80.0 && p.transformed == 0.0 {
            p.energy -= 80.0;
            p.transformed = 8.0;
        }
        let power = (if p.style == "power" { 1.25 } else { 1.0 })
            * (if p.transformed > 0.0 { 1.7 } else { 1.0 });
        if input.punch && p.cooldown == 0.0 {
            p.combo = p.combo % 3 + 1;
            p.cooldown = 0.28;
            let (x, y, facing, damage) =
                (p.x, p.y, p.facing, (10.0 + f32::from(p.combo) * 3.0) * power);
            for enemy in &mut self.enemies {
                if (enemy.x - x).abs() < 85.0
                    && (enemy.y - y).abs() < 65.0
                    && (enemy.x - x) * facing >= 0.0
                {
                    enemy.hp -= damage;
                    enemy.x += facing * 18.0;
                }
            }
        } else if input.blast && p.cooldown == 0.0 && p.energy >= 20.0 {
            p.energy -= 20.0;
            p.cooldown = 0.45;
            self.shots.push(Shot {
                x: p.x + p.facing * 24.0,
                y: p.y - 20.0,
                vx: p.facing * 520.0,
                damage: 24.0 * power,
            });
        }
        if self.enemies.is_empty() && self.spawn <= 0.0 {
            if self.wave == 5 {
                self.status = "won".to_owned();
                return;
            }
            self.wave += 1;
            for i in 0..=self.wave {
                self.enemies.push(Enemy {
                    x: 660.0 + f32::from(i) * 45.0,
                    y: 320.0,
                    hp: 35.0 + f32::from(self.wave) * 8.0,
                    cooldown: 0.5 + f32::from(i) * 0.2,
                });
            }
        }
        self.spawn = (self.spawn - dt).max(0.0);
        for shot in &mut self.shots {
            shot.x += shot.vx * dt;
            for enemy in &mut self.enemies {
                if enemy.hp > 0.0
                    && (enemy.x - shot.x).abs() < 28.0
                    && (enemy.y - 20.0 - shot.y).abs() < 38.0
                {
                    enemy.hp -= shot.damage;
                    shot.x = -1000.0;
                    break;
                }
            }
        }
        self.shots.retain(|shot| (0.0..960.0).contains(&shot.x));
        let (x, y, transformed) = (self.player.x, self.player.y, self.player.transformed);
        for enemy in &mut self.enemies {
            if enemy.hp <= 0.0 {
                continue;
            }
            enemy.cooldown -= dt;
            let distance = x - enemy.x;
            if distance.abs() > 42.0 {
                enemy.x += distance.signum() * (65.0 + f32::from(self.wave) * 8.0) * dt;
            }
            if distance.abs() < 55.0 && (y - enemy.y).abs() < 55.0 && enemy.cooldown <= 0.0 {
                self.player.hp =
                    (self.player.hp - if transformed > 0.0 { 3.0 } else { 6.0 }).max(0.0);
                enemy.cooldown = 0.85;
            }
        }
        let defeated = self.enemies.iter().filter(|enemy| enemy.hp <= 0.0).count();
        self.score += defeated as u32 * 100;
        self.player.energy = (self.player.energy + defeated as f32 * 8.0).min(100.0);
        let alive = self.enemies.iter().filter(|enemy| enemy.hp > 0.0).count();
        if alive != self.enemies.len() && alive == 0 {
            self.spawn = 1.5;
        }
        self.enemies.retain(|enemy| enemy.hp > 0.0);
        if self.player.hp <= 0.0 {
            self.status = "lost".to_owned();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_time_and_bounds_movement() {
        let mut game = Game::new("speed");
        game.step(Input { left: true, ..Input::default() }, f32::INFINITY);
        assert_eq!(game.player.x, 160.0);
        game.player.x = 25.0;
        game.step(Input { left: true, ..Input::default() }, 1.0);
        assert_eq!(game.player.x, 24.0);
        assert_eq!(game.time, 0.05);
    }

    #[test]
    fn charges_transforms_and_advances_wave() {
        let mut game = Game::new("balanced");
        game.step(Input { charge: true, ..Input::default() }, 0.05);
        assert!(game.player.energy > 40.0);
        game.player.energy = 80.0;
        game.step(Input { transform: true, ..Input::default() }, 0.016);
        assert!(game.player.transformed > 0.0);
        assert_eq!(game.wave, 1);
        assert_eq!(game.enemies.len(), 2);
    }
}
