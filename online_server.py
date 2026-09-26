"""A private, two-seat ACE relay. The host browser runs the game simulation.

Run one process / one instance: the single room lives in memory. A deployment
restart ends its match. Only explicitly listed public assets can be downloaded.
"""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import hmac
import json
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlsplit

from aiohttp import web, WSMsgType

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {"index.html", "style.css", "online.css", "game.js", "engine.js", "network.js"}
GUEST_KEYS = {"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"}


@dataclass
class Lobby:
    host: object = None
    guest: object = None
    token: str = ""
    connections: set = field(default_factory=set)


LOBBY = web.AppKey("lobby", Lobby)
HOST_KEY = web.AppKey("host_key", str)


async def send(ws, message):
    if ws is not None and not ws.closed:
        try:
            await asyncio.wait_for(ws.send_json(message), timeout=2)
        except (ConnectionError, asyncio.TimeoutError, RuntimeError):
            await ws.close()


async def asset(request):
    name = request.match_info.get("name", "index.html")
    if name not in PUBLIC_FILES:
        raise web.HTTPNotFound()
    content_types = {".html": "text/html", ".js": "application/javascript", ".css": "text/css"}
    return web.FileResponse(ROOT / name, headers={
        "Content-Type": content_types[Path(name).suffix],
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    })


async def config(request):
    return web.json_response({"online": True, "hostKeyRequired": bool(request.app[HOST_KEY])}, headers={"Cache-Control": "no-store"})


async def health(request):
    return web.json_response({"ok": True})


async def websocket(request):
    # Render terminates TLS before forwarding requests, so compare the Origin's
    # authority to Host, rather than the backend's http scheme.
    origin = request.headers.get("Origin")
    if origin:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != request.host.lower():
            raise web.HTTPForbidden(text="Use the game's own page to connect.")
    lobby = request.app[LOBBY]
    if len(lobby.connections) >= 16:
        raise web.HTTPServiceUnavailable(text="Try again shortly.")
    ws = web.WebSocketResponse(heartbeat=15, max_msg_size=65536, compress=False)
    await ws.prepare(request)
    lobby.connections.add(ws)
    role = None
    rate = deque()
    try:
        try:
            hello = await ws.receive_json(timeout=10)
        except (ValueError, TypeError, asyncio.TimeoutError):
            await send(ws, {"type": "error", "message": "Connection timed out. Try again."})
            return ws
        if not isinstance(hello, dict):
            return ws
        if hello.get("type") == "create":
            supplied = hello.get("hostKey", "")
            expected = request.app[HOST_KEY]
            if not isinstance(supplied, str) or (expected and not hmac.compare_digest(supplied.encode(), expected.encode())):
                await send(ws, {"type": "error", "message": "That host passcode is not correct."})
                return ws
            if lobby.host is not None:
                await send(ws, {"type": "error", "message": "A room is already open. Close it before creating another."})
                return ws
            role = "host"
            lobby.host = ws
            lobby.token = secrets.token_urlsafe(24)
            await send(ws, {"type": "created", "token": lobby.token})
        elif hello.get("type") == "join":
            token = hello.get("token", "")
            if not isinstance(token, str) or lobby.host is None or not hmac.compare_digest(token.encode(), lobby.token.encode()):
                await send(ws, {"type": "error", "message": "This invitation has expired. Ask your friend for a new link."})
                return ws
            if lobby.guest is not None:
                await send(ws, {"type": "error", "message": "Both seats are taken. This room is for two players only."})
                return ws
            role = "guest"
            lobby.guest = ws
            await send(ws, {"type": "joined"})
            await send(lobby.host, {"type": "peer-ready"})
        else:
            await send(ws, {"type": "error", "message": "Create a room or open an invitation to join."})
            return ws

        async for incoming in ws:
            if incoming.type != WSMsgType.TEXT:
                if incoming.type == WSMsgType.ERROR:
                    break
                continue
            now = time.monotonic()
            while rate and rate[0] < now - 1:
                rate.popleft()
            rate.append(now)
            if len(rate) > 100:
                await send(ws, {"type": "error", "message": "Connection sent too many updates. Please reconnect."})
                break
            try:
                message = json.loads(incoming.data)
            except (ValueError, TypeError):
                continue
            if not isinstance(message, dict):
                continue
            kind = message.get("type")
            if kind == "ping":
                await send(ws, {"type": "pong", "sent": message.get("sent")})
            elif role == "host" and kind == "state":
                # Guests cannot send game state or claim to be player one.
                if isinstance(message.get("state"), dict) and isinstance(message.get("events", []), list):
                    await send(lobby.guest, {"type": "state", "state": message["state"], "events": message.get("events", [])[:30]})
            elif role == "guest" and kind == "input":
                pressed = message.get("keys")
                if isinstance(pressed, list) and len(pressed) <= 4 and all(isinstance(key, str) and key in GUEST_KEYS for key in pressed):
                    await send(lobby.host, {"type": "input", "keys": list(set(pressed))})
            elif role == "guest" and kind == "pause":
                await send(lobby.host, {"type": "pause"})
            elif kind == "leave":
                break
    finally:
        lobby.connections.discard(ws)
        if role == "host" and lobby.host is ws:
            guest = lobby.guest
            lobby.host = None
            lobby.guest = None
            lobby.token = ""
            await send(guest, {"type": "room-closed", "message": "The host closed the room. Ask for a new invitation."})
            if guest is not None:
                await guest.close()
        elif role == "guest" and lobby.guest is ws:
            lobby.guest = None
            await send(lobby.host, {"type": "peer-left"})
        await ws.close()
    return ws


async def shutdown(app):
    await asyncio.gather(*(ws.close(code=1001, message=b"Server restarting") for ws in list(app[LOBBY].connections)), return_exceptions=True)


def create_app(host_key=None):
    app = web.Application(client_max_size=65536)
    app[LOBBY] = Lobby()
    app[HOST_KEY] = os.environ.get("ACE_HOST_KEY", "") if host_key is None else host_key
    if os.environ.get("RENDER") and not app[HOST_KEY]:
        raise RuntimeError("Set ACE_HOST_KEY in the Render service's Environment settings before starting.")
    app.router.add_get("/", asset)
    app.router.add_get("/api/config", config)
    app.router.add_get("/health", health)
    app.router.add_get("/ws", websocket)
    app.router.add_get("/{name}", asset)
    app.on_shutdown.append(shutdown)
    return app


if __name__ == "__main__":
    public_host = os.environ.get("HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    web.run_app(create_app(), host=public_host, port=int(os.environ.get("PORT", "8766")), access_log=None)
