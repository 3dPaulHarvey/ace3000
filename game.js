import { Dogfight, WIDTH, HEIGHT, WIN_SCORE } from './engine.js';
import { PrivateSession } from './network.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
const names = ['MAVERICK', 'BANDIT'];
const colors = ['#f2f1e9', '#ff9468'];
const keys = new Set();
const flightKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const keycaps = new Map([...document.querySelectorAll('[data-code]')].map(element => [element.dataset.code, element]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let announcementUntil = 0;
let lastPhase = '';
let lastScores = '';
let lastClock = '';
let elapsed = 0;
let previousFrame = performance.now();
let lobbyOpen = false;
let onlineAvailable = false;
let hostKeyRequired = false;
let onlineError = false;
let inviteToken = new URLSearchParams(location.hash.slice(1)).get('join') || '';
let pendingEvents = [];
const bulletIds = new WeakMap();
let nextBulletId = 1;

// Draw the title as a tiny bitmap, so it stays sharp without a font download.
const letters = ['01110/11011/11011/11111/11011/11011/11011', '01111/11000/11000/11000/11000/11000/01111', '11111/11000/11000/11110/11000/11000/11111'];
$('pixel-title').innerHTML = letters.flatMap((letter, index) => letter.split('/').flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '1' ? [`<rect x="${index * 60 + x * 10}" y="${y * 10}" width="10" height="10" fill="#f2f1e9"/>`] : []))).join('');

class ArcadeAudio {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('ace3000-sound') !== 'off'; } catch { /* Storage is optional. */ }
  }
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, this.context.sampleRate * 0.6, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* The game still works if audio is unavailable. */ }
  }
  tone(frequency, endFrequency, duration, volume = 0.3, delay = 0, player = null) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const t = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, t);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain);
    if (player !== null && this.context.createStereoPanner) {
      const pan = this.context.createStereoPanner();
      pan.pan.value = player === 0 ? -0.35 : 0.35;
      gain.connect(pan); pan.connect(this.master);
    } else gain.connect(this.master);
    oscillator.start(t); oscillator.stop(t + duration + 0.02);
  }
  shot(player) { this.tone(player ? 760 : 940, 150, 0.09, 0.17, 0, player); }
  explosion() {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const t = this.context.currentTime;
    source.buffer = this.noise;
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(2300, t); filter.frequency.exponentialRampToValueAtTime(100, t + 0.5);
    gain.gain.setValueAtTime(0.9, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(); source.stop(t + 0.6);
    this.tone(100, 28, 0.35, 0.35);
  }
  start() { [220, 330, 440, 660].forEach((note, i) => this.tone(note, note, 0.12, 0.22, i * 0.075)); }
  win() { [392, 494, 587, 784, 587, 784].forEach((note, i) => this.tone(note, note, i === 5 ? 0.4 : 0.16, 0.3, i * 0.14)); }
  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.16 : 0;
    this.unlock();
    try { localStorage.setItem('ace3000-sound', this.enabled ? 'on' : 'off'); } catch { /* Optional preference. */ }
    updateSoundButton();
    if (this.enabled) this.tone(440, 660, 0.09, 0.2);
  }
}

const audio = new ArcadeAudio();
const network = new PrivateSession(handleNetworkMessage);
function handleGameEvent(event, remote = false) {
  if (!remote && network.role === 'host') pendingEvents.push(event);
  if (event.type === 'shot') audio.shot(event.player);
  if (event.type === 'hit') {
    audio.explosion();
    const announcement = `${names[event.attacker]} SCORES`;
    $('hit-announcement').textContent = announcement;
    $('hit-announcement').style.color = colors[event.attacker];
    announcementUntil = performance.now() + 1600;
    $('screen-reader-status').textContent = `${names[event.attacker]} scores. ${game.players[0].score} to ${game.players[1].score}.`;
    if (!reducedMotion) {
      $('arena').classList.remove('hit');
      void $('arena').offsetWidth;
      $('arena').classList.add('hit');
    }
  }
  if (event.type === 'win') {
    audio.win();
    clearKeys();
    $('screen-reader-status').textContent = `${names[event.player]} wins! Press Enter to fly again.`;
  }
}
const game = new Dogfight(handleGameEvent);

function onlineMessage(message, error = false) {
  $('online-message').textContent = message;
  $('online-message').classList.toggle('error', error);
  onlineError = error;
}

