// Logic/DOM-adapter smoke test. This exercises the actual game module and wire
// client, but is not a substitute for a visual test in a real browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const changedGlobals = ['document', 'window', 'location', 'history', 'matchMedia', 'localStorage', 'requestAnimationFrame', 'fetch', 'WebSocket', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'];
const originals = new Map(changedGlobals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

class Element {
  constructor(id) { this.id = id; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.style = {}; this.dataset = {}; this.handlers = {}; this.children = new Map(); this.attrs = {}; this.classes = new Set(); this.classList = { add: key => this.classes.add(key), remove: key => this.classes.delete(key), toggle: (key, force) => force ? this.classes.add(key) : this.classes.delete(key) }; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, callback) { (this.handlers[key] ||= []).push(callback); }
  querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element(key)); return this.children.get(key); }
  focus() {} select() {} matches() { return false; }
  click() { assert.equal(this.disabled, false, `Button ${this.id} is enabled`); for (const callback of this.handlers.click || []) callback(); }
  submit() { for (const callback of this.handlers.submit || []) callback({ preventDefault() {} }); }
}

function setup(hash = '') {
  let clock = 1000;
  let animation;
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const caps = [...html.matchAll(/data-code="([^"]+)"/g)].map(match => Object.assign(new Element(match[1]), { dataset: { code: match[1] } }));
  const listeners = {};
  const intervals = new Map();
  let timerId = 0;
  const sockets = [];
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.handlers = {}; this.sent = []; sockets.push(this); }
    addEventListener(type, cb) { (this.handlers[type] ||= []).push(cb); }
    emit(type, data) { for (const cb of this.handlers[type] || []) cb(data); }
    open() { this.readyState = 1; this.emit('open'); }
    send(data) { this.sent.push(JSON.parse(data)); }
    receive(data) { this.emit('message', { data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const ctx = new Proxy({}, { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
  elements.get('game').getContext = () => ctx;
  const location = new URL(`http://127.0.0.1:8766/${hash}`);
  const globals = {
    document: { hidden: false, fullscreenEnabled: false, getElementById: id => { assert.ok(elements.has(id), `Element ${id} exists`); return elements.get(id); }, querySelectorAll: () => caps, addEventListener: (event, callback) => (listeners[event] ||= []).push(callback) },
    window: { addEventListener: (event, callback) => (listeners[event] ||= []).push(callback) },
    location, history: { replaceState() {} }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => 'off', setItem() {} }, requestAnimationFrame: cb => { animation = cb; },
    fetch: async () => ({ ok: true, json: async () => ({ online: true, hostKeyRequired: true }) }),
    WebSocket: Socket, performance: { now: () => clock },
    setInterval: (cb, delay) => { const id = ++timerId; intervals.set(id, { cb, delay }); return id; }, clearInterval: id => intervals.delete(id),
    setTimeout: () => ++timerId, clearTimeout() {},
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return {
    get: id => elements.get(id), sockets,
    key(code, type = 'keydown') { for (const cb of listeners[type] || []) cb({ code, repeat: false, target: new Element('body'), preventDefault() {} }); },
    frame(frames = 1) { for (let i = 0; i < frames; i++) { clock += 1000 / 60; animation(clock); } },
    transmit() { for (const timer of intervals.values()) if (timer.delay === 50) timer.cb(); },
    lastState(socket) { return socket.sent.filter(message => message.type === 'state').at(-1)?.state; },
  };
}

try {
  const host = setup();
  await import(`./game.js?hostSmoke=${Date.now()}`);
  await Promise.resolve(); await Promise.resolve();
  host.get('online-button').click();
  host.get('host-form').submit();
  assert.equal(host.sockets.length, 0, 'An empty passcode is explained without connecting');
  assert.equal(host.get('host-key').attrs['aria-invalid'], 'true');
  host.get('host-key').value = 'incorrect-code';
  host.get('host-form').submit();
  const rejectedWire = host.sockets[0];
  rejectedWire.open();
  rejectedWire.receive({ type: 'error', code: 'invalid-host-passcode', message: 'That passcode did not match.' });
  rejectedWire.close();
  assert.equal(host.get('online-create').disabled, false, 'Rejected passcode allows retry');
  assert.equal(host.get('host-key').value, 'incorrect-code', 'Entered value is retained for correction');
  assert.equal(host.get('host-key-details').open, true);
  assert.equal(host.get('online-message').textContent, 'That passcode did not match.', 'Socket close preserves useful error');
  host.get('host-key').value = 'host-code';
  host.get('host-key').type = 'password';
  host.get('show-host-key').click();
  assert.equal(host.get('host-key').type, 'text');
  host.get('show-host-key').click();
  assert.equal(host.get('host-key').type, 'password');
  host.get('host-form').submit();
  const wire = host.sockets[1];
  wire.open();
  assert.deepEqual(wire.sent[0], { type: 'create', hostKey: 'host-code' });
  wire.receive({ type: 'created', token: 'private-invitation' });
  assert.ok(host.get('invite-link').value.endsWith('#join=private-invitation'));
  assert.equal(host.get('online-start').disabled, true);
  wire.receive({ type: 'peer-ready' });
  host.get('online-start').click();
  assert.equal(host.lastState(wire).phase, 'playing');
  host.key('KeyS');
  wire.receive({ type: 'input', keys: ['ArrowDown', 'ArrowRight'] });
  host.frame(12); host.transmit();
  const flight = host.lastState(wire);
  assert.deepEqual(new Set(flight.bullets.map(b => b.owner)), new Set([0, 1]));
  assert.notEqual(flight.players[1].angle, Math.PI);
  wire.receive({ type: 'pause' });
  assert.equal(host.lastState(wire).phase, 'paused');
  const pausedTime = host.lastState(wire).time;
  host.frame(30); host.transmit();
  assert.equal(host.lastState(wire).time, pausedTime);
  host.get('resume-button').click();
  assert.equal(host.lastState(wire).phase, 'playing');
  wire.receive({ type: 'peer-left' });
  assert.equal(host.get('online-panel').hidden, false);
  assert.equal(host.get('online-start').disabled, true);
  wire.receive({ type: 'peer-ready' });
  assert.match(host.get('online-start').textContent, /RESUME/);
  host.get('online-start').click();
  assert.equal(host.lastState(wire).time, pausedTime, 'Reconnect preserves the match');
  const gameState = host.lastState(wire);
  host.get('leave-room').click();
  assert.equal(host.get('intro').hidden, false);
  host.get('start-button').click();
  host.frame(90);
  assert.equal(host.get('match-status').textContent, 'DOGFIGHT IN PROGRESS');
  host.key('Escape');
  assert.equal(host.get('pause-panel').hidden, false);

  const guest = setup('#join=private-invitation');
  await import(`./game.js?guestSmoke=${Date.now()}`);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(guest.get('online-panel').hidden, false);
  guest.get('online-join').click();
  const friendWire = guest.sockets[0];
  friendWire.open();
  assert.deepEqual(friendWire.sent[0], { type: 'join', token: 'private-invitation' });
  friendWire.receive({ type: 'joined' });
  friendWire.receive({ type: 'state', state: gameState, events: [] });
  assert.equal(guest.get('overlay').hidden, true);
  guest.key('ArrowDown'); guest.key('KeyS'); guest.transmit();
  assert.deepEqual(friendWire.sent.at(-1), { type: 'input', keys: ['ArrowDown'] });
  guest.key('Escape');
  assert.equal(friendWire.sent.at(-1).type, 'pause');
  friendWire.receive({ type: 'state', state: { ...gameState, phase: 'paused' }, events: [] });
  guest.frame(1);
  assert.equal(guest.get('resume-button').disabled, true);
  friendWire.receive({ type: 'state', state: { ...gameState, phase: 'gameover', winner: 0 }, events: [{ type: 'win', player: 0 }] });
  guest.frame(1);
  assert.equal(guest.get('win-panel').hidden, false);
  assert.equal(guest.get('rematch-button').disabled, true);
  friendWire.receive({ type: 'room-closed', message: 'Host left.' });
  assert.equal(guest.get('online-panel').hidden, false);
  assert.equal(guest.get('online-join').disabled, false);
  console.log('Passed game smoke checks: host invite/start, both pilots/fire, shared pause, reconnect/resume, local fallback, guest controls, match end and disconnect.');
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
