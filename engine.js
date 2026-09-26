/**
 * ACE dogfight simulation. Coordinates are CSS-independent game pixels.
 * new Dogfight(onEvent) starts the attract animation; reset() starts a new match.
 * tick(seconds, Set<KeyboardEvent.code>) advances the simulation. Public state:
 * phase ('attract' | 'playing' | 'paused' | 'gameover'), time, winner, players,
 * bullets, particles. The renderer may set phase to pause or resume a match.
 * Events: shot {player,x,y}, spawn {player,x,y}, hit {player: victim,attacker,x,y},
 * win {player: winner}. A player's angle points right at 0 and down at PI / 2.
 */
export const WIDTH = 960;
export const HEIGHT = 560;
export const WIN_SCORE = 5;

const TOP = 24;
const BOTTOM = HEIGHT - 48;
const ARENA_HEIGHT = BOTTOM - TOP;
const TURN_SPEED = 2.7;
const FLIGHT_SPEED = 125;
const BOOST_SPEED = 210;
const SHOT_SPEED = 420;
const SHOT_LIFE = 1.15;
const FIRE_INTERVAL = 0.22;
const HIT_RADIUS = 12;
const TAU = Math.PI * 2;
const CONTROLS = [
  { left: 'KeyA', right: 'KeyD', boost: 'KeyW', fire: 'KeyS' },
  { left: 'ArrowLeft', right: 'ArrowRight', boost: 'ArrowUp', fire: 'ArrowDown' },
];
const EMPTY_KEYS = new Set();
const wrap = (value, min, size) => ((value - min) % size + size) % size + min;

// Sweeping a relative segment also accounts for a target moving during a frame.
function segmentHits(ax, ay, bx, by, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
  const x = ax + dx * t;
  const y = ay + dy * t;
  return x * x + y * y <= radius * radius;
}