function openLobby() {
  lobbyOpen = true;
  clearKeys();
  $('online-create').hidden = Boolean(inviteToken);
  $('online-join').hidden = !inviteToken;
  $('online-create').disabled = !onlineAvailable;
  $('online-join').disabled = !onlineAvailable;
  $('invite-box').hidden = true;
  $('online-start').hidden = true;
  $('host-key-label').hidden = !hostKeyRequired || Boolean(inviteToken);
  $('online-identity').textContent = inviteToken ? 'YOU: PLAYER 2 · ARROW KEYS' : 'YOU: PLAYER 1 · WASD / FRIEND: PLAYER 2 · ARROWS';
  onlineMessage(onlineAvailable ? (inviteToken ? 'Your friend invited you. Take the second seat.' : 'Create a private room and invite your friend.') : 'Online play needs the online server. Run online_server.py or open your hosted game link.', !onlineAvailable);
  syncInterface();
}

function leaveRoom() {
  network.disconnect();
  pendingEvents = [];
  lobbyOpen = false;
  inviteToken = '';
  history.replaceState(null, '', location.pathname + location.search);
  clearKeys();
  // Return to the same clean attract state as a newly opened page.
  const attract = new Dogfight();
  Object.assign(game, { phase: attract.phase, players: attract.players, bullets: [], particles: [], time: 0, winner: null });
  $('host-key').value = '';
  hideHostPasscode();
  announcementUntil = 0;
  syncInterface();
}

function connectRoom(role) {
  if (role === 'host' && hostKeyRequired && !$('host-key').value) {
    onlineMessage('Enter the host passcode saved in Render before creating a room.', true);
    $('host-key').setAttribute('aria-invalid', 'true');
    $('host-key').focus();
    return;
  }
  $('host-key').setAttribute('aria-invalid', 'false');
  audio.unlock();
  onlineMessage('Connecting to your private airspace…');
  $('online-create').disabled = true;
  $('online-join').disabled = true;
  network.connect(role, role === 'host' ? $('host-key').value : inviteToken);
  syncInterface();
}

function handleNetworkMessage(message) {
  if (message.type === 'created') {
    $('host-key').value = '';
    hideHostPasscode();
    $('host-key-label').hidden = true;
    $('online-create').hidden = true;
    $('invite-box').hidden = false;
    $('online-start').hidden = false;
    $('online-start').disabled = true;
    $('online-start').textContent = 'WAITING FOR FRIEND…';
    const invitation = new URL(location.href);
    invitation.hash = `join=${message.token}`;
    $('invite-link').value = invitation.href;
    $('invite-note').textContent = ['127.0.0.1', 'localhost'].includes(location.hostname)
      ? 'Local test link only. Deploy the online server to get a link your distant friend can open.'
      : 'Only the person with this link can join. Keep this page open.';
    onlineMessage('Your room is open. Send your friend the invitation below.');
  } else if (message.type === 'joined') {
    $('online-join').hidden = true;
    onlineMessage('You’re Player 2. Waiting for your friend to start.');
  } else if (message.type === 'peer-ready') {
    clearKeys();
    pendingEvents = [];
    onlineMessage('Your friend is here. You’re both cleared for takeoff.');
    $('online-start').disabled = false;
    $('online-start').textContent = game.phase === 'paused' ? 'RESUME DOGFIGHT ↗' : 'START DOGFIGHT ↗';
    audio.tone(660, 880, 0.14, 0.25);
  } else if (message.type === 'peer-left') {
    pauseMatch(true);
    lobbyOpen = true;
    $('online-start').disabled = true;
    $('online-start').textContent = 'WAITING FOR FRIEND…';
    onlineMessage('Your friend disconnected. The match is paused. They can rejoin with the same link.');
  } else if (message.type === 'state' && network.role === 'guest') {
    const state = message.state;
    if (state.phase === 'playing' || state.phase === 'gameover' || (!lobbyOpen && state.phase === 'paused')) {
      const firstFrame = lobbyOpen;
      lobbyOpen = false;
      Object.assign(game, state);
      if (firstFrame) { audio.start(); canvas.focus({ preventScroll: true }); }
      for (const event of message.events || []) handleGameEvent(event, true);
    }
  } else if (message.type === 'pause' && network.role === 'host') {
    pauseMatch(true);
  } else if (message.type === 'room-closed' || message.type === 'disconnected' || message.type === 'error') {
    clearKeys();
    if (game.phase === 'playing') game.phase = 'paused';
    lobbyOpen = true;
    $('online-start').hidden = true;
    $('invite-box').hidden = true;
    $('online-create').hidden = network.role !== 'host';
    $('online-join').hidden = network.role !== 'guest';
    $('online-create').disabled = !onlineAvailable;
    $('online-join').disabled = !onlineAvailable;
    $('host-key-label').hidden = !hostKeyRequired || network.role !== 'host';
    if (message.type !== 'disconnected' || !onlineError) onlineMessage(message.message || 'Connection lost. Reconnect to open a new room or rejoin your friend.', true);
    if (message.code === 'invalid-host-passcode') {
      $('host-key').setAttribute('aria-invalid', 'true');
      $('host-key-details').open = true;
      $('host-key').focus();
    }
  }
  syncInterface();
}

