import assert from 'node:assert/strict';
import { Dogfight, WIDTH, HEIGHT, WIN_SCORE } from './engine.js';

const none = new Set();
const frame = 1 / 120;
const advance = (game, seconds, keys = none) => {
  for (let t = 0; t < seconds - 1e-8; t += frame) game.tick(Math.min(frame, seconds - t), keys);
};
const ready = () => {
  const game = new Dogfight();
  game.reset();
  for (const plane of game.players) plane.invulnerable = 0;
  return game;
};
const aimAt = (game, targetId = 1, speed = 12000) => {
  const target = game.players[targetId];
  game.bullets.push({
    x: target.x - 40, y: target.y, prevX: target.x - 40, prevY: target.y,
    vx: speed, vy: 0, owner: 1 - targetId, life: 1,
  });
};

// Both sets of keys act simultaneously, with opposite steering and independent fire.
{
  const game = ready();
  advance(game, 0.4, new Set(['KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowUp', 'ArrowDown']));
  assert.ok(game.players[0].angle > 1);
  assert.ok(game.players[1].angle < Math.PI - 1);
  assert.ok(game.players.every(p => p.speed > 195 && p.boosting));
  assert.deepEqual(new Set(game.bullets.map(b => b.owner)), new Set([0, 1]));
  assert.ok(game.bullets.length <= 4, 'fire rate limits shots while keys are held');
}

// Flight wraps at all playfield edges and never enters the decorative ground.
{
  const game = ready();
  Object.assign(game.players[0], { x: WIDTH - 0.5, angle: 0 });
  Object.assign(game.players[1], { y: 24.5, angle: -Math.PI / 2 });
  game.tick(frame);
  assert.ok(game.players[0].x < 2);
  assert.ok(game.players[1].y > HEIGHT - 50 && game.players[1].y < HEIGHT - 48);
  advance(game, 20, new Set(['KeyA', 'ArrowRight']));
  for (const player of game.players) {
    assert.ok(player.x >= 0 && player.x < WIDTH);
    assert.ok(player.y >= 24 && player.y < HEIGHT - 48);
  }
}

// A very fast projectile hits through a plane instead of tunneling past it.
{
  const game = ready();
  aimAt(game);
  game.tick(frame);
  assert.equal(game.players[1].alive, false);
  assert.equal(game.players[0].score, 1);
  assert.ok(game.particles.length >= 32);
  advance(game, 1.25);
  assert.equal(game.players[1].alive, true);
  assert.ok(game.players[1].invulnerable > 1.4);
  aimAt(game);
  game.tick(frame);
  assert.equal(game.players[0].score, 1, 'respawn grace prevents a second hit');
}

// A wrapping shot must not collide with a plane in the middle of the arena.
{
  const game = ready();
  Object.assign(game.players[1], { x: WIDTH / 2, y: 200 });
  game.bullets.push({ x: WIDTH - 2, y: 200, prevX: WIDTH - 2, prevY: 200, vx: 720, vy: 0, owner: 0, life: 1 });
  game.tick(frame);
  assert.equal(game.players[1].alive, true);
  assert.equal(game.players[0].score, 0);
  assert.ok(Math.abs(game.bullets[0].x - game.bullets[0].prevX) < 10, 'wrap keeps the visual trail short');
}

// A wrapping shot still hits a plane near the opposite edge.
{
  const game = ready();
  Object.assign(game.players[1], { x: 3, y: 200, angle: 0 });
  game.bullets.push({ x: WIDTH - 18, y: 200, prevX: WIDTH - 18, prevY: 200, vx: 3600, vy: 0, owner: 0, life: 1 });
  game.tick(frame);
  assert.equal(game.players[1].alive, false);
  assert.equal(game.players[0].score, 1);
}

// Match completion is emitted once, pause freezes all state, reset removes old shots.
{
  const events = [];
  const game = new Dogfight(event => events.push(event));
  game.reset();
  game.players[0].score = WIN_SCORE - 1;
  game.players[1].invulnerable = 0;
  aimAt(game);
  game.tick(frame);
  assert.equal(game.phase, 'gameover');
  assert.equal(game.winner, 0);
  advance(game, 2, new Set(['KeyS']));
  assert.equal(events.filter(event => event.type === 'win').length, 1);
  game.reset();
  assert.equal(game.phase, 'playing');
  assert.equal(game.winner, null);
  assert.ok(game.players.every(player => player.score === 0 && player.alive));
  assert.equal(game.bullets.length, 0);
  game.phase = 'paused';
  const snapshot = JSON.stringify(game);
  advance(game, 1, new Set(['KeyD', 'KeyS']));
  assert.equal(JSON.stringify(game), snapshot);
}

console.log('Passed 6 engine checks: simultaneous controls, wrapping, swept hits, respawn grace, edge shots, match lifecycle.');
