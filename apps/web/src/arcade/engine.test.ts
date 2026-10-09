// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'bun:test';
import { createGame, step } from './engine';

describe('Dragon Pixel Arcade Engine (Unified in apps/web)', () => {
  it('initializes game state with chosen style', () => {
    const game = createGame('speed');
    expect(game.player.hp).toBe(100);
    expect(game.player.energy).toBe(40);
    expect(game.player.style).toBe('speed');
    expect(game.wave).toBe(0);
    expect(game.status).toBe('playing');
  });

  it('handles player movement and facing direction', () => {
    const game = createGame('balanced');
    const initialX = game.player.x;
    step(game, { right: true }, 0.05);
    expect(game.player.x).toBeGreaterThan(initialX);
    expect(game.player.facing).toBe(1);

    step(game, { left: true }, 0.05);
    expect(game.player.facing).toBe(-1);
  });

  it('charges energy and handles super transformation', () => {
    const game = createGame('balanced');
    // Charge energy
    for (let i = 0; i < 40; i++) {
      step(game, { charge: true }, 0.05);
    }
    expect(game.player.energy).toBeGreaterThanOrEqual(80);

    // Transform
    step(game, { transform: true }, 0.05);
    expect(game.player.transformed).toBeGreaterThan(0);
  });

  it('handles combo hits against enemies and score accumulation', () => {
    const game = createGame('power');
    // Spawn wave 1
    step(game, {}, 0.05);
    expect(game.wave).toBe(1);
    expect(game.enemies.length).toBeGreaterThan(0);

    // Move player close to enemy
    game.player.x = game.enemies[0].x - 10;
    const initialHp = game.enemies[0].hp;
    step(game, { punch: true }, 0.05);

    expect(game.enemies[0].hp).toBeLessThan(initialHp);
    expect(game.score).toBeGreaterThan(0);
  });

  it('handles defeat when player hp drops to 0', () => {
    const game = createGame('balanced');
    game.player.hp = 5;
    game.enemies.push({ x: game.player.x, y: game.player.y, hp: 50, cooldown: 0 });
    step(game, {}, 0.05);

    expect(game.player.hp).toBe(0);
    expect(game.status).toBe('lost');
  });
});