function gameSnapshot() {
  const round = value => Math.round(value * 100) / 100;
  return {
    phase: game.phase, time: round(game.time), winner: game.winner,
    players: game.players.map(p => ({ id: p.id, x: round(p.x), y: round(p.y), angle: p.angle, speed: round(p.speed), score: p.score, alive: p.alive, respawn: round(p.respawn), invulnerable: round(p.invulnerable), boosting: p.boosting })),
    bullets: game.bullets.map(b => {
      if (!bulletIds.has(b)) bulletIds.set(b, nextBulletId++);
      return { id: bulletIds.get(b), x: round(b.x), y: round(b.y), owner: b.owner };
    }),
    particles: game.particles.slice(-50).map(p => ({ x: round(p.x), y: round(p.y), life: round(p.life), maxLife: round(p.maxLife), color: p.color, size: p.size })),
  };
}

function publishState() {
  if (network.role === 'host' && network.peerReady && !lobbyOpen) {
    if (network.send({ type: 'state', state: gameSnapshot(), events: pendingEvents })) pendingEvents = [];
  }
}

setInterval(() => {
  publishState();
  if (network.role === 'guest' && network.peerReady) network.send({ type: 'input', keys: game.phase === 'playing' && !lobbyOpen ? [...keys].filter(key => key.startsWith('Arrow')) : [] });
}, 50);

function updateSoundButton() {
  $('sound-label').textContent = audio.enabled ? 'SOUND ON' : 'SOUND OFF';
  $('sound-button').setAttribute('aria-pressed', String(audio.enabled));
  $('sound-button').setAttribute('aria-label', audio.enabled ? 'Mute sound' : 'Enable sound');
}

function clearKeys() {
  keys.clear();
  for (const cap of keycaps.values()) cap.classList.remove('pressed');
}

function startMatch() {
  if (network.role === 'guest') return;
  if (network.role === 'host' && !network.peerReady) return;
  lobbyOpen = false;
  pendingEvents = [];
  audio.unlock();
  clearKeys();
  game.reset();
  announcementUntil = 0;
  audio.start();
  syncInterface();
  canvas.focus({ preventScroll: true });
  $('screen-reader-status').textContent = 'Dogfight started. First to five hits wins.';
  publishState();
}

function pauseMatch(forcePause = false) {
  if (lobbyOpen) return;
  if (network.role === 'guest') {
    if (game.phase === 'playing') network.send({ type: 'pause' });
    clearKeys();
    return;
  }
  if (game.phase === 'playing') {
    game.phase = 'paused';
    clearKeys();
    $('screen-reader-status').textContent = 'Game paused.';
  } else if (game.phase === 'paused' && !forcePause) {
    audio.unlock();
    game.phase = 'playing';
    canvas.focus({ preventScroll: true });
    $('screen-reader-status').textContent = 'Flight resumed.';
  }
  syncInterface();
  publishState();
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('app').requestFullscreen();
  } catch {
    $('screen-reader-status').textContent = 'Fullscreen is unavailable in this browser.';
    $('toolbar-caption').textContent = 'Fullscreen is unavailable in this browser.';
  }
}

