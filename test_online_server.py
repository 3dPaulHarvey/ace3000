import asyncio
import unittest
from unittest.mock import patch

from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer
from online_server import create_app


class OnlineGameTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = TestClient(TestServer(create_app(host_key="test-host-passcode")))
        await self.client.start_server()
        self.sockets = []

    async def asyncTearDown(self):
        for socket in self.sockets:
            await socket.close()
        await self.client.close()

    async def connect(self, hello):
        socket = await self.client.ws_connect('/ws')
        self.sockets.append(socket)
        await socket.send_json(hello)
        return socket, await socket.receive_json(timeout=2)

    async def pair(self):
        host, created = await self.connect({"type": "create", "hostKey": "test-host-passcode"})
        self.assertEqual(created["type"], "created")
        guest, joined = await self.connect({"type": "join", "token": created["token"]})
        self.assertEqual(joined["type"], "joined")
        self.assertEqual((await host.receive_json(timeout=2))["type"], "peer-ready")
        return host, guest, created["token"]

    async def test_host_passcode_and_invalid_invitation(self):
        _, reply = await self.connect({"type": "create", "hostKey": "wrong"})
        self.assertEqual(reply["type"], "error")
        _, reply = await self.connect({"type": "join", "token": "unknown"})
        self.assertEqual(reply["type"], "error")
        response = await self.client.get('/api/config')
        self.assertTrue((await response.json())["hostKeyRequired"])

    async def test_render_deployment_requires_a_host_passcode(self):
        with patch.dict('os.environ', {"RENDER": "true", "ACE_HOST_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "ACE_HOST_KEY"):
                create_app()

    async def test_one_host_and_exactly_one_friend(self):
        _, _, token = await self.pair()
        _, reply = await self.connect({"type": "join", "token": token})
        self.assertIn("two players", reply["message"])
        _, reply = await self.connect({"type": "create", "hostKey": "test-host-passcode"})
        self.assertIn("already open", reply["message"])

    async def test_controls_state_pause_and_ping_cross_the_connection(self):
        host, guest, _ = await self.pair()
        await guest.send_json({"type": "input", "keys": ["ArrowUp", "ArrowDown"]})
        message = await host.receive_json(timeout=2)
        self.assertEqual(message["type"], "input")
        self.assertEqual(set(message["keys"]), {"ArrowUp", "ArrowDown"})
        snapshot = {"phase": "playing", "players": [{"score": 2}, {"score": 1}]}
        await host.send_json({"type": "state", "state": snapshot, "events": [{"type": "hit", "attacker": 0}]})
        message = await guest.receive_json(timeout=2)
        self.assertEqual(message["state"], snapshot)
        self.assertEqual(message["events"][0]["attacker"], 0)
        await guest.send_json({"type": "pause"})
        self.assertEqual((await host.receive_json(timeout=2))["type"], "pause")
        await guest.send_json({"type": "ping", "sent": 123})
        self.assertEqual(await guest.receive_json(timeout=2), {"type": "pong", "sent": 123})

    async def test_guest_cannot_control_player_one_or_send_authoritative_state(self):
        host, guest, _ = await self.pair()
        await guest.send_json({"type": "input", "keys": ["KeyS"]})
        await guest.send_json({"type": "state", "state": {"winner": 1}})
        await guest.send_json({"type": "pause"})
        # A pause marker proves both invalid packets were consumed and ignored.
        self.assertEqual(await host.receive_json(timeout=2), {"type": "pause"})

    async def test_friend_can_rejoin_and_host_leave_invalidates_invite(self):
        host, guest, token = await self.pair()
        await guest.close()
        self.assertEqual((await host.receive_json(timeout=2))["type"], "peer-left")
        guest2, reply = await self.connect({"type": "join", "token": token})
        self.assertEqual(reply["type"], "joined")
        self.assertEqual((await host.receive_json(timeout=2))["type"], "peer-ready")
        await host.close()
        self.assertEqual((await guest2.receive_json(timeout=2))["type"], "room-closed")
        _, reply = await self.connect({"type": "join", "token": token})
        self.assertEqual(reply["type"], "error")

    async def test_only_public_assets_are_downloadable(self):
        for path in ['/', '/game.js', '/network.js', '/style.css', '/online.css', '/engine.js']:
            async with self.client.get(path) as response:
                self.assertEqual(response.status, 200, path)
        for path in ['/online_server.py', '/.env', '/requirements.txt', '/.git/config']:
            async with self.client.get(path) as response:
                self.assertEqual(response.status, 404, path)
        with self.assertRaises(WSServerHandshakeError):
            await self.client.ws_connect('/ws', headers={"Origin": "https://other-site.example"})


if __name__ == '__main__':
    unittest.main(verbosity=2)