export class Dogfight {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this._initialize('attract', false);
  }

  reset() {
    this._initialize('playing', true);
  }

  _initialize(phase, emit) {
    this.phase = phase;
    this.time = 0;
    this.winner = null;
    this.bullets = [];
    this.particles = [];
    this.players = [0, 1].map(id => ({
      id,
      x: id ? WIDTH * 0.77 : WIDTH * 0.23,
      y: id ? 328 : 208,
      angle: id ? Math.PI : 0,
      speed: FLIGHT_SPEED,
      score: 0,
      alive: true,
      respawn: 0,
      invulnerable: phase === 'playing' ? 1.5 : 0,
      boosting: false,
      fireCooldown: phase === 'attract' ? id * 0.35 : 0,
      _trailClock: 0,
    }));
    if (emit) {
      for (const player of this.players) this._emit('spawn', player);
    }
  }

  _emit(type, player, extra = {}) {
    this.onEvent({ type, player: player.id, x: player.x, y: player.y, ...extra });
  }

  tick(dt, keys = EMPTY_KEYS) {
    if (!Number.isFinite(dt) || dt <= 0 || this.phase === 'paused') return;
    // Bound long tab-switch frames; small steps keep steering and hits consistent.
    const elapsed = Math.min(dt, 0.1);
    const steps = Math.ceil(elapsed / (1 / 120));
    const step = elapsed / steps;
    for (let i = 0; i < steps; i++) {
      this._advanceParticles(step);
      if (this.phase === 'gameover') continue;
      if (this.phase !== 'playing' && this.phase !== 'attract') continue;
      this.time += step;
      const attract = this.phase === 'attract';
      for (const player of this.players) this._advancePlayer(player, step, keys, attract);
      this._advanceBullets(step, attract);
    }
  }

  _advancePlayer(player, dt, keys, attract) {
    if (!player.alive) {
      player.respawn = Math.max(0, player.respawn - dt);
      if (player.respawn <= 0) this._spawn(player);
      return;
    }
    const controls = CONTROLS[player.id];
    const turn = attract
      ? Math.sin(this.time * 0.29 + player.id * 2.4) * 0.38 + (player.id ? -0.18 : 0.18)
      : Number(keys.has(controls.right)) - Number(keys.has(controls.left));
    player.angle = wrap(player.angle + turn * TURN_SPEED * dt, -Math.PI, TAU);
    player.boosting = !attract && keys.has(controls.boost);
    const targetSpeed = player.boosting ? BOOST_SPEED : FLIGHT_SPEED;
    player.speed += (targetSpeed - player.speed) * (1 - Math.exp(-6 * dt));
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player._prevX = player.x;
    player._prevY = player.y;
    player._stepDX = Math.cos(player.angle) * player.speed * dt;
    player._stepDY = Math.sin(player.angle) * player.speed * dt;
    player.x = wrap(player.x + player._stepDX, 0, WIDTH);
    player.y = wrap(player.y + player._stepDY, TOP, ARENA_HEIGHT);

    player._trailClock += dt;
    const trailInterval = player.boosting ? 0.025 : 0.08;
    if (player._trailClock >= trailInterval) {
      player._trailClock = 0;
      const life = player.boosting ? 0.36 : 0.2;
      this.particles.push({
        x: player.x - Math.cos(player.angle) * 14,
        y: player.y - Math.sin(player.angle) * 14,
        vx: -Math.cos(player.angle) * 18,
        vy: -Math.sin(player.angle) * 18,
        life, maxLife: life,
        color: player.boosting ? '#ffbf69' : '#ffffff',
        size: player.boosting ? 2 : 1,
      });
    }
    if ((attract || keys.has(controls.fire)) && player.fireCooldown <= 0) {
      this._shoot(player, attract);
    }
  }

  _shoot(player, attract) {
    const cos = Math.cos(player.angle);
    const sin = Math.sin(player.angle);
    const x = wrap(player.x + cos * 19, 0, WIDTH);
    const y = wrap(player.y + sin * 19, TOP, ARENA_HEIGHT);
    this.bullets.push({
      x, y, prevX: x, prevY: y,
      vx: cos * (SHOT_SPEED + player.speed),
      vy: sin * (SHOT_SPEED + player.speed),
      owner: player.id,
      life: SHOT_LIFE,
    });
    player.fireCooldown = attract ? 1.5 + player.id * 0.45 : FIRE_INTERVAL;
    if (!attract) this._emit('shot', player);
  }

  _advanceBullets(dt, attract) {
    for (const bullet of this.bullets) {
      bullet.life -= dt;
      if (bullet.life <= 0) continue;
      const oldX = bullet.x;
      const oldY = bullet.y;
      const dx = bullet.vx * dt;
      const dy = bullet.vy * dt;
      bullet.x = wrap(oldX + dx, 0, WIDTH);
      bullet.y = wrap(oldY + dy, TOP, ARENA_HEIGHT);
      // Keep renderer trails short even on the exact step that wraps an edge.
      bullet.prevX = bullet.x - dx;
      bullet.prevY = bullet.y - dy;
      if (attract || this.phase !== 'playing') continue;
      const target = this.players[1 - bullet.owner];
      if (!target.alive || target.invulnerable > 0) continue;
      let hit = false;
      // Test adjacent images of the toroidal arena, never a line across its center.
      for (const offsetX of [-WIDTH, 0, WIDTH]) {
        for (const offsetY of [-ARENA_HEIGHT, 0, ARENA_HEIGHT]) {
          const ax = oldX - target._prevX - offsetX;
          const ay = oldY - target._prevY - offsetY;
          if (segmentHits(ax, ay, ax + dx - target._stepDX, ay + dy - target._stepDY, HIT_RADIUS)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) {
        bullet.life = 0;
        this._hit(target, bullet.owner);
      }
    }
    this.bullets = this.bullets.filter(bullet => bullet.life > 0);
  }

  _hit(player, attacker) {
    player.alive = false;
    player.boosting = false;
    player.respawn = 1.2;
    const scorer = this.players[attacker];
    scorer.score += 1;
    for (let i = 0; i < 32; i++) {
      const direction = Math.random() * TAU;
      const speed = 25 + Math.random() * 125;
      const life = 0.3 + Math.random() * 0.65;
      this.particles.push({
        x: player.x, y: player.y,
        vx: Math.cos(direction) * speed,
        vy: Math.sin(direction) * speed,
        life, maxLife: life,
        color: i % 3 ? '#ffffff' : '#ffbf69',
        size: i % 4 === 0 ? 4 : 2,
      });
    }
    this._emit('hit', player, { attacker, score: scorer.score });
    if (scorer.score >= WIN_SCORE) {
      this.winner = attacker;
      this.phase = 'gameover';
      this._emit('win', scorer);
    }
  }

  _spawn(player) {
    const opponent = this.players[1 - player.id];
    const choices = [144, 268, 392];
    const spawnX = player.id ? WIDTH * 0.77 : WIDTH * 0.23;
    // Prefer a lane separated from the opponent; grace time covers incoming fire.
    choices.sort((a, b) => Math.min(Math.abs(b - opponent.y), ARENA_HEIGHT - Math.abs(b - opponent.y))
      - Math.min(Math.abs(a - opponent.y), ARENA_HEIGHT - Math.abs(a - opponent.y)));
    player.x = spawnX;
    player.y = choices[0];
    player.angle = player.id ? Math.PI : 0;
    player.speed = FLIGHT_SPEED;
    player.alive = true;
    player.respawn = 0;
    player.invulnerable = 1.5;
    player.boosting = false;
    player.fireCooldown = 0.15;
    player._trailClock = 0;
    player._prevX = player.x;
    player._prevY = player.y;
    player._stepDX = 0;
    player._stepDY = 0;
    this._emit('spawn', player);
  }

  _advanceParticles(dt) {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const drag = Math.exp(-2 * dt);
      particle.vx *= drag;
      particle.vy *= drag;
    }
    this.particles = this.particles.filter(particle => particle.life > 0);
  }
}