function syncInterface() {
  const phase = game.phase;
  const interfaceState = `${phase}:${lobbyOpen}:${network.role}:${network.peerReady}`;
  if (interfaceState !== lastPhase) {
    lastPhase = interfaceState;
    const active = phase === 'playing';
    const paused = phase === 'paused';
    const over = phase === 'gameover';
    $('overlay').hidden = active && !lobbyOpen;
    $('intro').hidden = phase !== 'attract' || lobbyOpen;
    $('pause-panel').hidden = !paused || lobbyOpen;
    $('win-panel').hidden = !over || lobbyOpen;
    $('online-panel').hidden = !lobbyOpen;
    $('leave-room').hidden = !network.role || lobbyOpen;
    $('mode-label').textContent = network.role ? 'PRIVATE ONLINE 1V1' : 'LOCAL + ONLINE MULTIPLAYER';
    $('resume-button').disabled = network.role === 'guest';
    $('resume-button').innerHTML = network.role === 'guest' ? 'WAITING FOR HOST TO RESUME' : '<svg><use href="#icon-play"/></svg>RESUME FLIGHT<span class="button-arrow">↗</span>';
    $('pause-panel').querySelector('.enter-hint').hidden = network.role === 'guest';
    $('rematch-button').disabled = network.role === 'guest';
    $('rematch-button').innerHTML = network.role === 'guest' ? 'WAITING FOR HOST TO FLY AGAIN' : '<svg><use href="#icon-reset"/></svg>FLY AGAIN<span class="button-arrow">↗</span>';
    $('win-panel').querySelector('.enter-hint').hidden = network.role === 'guest';
    $('match-status').textContent = { attract: 'AWAITING PILOTS', playing: 'DOGFIGHT IN PROGRESS', paused: 'HOLDING PATTERN', gameover: 'MISSION COMPLETE' }[phase];
    $('arena-status').textContent = { attract: 'READY WHEN YOU ARE', playing: 'AIRSPACE IS LIVE', paused: 'FLIGHT PAUSED', gameover: 'ACE CONFIRMED' }[phase];
    $('arena-tip').textContent = active ? 'ESC TO PAUSE' : 'NO QUARTERS REQUIRED';
    $('toolbar-caption').textContent = active ? 'Keep your rival in your sights.' : paused ? 'Your sky will be here.' : over ? 'Settle it with a rematch.' : 'A friendly rivalry. An endless sky.';
    $('pause-button').disabled = lobbyOpen || (!active && !paused) || (paused && network.role === 'guest');
    $('pause-button').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
    $('pause-button').title = paused ? 'Resume (Esc)' : 'Pause (Esc)';
    $('pause-button').querySelector('span').textContent = paused ? 'RESUME' : 'PAUSE';
    $('pause-button').querySelector('use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
    if (over && !lobbyOpen) {
      const winner = game.winner;
      $('winner-name').textContent = names[winner];
      $('winner-name').style.color = colors[winner];
      $('win-panel').querySelector('.winner-plane').style.color = colors[winner];
      $('winner-summary').textContent = `Owns the sky. ${game.players[winner].score} – ${game.players[1 - winner].score}`;
      if (network.role !== 'guest') $('rematch-button').focus({ preventScroll: true });
    }
    if (paused && !lobbyOpen && network.role !== 'guest') $('resume-button').focus({ preventScroll: true });
  }
  const scoreKey = game.players.map(player => player.score).join(':');
  if (scoreKey !== lastScores) {
    lastScores = scoreKey;
    ['one', 'two'].forEach((word, i) => {
      const score = game.players[i].score;
      $(`score-${word}`).textContent = String(score).padStart(2, '0');
      $(`score-${word}`).setAttribute('aria-label', `Player ${i + 1} score: ${score}`);
      $(`pips-${word}`).innerHTML = Array.from({ length: WIN_SCORE }, (_, point) => `<i class="${point < score ? 'filled' : ''}"></i>`).join('');
    });
  }
  const seconds = game.phase === 'attract' ? 0 : Math.floor(game.time);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (clock !== lastClock) { $('flight-time').textContent = clock; lastClock = clock; }
  $('hit-announcement').classList.toggle('visible', performance.now() < announcementUntil && phase === 'playing');
  if (network.role) $('connection-label').textContent = `YOU: P${network.role === 'host' ? '1' : '2'} / ${network.peerReady ? (network.latency === null ? 'CONNECTED' : network.latency + ' MS TO SERVER') : 'WAITING'}`;
  else $('connection-label').textContent = '02 PILOTS / 01 RIVALRY';
}

// Biplane sprite faces right. Rotation is quantized to 32 headings like a ROM sprite.
const planeBitmap = [
  '00111111110000',
  '00111111110000',
  '00001100000000',
  '11001100000010',
  '11111111111110',
  '11111111111111',
  '11001100000010',
  '00001100000000',
  '00111111110000',
  '00111111110000',
];

function drawPlane(player) {
  if (!player.alive) return;
  const blink = player.invulnerable > 0 && Math.floor(elapsed * 12) % 2 === 0;
  const x = Math.round(player.x);
  const y = Math.round(player.y);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.round(player.angle / (Math.PI / 16)) * (Math.PI / 16));
  if (player.boosting) {
    ctx.fillStyle = '#ffcf89';
    const flame = 5 + Math.floor(elapsed * 20) % 3 * 3;
    ctx.fillRect(-14 - flame, -2, flame, 4);
    ctx.fillStyle = '#fff6cc';
    ctx.fillRect(-16, -1, 5, 2);
  }
  ctx.globalAlpha = blink ? 0.35 : 1;
  ctx.fillStyle = colors[player.id];
  for (let row = 0; row < planeBitmap.length; row++) {
    for (let column = 0; column < planeBitmap[row].length; column++) {
      if (planeBitmap[row][column] === '1') ctx.fillRect(column * 2 - 14, row * 2 - 10, 2, 2);
    }
  }
  ctx.restore();
  if (game.phase === 'playing' || game.phase === 'paused') {
    ctx.fillStyle = colors[player.id];
    ctx.globalAlpha = .7;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`P${player.id + 1}`, x, y - 20);
    if (player.invulnerable > 0) {
      ctx.strokeStyle = colors[player.id]; ctx.globalAlpha = .3;
      ctx.setLineDash([3, 5]); ctx.strokeRect(x - 21, y - 16, 42, 32); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
}

function drawArena() {
  ctx.fillStyle = '#123dff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Sparse edge marks keep the sky open, with the original's low runway silhouette.
  ctx.fillStyle = '#a0b6ff40';
  for (let y = 64; y < HEIGHT - 50; y += 48) {
    ctx.fillRect(0, y, 5, 1); ctx.fillRect(WIDTH - 5, y, 5, 1);
  }
  ctx.fillStyle = '#0e31d5'; ctx.fillRect(0, HEIGHT - 34, WIDTH, 34);
  ctx.fillStyle = '#e4eaff';
  ctx.fillRect(80, HEIGHT - 35, WIDTH - 160, 2);
  ctx.fillRect(404, HEIGHT - 40, 152, 5);
  ctx.fillStyle = '#a4b8ff';
  for (let x = 24; x < WIDTH; x += 24) ctx.fillRect(x, HEIGHT - 21, 8, 1);
  ctx.fillStyle = '#ff9468';
  ctx.fillRect(73, HEIGHT - 39, 4, 6); ctx.fillRect(WIDTH - 77, HEIGHT - 39, 4, 6);
  ctx.fillStyle = '#123dff';
  ctx.fillRect(0, HEIGHT - 28, 265, 28); ctx.fillRect(WIDTH - 254, HEIGHT - 28, 254, 28);

  for (const particle of game.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife) * .75;
    ctx.fillStyle = particle.color;
    const size = particle.size || 2;
    ctx.fillRect(Math.round(particle.x - size / 2), Math.round(particle.y - size / 2), size, size);
  }
  ctx.globalAlpha = 1;
  for (const bullet of game.bullets) {
    ctx.fillStyle = colors[bullet.owner];
    ctx.fillRect(Math.round(bullet.x) - 2, Math.round(bullet.y) - 2, 4, 4);
  }
  game.players.forEach(drawPlane);
  if (game.phase === 'playing') {
    game.players.forEach(player => {
      if (player.alive) return;
      ctx.fillStyle = colors[player.id]; ctx.textAlign = 'center'; ctx.font = '9px monospace';
      ctx.fillText(`P${player.id + 1} BACK IN ${Math.ceil(player.respawn)}`, player.id === 0 ? 126 : WIDTH - 126, 53);
    });
  }
}

