// SPDX-License-Identifier: Apache-2.0

export type FighterStyle = 'balanced' | 'speed' | 'power';

export interface PlayerState {
  x: number;
  y: number;
  vy: number;
  hp: number;
  energy: number;
  facing: number;
  cooldown: number;
  combo: number;
  transformed: number;
  style: FighterStyle;
}

export interface EnemyState {
  x: number;
  y: number;
  hp: number;
  cooldown: number;
  vy?: number;
}

export interface ShotState {
  x: number;
  y: number;
  vx: number;
  fromPlayer: boolean;
}

export interface GameState {
  player: PlayerState;
  enemies: EnemyState[];
  shots: ShotState[];
  wave: number;
  score: number;
  time: number;
  spawn: number;
  status: 'playing' | 'won' | 'lost';
}

export interface GameInput {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  punch?: boolean;
  blast?: boolean;
  charge?: boolean;
  transform?: boolean;
}

export function createGame(style: FighterStyle = 'balanced'): GameState {
  return {
    player: {
      x: 160,
      y: 320,
      vy: 0,
      hp: 100,
      energy: 40,
      facing: 1,
      cooldown: 0,
      combo: 0,
      transformed: 0,
      style,
    },
    enemies: [],
    shots: [],
    wave: 0,
    score: 0,
    time: 0,
    spawn: 0,
    status: 'playing',
  };
}

export function step(g: GameState, input: GameInput, dt: number): void {
  if (g.status !== 'playing') return;
  dt = Math.max(0, Math.min(dt, 0.05));
  const p = g.player;
  g.time += dt;
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.transformed = Math.max(0, p.transformed - dt);

  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (move) p.facing = move;

  const speedMult = p.style === 'speed' ? 360 : 280;
  p.x = Math.max(24, Math.min(936, p.x + move * speedMult * (p.transformed ? 1.3 : 1) * dt));

  if (input.jump && p.y >= 320) {
    p.vy = -540;
  }
  p.y = Math.min(320, p.y + p.vy * dt);
  p.vy = p.y < 320 ? p.vy + 1200 * dt : 0;

  if (input.charge) {
    p.energy = Math.min(100, p.energy + (p.transformed ? 35 : 22) * dt);
  }

  if (input.transform && p.energy >= 80 && !p.transformed) {
    p.energy -= 80;
    p.transformed = 8;
  }

  if (input.punch && p.cooldown <= 0) {
    p.cooldown = p.transformed ? 0.12 : 0.2;
    p.combo = (p.combo % 3) + 1;
    for (const e of g.enemies) {
      if (Math.abs(e.x - p.x) < 55 && Math.abs(e.y - p.y) < 60) {
        const damage = (p.style === 'power' ? 24 : 16) * (p.transformed ? 1.5 : 1);
        e.hp -= damage;
        g.score += Math.round(damage * 10);
      }
    }
  }

  if (input.blast && p.energy >= 15 && p.cooldown <= 0) {
    p.energy -= 15;
    p.cooldown = 0.25;
    g.shots.push({
      x: p.x + p.facing * 30,
      y: p.y - 30,
      vx: p.facing * 520,
      fromPlayer: true,
    });
  }

  // Update projectiles
  for (let i = g.shots.length - 1; i >= 0; i--) {
    const s = g.shots[i];
    s.x += s.vx * dt;
    let hit = false;
    if (s.fromPlayer) {
      for (const e of g.enemies) {
        if (Math.abs(e.x - s.x) < 25 && Math.abs(e.y - 30 - s.y) < 30) {
          e.hp -= p.transformed ? 35 : 25;
          g.score += 200;
          hit = true;
          break;
        }
      }
    }
    if (hit || s.x < 0 || s.x > 960) {
      g.shots.splice(i, 1);
    }
  }

  // Enemy spawning and AI
  g.spawn -= dt;
  if (g.spawn <= 0 && g.wave < 5 && g.enemies.length === 0) {
    g.wave++;
    const count = Math.min(1 + g.wave, 4);
    for (let i = 0; i < count; i++) {
      g.enemies.push({
        x: i % 2 === 0 ? 80 + i * 40 : 880 - i * 40,
        y: 320,
        hp: 35 + g.wave * 12,
        cooldown: 0.8 + Math.random() * 0.5,
      });
    }
    g.spawn = 3;
  }

  // Enemy updates
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (e.hp <= 0) {
      g.enemies.splice(i, 1);
      g.score += 500;
      continue;
    }
    const dir = Math.sign(p.x - e.x);
    if (Math.abs(p.x - e.x) > 45) {
      e.x += dir * (100 + g.wave * 15) * dt;
    }
    e.cooldown -= dt;
    if (Math.abs(p.x - e.x) < 50 && Math.abs(p.y - e.y) < 50 && e.cooldown <= 0) {
      p.hp -= 10 + g.wave * 2;
      e.cooldown = 1.0;
    }
  }

  // Victory / Defeat conditions
  if (p.hp <= 0) {
    p.hp = 0;
    g.status = 'lost';
  } else if (g.wave >= 5 && g.enemies.length === 0) {
    g.status = 'won';
  }
}
