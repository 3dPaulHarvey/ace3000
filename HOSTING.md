# Host ACE 3000 on Render

You need one Render web service. It serves the game page and carries the real-time connection between the two browsers. Neither player needs port forwarding, a domain name, or a static home IP address.

## Deploy the prepared setup

1. Sign into [Render](https://dashboard.render.com/).
2. Open [Deploy ACE 3000](https://render.com/deploy?repo=https://github.com/3dPaulHarvey/ace3000). If requested, connect GitHub and grant Render access to **only the private ace3000 repository**.
3. Review the blueprint: one Python web service, **Free** plan, no databases. Enter **ACE_HOST_KEY**, a private passcode you choose for creating rooms. Keep it in Render's environment settings, not in source control.
4. Deploy. Wait until the service says **Live**, then open the `onrender.com` URL shown on the service page. Save that address; it is your game's permanent front door.
5. Choose **Play a friend online**, enter the host passcode, and create a room. Copy its invitation and send it to your friend. Wait for **Your friend is here**, then start.

If the deploy link doesn't find the private repo, use Render's **New → Blueprint**, select `3dPaulHarvey/ace3000`, and use `render.yaml` from the `main` branch. Render must first be granted access to that repository.

## Manual web service settings

If you use **New → Web Service** instead of a Blueprint:

| Setting | Value |
| --- | --- |
| Repository | `3dPaulHarvey/ace3000` |
| Branch | `main` |
| Language/runtime | Python 3 |
| Build command | `pip install -r requirements.txt` |
| Start command | `python online_server.py` |
| Instance plan | Free |
| Health check | `/health` |
| Environment variable | `ACE_HOST_KEY` = your chosen host passcode |

Do not choose **Static Site**; the game needs its WebSocket server. The program uses Render's `PORT` and binds `0.0.0.0` automatically. Keep the service at one instance because the private room is in memory.

## Play

- You are Player 1: **A/D** turn, **W** boost, **S** fire.
- Your invited friend is Player 2: **left/right arrows** turn, **up** boost, **down** fire.
- Either player can pause with **Escape** or **P**. The host resumes and starts rematches.
- Keep the host game tab in front while playing. Changing tabs pauses the match.
- The first player to five hits wins. The host can start another round without sharing a new link.
- The host leaving or refreshing closes the room. Create a new invitation for the next session.

The main game address is public, but creating a room requires the host passcode and joining requires an unguessable invitation. There are exactly two seats and no room listing. Your friend does not need your host passcode or a Render account.

## Free hosting behavior

Render's free service sleeps after 15 minutes without traffic. The first visit may take about a minute while it starts. Ongoing game messages keep it active during a match. Free services can restart, which ends the current room. See [Render's free service details](https://render.com/docs/free).

## Test online mode on your computer

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe online_server.py
```

Open `http://127.0.0.1:8766/` in two browser windows. Create a room in the first and open the invitation in the second. A localhost invitation works only on your own computer; use the deployed Render site for your distant friend.

Local testing does not require a host passcode unless you set the `ACE_HOST_KEY` environment variable. On Render, configure it before starting the service.

## Troubleshooting

- **Repo not listed:** In Render's GitHub connection settings, grant its GitHub App access to `ace3000`.
- **Host passcode rejected:** Use the exact value of `ACE_HOST_KEY` from your Render service's Environment page.
- **A room is already open:** Close the previous host tab and allow several seconds for disconnect detection, then try again.
- **Invitation expired:** The host closed/refreshed or the server restarted. Create a new room and send the new invitation.
- **Both seats taken:** Close the other guest tab, then retry. Only one guest can join.
- **Waiting for host:** Player 1 needs to start or resume the match.

Official documentation: [Render deployments](https://render.com/docs/deploy-to-render), [web services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket).