function frame(now) {
  const dt = Math.min((now - previousFrame) / 1000, 0.05);
  previousFrame = now;
  if (game.phase !== 'paused') elapsed += dt;
  if (network.role === 'guest' && !lobbyOpen) {
    const state = network.sample(now);
    if (state) Object.assign(game, state);
  } else if (network.role !== 'guest' && !lobbyOpen && !(reducedMotion && game.phase === 'attract')) {
    const activeKeys = network.role === 'host' ? new Set([...keys].filter(key => key.startsWith('Key'))) : keys;
    if (network.role === 'host' && now - network.lastInput < 500) for (const key of network.remoteKeys) activeKeys.add(key);
    game.tick(dt, activeKeys);
  }
  drawArena();
  syncInterface();
  requestAnimationFrame(frame);
}

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input,textarea,select')) return;
  if (flightKeys.has(event.code)) {
    event.preventDefault();
    const allowed = !network.role || (network.role === 'host' ? event.code.startsWith('Key') : event.code.startsWith('Arrow'));
    if (game.phase === 'playing' && !lobbyOpen && allowed) {
      keys.add(event.code);
      keycaps.get(event.code)?.classList.add('pressed');
    }
    return;
  }
  if (event.repeat) return;
  if (event.code === 'Enter' && !lobbyOpen && (game.phase === 'attract' || game.phase === 'gameover')) {
    event.preventDefault(); startMatch();
  } else if (event.code === 'Escape' || event.code === 'KeyP') {
    event.preventDefault(); pauseMatch();
  } else if (event.code === 'KeyM') {
    event.preventDefault(); audio.toggle();
  } else if (event.code === 'KeyF') {
    event.preventDefault(); fullscreen();
  }
});
document.addEventListener('keyup', event => {
  keys.delete(event.code);
  keycaps.get(event.code)?.classList.remove('pressed');
  if (flightKeys.has(event.code)) event.preventDefault();
});
window.addEventListener('blur', () => { clearKeys(); pauseMatch(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearKeys(); pauseMatch(true); } });
document.addEventListener('fullscreenchange', () => {
  const enabled = Boolean(document.fullscreenElement);
  $('fullscreen-button').setAttribute('aria-label', enabled ? 'Exit fullscreen' : 'Enter fullscreen');
  $('fullscreen-button').querySelector('span').textContent = enabled ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
});
$('start-button').addEventListener('click', startMatch);
$('rematch-button').addEventListener('click', startMatch);
$('resume-button').addEventListener('click', () => pauseMatch());
$('pause-button').addEventListener('click', () => pauseMatch());
$('sound-button').addEventListener('click', () => audio.toggle());
$('fullscreen-button').addEventListener('click', fullscreen);
$('online-button').addEventListener('click', openLobby);
$('online-back').addEventListener('click', leaveRoom);
$('leave-room').addEventListener('click', leaveRoom);
$('host-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('online-create').disabled && !$('online-create').hidden) connectRoom('host');
});
$('show-host-key').addEventListener('click', () => {
  const reveal = $('host-key').type === 'password';
  $('host-key').type = reveal ? 'text' : 'password';
  $('show-host-key').textContent = reveal ? 'HIDE' : 'SHOW';
  $('show-host-key').setAttribute('aria-label', reveal ? 'Hide host passcode' : 'Show host passcode');
  $('show-host-key').setAttribute('aria-pressed', String(reveal));
});
function hideHostPasscode() {
  $('host-key').type = 'password';
  $('show-host-key').textContent = 'SHOW';
  $('show-host-key').setAttribute('aria-label', 'Show host passcode');
  $('show-host-key').setAttribute('aria-pressed', 'false');
  $('host-key').setAttribute('aria-invalid', 'false');
  $('host-key-details').open = false;
}
$('online-join').addEventListener('click', () => connectRoom('guest'));
$('online-start').addEventListener('click', () => {
  if (network.role !== 'host' || !network.peerReady) return;
  if (game.phase === 'paused') { lobbyOpen = false; pauseMatch(); }
  else startMatch();
});
$('copy-invite').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('invite-link').value);
    $('copy-invite').textContent = 'COPIED!';
    setTimeout(() => { $('copy-invite').textContent = 'COPY LINK'; }, 1800);
  } catch {
    $('invite-link').focus(); $('invite-link').select();
    $('invite-note').textContent = 'Press Ctrl+C (or ⌘C) to copy the selected link.';
  }
});
fetch('/api/config').then(response => response.ok ? response.json() : null).then(config => {
  onlineAvailable = Boolean(config?.online);
  hostKeyRequired = Boolean(config?.hostKeyRequired);
  if (inviteToken || lobbyOpen) openLobby();
}).catch(() => { if (inviteToken) openLobby(); });
window.addEventListener('beforeunload', () => network.disconnect());
if (!document.fullscreenEnabled) $('fullscreen-button').hidden = true;
updateSoundButton();
syncInterface();
requestAnimationFrame(frame);
