// One host, one guest. Only the host advances the authoritative game engine.
// Guest rendering interpolates two snapshots; it never decides scores or hits.
export class PrivateSession {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.role = null;
    this.socket = null;
    this.peerReady = false;
    this.remoteKeys = new Set();
    this.lastInput = 0;
    this.snapshots = [];
    this.lastSent = 0;
    this.latency = null;
    this.timer = null;
  }
  connect(role, credential = '') {
    this.disconnect();
    this.role = role;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;
    let receivedHello = false;
    const timeout = setTimeout(() => {
      if (this.socket === socket && !receivedHello) {
        this.onMessage({ type: 'error', message: 'The server is still waking up or unavailable. Wait a moment, then try again.' });
        socket.close();
      }
    }, 20000);
    socket.addEventListener('open', () => {
      this.send(role === 'host' ? { type: 'create', hostKey: credential } : { type: 'join', token: credential });
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      receivedHello = true;
      clearTimeout(timeout);
      if (message.type === 'created' || message.type === 'joined') {
        if (message.type === 'joined') this.peerReady = true;
        clearInterval(this.timer);
        this.timer = setInterval(() => this.send({ type: 'ping', sent: performance.now() }), 3000);
      } else if (message.type === 'peer-ready') {
        this.peerReady = true;
      } else if (message.type === 'peer-left' || message.type === 'room-closed') {
        this.peerReady = false;
        this.remoteKeys.clear();
      } else if (message.type === 'input') {
        this.remoteKeys = new Set(message.keys);
        this.lastInput = performance.now();
      } else if (message.type === 'state') {
        const previous = this.snapshots.at(-1)?.state;
        if (previous && (previous.phase !== message.state.phase || previous.time > message.state.time)) this.snapshots = [];
        this.snapshots.push({ received: performance.now(), state: message.state });
        if (this.snapshots.length > 8) this.snapshots.shift();
      } else if (message.type === 'pong') {
        this.latency = Math.max(0, Math.round(performance.now() - message.sent));
      }
      this.onMessage(message);
    });
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      if (this.socket !== socket) return;
      clearInterval(this.timer);
      this.socket = null;
      this.peerReady = false;
      this.remoteKeys.clear();
      this.onMessage({ type: 'disconnected' });
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.onMessage({ type: 'error', message: 'Could not connect. Open this game on its online server and try again.' });
    });
  }
  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 131072) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
  disconnect() {
    clearInterval(this.timer);
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'leave' }));
      socket.close();
    }
    this.role = null;
    this.peerReady = false;
    this.remoteKeys.clear();
    this.snapshots = [];
    this.lastSent = 0;
    this.latency = null;
  }
  sample(now) {
    if (!this.snapshots.length) return null;
    const target = now - 65;
    let before = this.snapshots[0];
    let after = before;
    for (const snapshot of this.snapshots) {
      after = snapshot;
      if (snapshot.received >= target) break;
      before = snapshot;
    }
    const span = after.received - before.received;
    const fraction = span > 0 ? Math.max(0, Math.min(1, (target - before.received) / span)) : 1;
    const state = after.state;
    const wrappedLerp = (a, b, range) => a + (((b - a + range * 1.5) % range) - range / 2) * fraction;
    const lerpObject = (previous, next, plane = false) => {
      if (!previous || (plane && (previous.alive !== next.alive || previous.respawn > 0))) return { ...next };
      return {
        ...next,
        x: (wrappedLerp(previous.x, next.x, 960) + 960) % 960,
        y: ((wrappedLerp(previous.y - 24, next.y - 24, 488) + 488) % 488) + 24,
        ...(plane ? { angle: wrappedLerp(previous.angle, next.angle, Math.PI * 2) } : {}),
      };
    };
    const priorBullets = new Map(before.state.bullets.map(bullet => [bullet.id, bullet]));
    return {
      ...state,
      players: state.players.map((plane, i) => lerpObject(before.state.players[i], plane, true)),
      bullets: state.bullets.map(bullet => lerpObject(priorBullets.get(bullet.id), bullet)),
    };
  }
}
