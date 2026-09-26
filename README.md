# ACE 3000

A two-player arcade dogfight inspired by Ace (1976). Play on one keyboard or in a private online room with a friend. This is a contemporary recreation, not an exact emulator of the original hardware.

## Play over the internet on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/3dPaulHarvey/ace3000)

1. Open the deployment link and sign in to Render. Allow Render to access the private `3dPaulHarvey/ace3000` repository when prompted.
2. Render reads `render.yaml`. Choose a value for **ACE_HOST_KEY**, your private host passcode, and deploy. The blueprint uses one **Free** Python web service; no database or paid service is required.
3. When the service is live, open its `https://…onrender.com` address. Choose **Play a friend online**, enter your host passcode, and **Create private room**.
4. **Copy link** and send that invitation to your friend. You are **Player 1 (WASD)**; your friend opens the link and clicks **Join as Player 2 (arrow keys)**. Start when both are connected.

The invitation is for one guest. Anyone you give that exact invitation to can occupy the second seat, so share it only with your friend. There is no public room list. Leaving or refreshing the host page closes the room and invalidates its invitation. If the guest disconnects, the match pauses; they can reopen the same invitation and the host can resume. The host controls starts, rematches, and resuming; either player can pause.

Render's free service may sleep after 15 minutes without traffic and take about a minute to wake. Your two browsers must stay open during the match. Keep **one server instance**: the room is held in memory and is cleared on a server restart or deploy. A slow connection adds input delay; Player 1's browser runs the authoritative simulation and the server relays inputs/state. The guest interpolates snapshots for smoother motion.

See [HOSTING.md](HOSTING.md) for detailed setup and local online testing. Reference: [Render web services](https://render.com/docs/web-services), [free service limits](https://render.com/docs/free).

## Play

With Python 3 installed on Windows, double-click **Play Ace3000.cmd**. Your browser opens the game automatically. Keep the launcher window open while playing; press **Ctrl+C** in that window to stop the server.

Or run this command from the game folder:

```sh
python serve.py
```

The game runs at **http://127.0.0.1:8765/**. Use `python serve.py --port 8766` to choose another port, or `python serve.py --no-browser` to start without opening a tab. The server only listens on your own computer. Opening `index.html` directly will not load the game's JavaScript modules reliably; use the launcher.

Local play needs no packages, build step, or accounts. Optional online fonts have local fallbacks. Online hosting uses the single Python dependency in `requirements.txt`.

## Controls

| Action | Player 1 / Maverick | Player 2 / Bandit |
| --- | --- | --- |
| Turn left / right | **A / D** | **Left / Right arrows** |
| Boost | **W** | **Up arrow** |
| Fire | **S** | **Down arrow** |

Hold a fire key to keep shooting. Planes fly forward continuously; turning changes their heading through a full circle. Crossing an edge brings you back on the opposite side. Hits award one point, and the first pilot to **five hits** wins. A shot-down plane returns after a short delay with brief flashing invulnerability.

- **Enter:** start a match or play a rematch.
- **Escape / P:** pause or resume.
- **M:** toggle sound.
- **F:** toggle fullscreen.

The screen also has buttons for starting, pausing, sound, and fullscreen. Sound starts after your first interaction with the page.

## Engine checks

If Node.js is installed, run:

```sh
node engine.test.mjs
```

The checks cover simultaneous controls, wrapped flight, swept bullet collisions, respawn protection, shots at screen edges, and the match lifecycle.

Additional checks:

```sh
node game-smoke.test.mjs
python -m pip install -r requirements.txt
python -m unittest test_online_server -v
```

The smoke test exercises frontend match flow with a DOM adapter; it does not verify browser layout. The server tests use real WebSocket connections to check two-player room limits, passcodes, invitation lifetimes, state/control relay, reconnects, and public asset isolation.
