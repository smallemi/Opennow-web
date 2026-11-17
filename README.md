<div align="center">

<img src="public/opennow-logo.png" alt="OpenNOW" width="96" />

# OpenNOW Web

**A browser-native, open-source GeForce NOW client.**

No Electron, no native streamer. Just a Node server and your browser.

</div>

---

## Table of contents

- [About](#about)
- [About this fork](#about-this-fork)
- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Private instance](#private-instance)
- [Proxy mode](#proxy-mode)
- [Production deployment](#production-deployment)
- [Development checks](#development-checks)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

---

## About

OpenNOW Web reuses the proven catalog, CloudMatch, signaling, input, and WebRTC protocol work from the desktop [OpenNOW](https://github.com/OpenCloudGaming) project.

The UI is the official OpenNOW renderer (from `opennow-stable/src/renderer/src`): the original stylesheet, assets, home and library views, settings, queue experience, stream loading screens, and in-stream controls. Only a few desktop-specific parts were removed:

- redirect-based sign-in
- native-streamer settings
- the desktop app updater

---

## About this fork

This fork ([smallemi/Opennow-web](https://github.com/smallemi/Opennow-web)) builds on the upstream [OpenCloudGaming/Opennow-web](https://github.com/OpenCloudGaming/Opennow-web) with the following changes.

### Streaming fixes

Streams used to fail with `Resume attach failed` / `signaling connection closed`, or got stuck on *"The game is ready. Waiting for the first clear frame."* Both are fixed.

| Area | Change |
| --- | --- |
| **NVIDIA signaling v3** | `sign_in` uses `version=3.0` and adds `reconnect=1` when reattaching. `peer_info` sends the v3 shape (peer role, signaling version, real resolution). Random peer names and a current Chrome user agent. |
| **Connection recovery** | A generic socket close before ICE is retried once with `reconnect=1`. Bare socket closes are treated as recoverable instead of "session ended". Server errors are surfaced instead of silently dropped. Stale bridge sockets no longer fire close events. |
| **WebRTC seat allocation** | CloudMatch requests now present a desktop Chrome identity (`BROWSER` / `WEBRTC`, platform `browser`, client `2.0.88.129`, matching OpenNOW Android). Before, the native-app identity could get an **RTSP-only seat** that never sends a WebRTC offer, which is why the stream hung on the first frame. |
| **Endpoint selection** | Signaling endpoints are picked like upstream/Android do, skipping RTSP descriptors. The server logs a warning if a ready seat only exposes RTSP endpoints. |
| **Resume requests** | Resume sends `preferredController` and the expected `metaData` / `adUpdates` fields. |

### New features

- 🔒 **[Private instance](#private-instance)**: an optional password gate, turned on with an environment variable.
- 🛰️ **[Proxy mode](#proxy-mode)**: relay streams through the server for networks that block direct streaming, with env-configurable quality limits.
- 🏷️ **Custom branding**: set the tab title and favicon with `OPENNOW_SITE_TITLE` and `OPENNOW_FAVICON_URL`.
- 📶 **Proxy-friendly streaming**: a keepalive on the signaling bridge, so Cloudflare's 100-second idle timeout no longer ends running streams.

### Housekeeping

- An expanded `.gitignore` (build output, local data, secrets, logs, OS and editor files).
- Tests for signaling, endpoint resolution, and private-instance access, plus a fix for a flaky cookie-tamper test.

---

## Features

- 🔑 **QR-code sign-in**: device authorization is the only sign-in flow, with no redirects.
- 🍪 **Encrypted, stateless sessions**
  - Each visitor's profile, NVIDIA tokens, and stream ownership are kept in AES-256-GCM encrypted, `HttpOnly` cookies. They are never exposed to page JavaScript.
  - The cookies are scoped to `/api`, use `SameSite=Strict`, and are `Secure` in production.
  - Any server instance can serve any visitor, as long as they all share `SESSION_SECRET`.
- 🎮 **Full WebRTC streaming**: video, audio, keyboard, mouse, and controller input.
- 📡 **Per-visitor latency**: region latency is measured from each visitor's browser. Unreachable regions stay selectable.
- 🛡️ **Ownership-checked signaling**: NVIDIA signaling is relayed through a same-origin WebSocket.
- 🔒 **Optional private mode**: a password gate for the whole instance.

**Not included in the web app:** Electron updates, native streaming, local recording, Discord RPC, and desktop window controls.

---

## Quick start

> Requires **Node.js 22** or newer.

```bash
git clone git@github.com:smallemi/Opennow-web.git
cd Opennow-web
npm install
npm run dev
```

Open **http://localhost:3000** and sign in with the QR code.

---

## Configuration

Settings are environment variables. Copy `.env.example` to `.env`, or pass them on the command line.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SESSION_SECRET` | In production | random per start (dev) | At least 32 random characters. All server instances must share it. Changing it signs everyone out. |
| `OPENNOW_ORIGIN` | In production | none | The exact public origin (e.g. `https://opennow.example.com`), used for WebSocket origin checks. |
| `PORT` | No | `3000` | The HTTP port. |
| `OPENNOW_INSTANCE_PASSWORD` | No | *(unset = public)* | Turns on [private mode](#private-instance) with this password. |
| `OPENNOW_INSTANCE_REMEMBER_DAYS` | No | `30` | How long a "Remember this device" unlock lasts. |
| `OPENNOW_SITE_TITLE` | No | `OpenNOW` | Text shown in the browser tab. |
| `OPENNOW_FAVICON_URL` | No | OpenNOW logo | Tab icon: a full link (`https://example.com/icon.png`) or a path on this site (`/my-icon.png`, from `public/`). |
| `OPENNOW_BLOCK_QUEUE_ADS` | No | `false` | `true` strips free-tier queue ads from NVIDIA's session responses so they are never played. Use at your own risk. |
| `OPENNOW_RELAY` | No | `off` | [Proxy mode](#proxy-mode): `optional` (visitors can turn it on) or `always`. |
| `OPENNOW_RELAY_HOST` | With proxy mode | none | Hostname for TURN. Behind Cloudflare, a DNS-only record pointing at the server. |
| `OPENNOW_RELAY_PORT` | No | `3478` | Public TCP port for TURN. |
| `OPENNOW_RELAY_TLS_CERT` / `OPENNOW_RELAY_TLS_KEY` | No | none | Certificate and key paths to serve TURN over TLS (`turns:`). |
| `OPENNOW_RELAY_IP` | No | auto-detected | The server's public IPv4, if it is behind NAT. |
| `OPENNOW_RELAY_UDP_PORTS` | No | `49152-65535` | UDP range the relay uses towards NVIDIA. |
| `OPENNOW_RELAY_MAX_RESOLUTION` | No | `1280x720` | Highest resolution for relayed streams. |
| `OPENNOW_RELAY_MAX_FPS` | No | `60` | Highest frame rate for relayed streams. |
| `OPENNOW_RELAY_MAX_BITRATE_MBPS` | No | `10` | Highest bitrate for relayed streams. |
| `OPENNOW_DATA_DIR` | No | `.opennow-data` | Where the device ID, caches, and thumbnails are stored. |

### Example `.env`

```bash
SESSION_SECRET=replace-with-at-least-32-random-characters
OPENNOW_ORIGIN=https://cloud.example.com
OPENNOW_INSTANCE_PASSWORD=your-password
OPENNOW_SITE_TITLE=Emi's Cloud
OPENNOW_FAVICON_URL=https://example.com/icon.png
```

---

## Private instance

Lock the whole instance behind a password, so only people you share it with can use it.

```bash
OPENNOW_INSTANCE_PASSWORD="your-password" npm run dev
```

Leave the variable unset or empty to keep the instance public.

### How it works

- **Password first:** visitors see a password screen before the app loads. Until they unlock, every API route and the stream connection are refused.
- **Stays unlocked:** the unlock is stored in a signed `HttpOnly` cookie, so closing and reopening the tab doesn't ask again.
  - With **"Remember this device"** ticked (the default), it lasts `OPENNOW_INSTANCE_REMEMBER_DAYS` days, even after a browser restart.
  - Unticked, it lasts until the browser is closed.
- **Survives restarts:** unlocks stay valid after a server restart. Changing the password (or `SESSION_SECRET`) logs everyone out.
- **Server-controlled:** only the server's environment can turn private mode on or off. Visitors can't lock or unlock it for anyone else.
- **Brute-force protection:** after 10 wrong passwords in 15 minutes from one IP, further attempts from it are refused until the 15 minutes are up.

> [!NOTE]
> Behind a reverse proxy, every visitor appears to come from the proxy's IP, so one person's wrong guesses can block everyone. Configure Express [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) so the real client IP is used.

---

## Proxy mode

Some networks (schools, offices, strict firewalls) block the direct UDP/TCP connection a game stream needs. Proxy mode sends the stream through your server instead: browser → TURN relay on your server → NVIDIA.

- **TURN runs on its own TCP port** (default `3478`), so nginx keeps port 443 and no existing site config changes.
- **Quality is capped** while proxying, by default 720p60 at 10 Mbps. Change it with `OPENNOW_RELAY_MAX_*`. The cap is enforced on the server as well, not just in the browser.
- **The region picker is hidden** while proxying, since the media leaves from your server anyway.
- `optional` adds a *Proxy mode* toggle in **Settings → Stream**; `always` relays every stream.
- **Chrome only for now:** works in Chrome and Chrome-based browsers (Edge, Brave, Opera). Firefox fails to connect to the relay.

Setup:

1. Add a **DNS-only** (grey cloud) record, e.g. `turn.example.com`, pointing at the server. Cloudflare's proxy only carries web traffic, so TURN can't go through it.
2. Open TCP `OPENNOW_RELAY_PORT` inbound, and UDP `OPENNOW_RELAY_UDP_PORTS` in and out.
3. Set the variables and restart:

   ```bash
   OPENNOW_RELAY=optional
   OPENNOW_RELAY_HOST=turn.example.com
   OPENNOW_RELAY_PORT=3478
   ```

4. Optional: for TURN over TLS (looks like normal HTTPS traffic to firewalls), set `OPENNOW_RELAY_TLS_CERT` and `OPENNOW_RELAY_TLS_KEY` to a certificate for that hostname (Let's Encrypt; Cloudflare origin certificates are not trusted by browsers). Using a port like `5349` or `8443` helps on networks that only allow common ports.

Every relayed stream uses the server's bandwidth twice (in from NVIDIA, out to the visitor), so 10 Mbps per player means about 20 Mbps of server traffic. The DNS-only record also reveals the server's IP address.

The relay is the [`dlpcc`](https://www.npmjs.com/package/dlpcc) TURN server (AGPL-3.0), started by OpenNOW itself; it only relays to public addresses and only accepts short-lived credentials handed to signed-in visitors.

---

## Production deployment

```bash
npm install
npm run build
NODE_ENV=production \
OPENNOW_ORIGIN=https://your-domain.example \
SESSION_SECRET=replace-with-at-least-32-random-characters \
npm start
```

<details>
<summary>PowerShell</summary>

```powershell
$env:NODE_ENV = "production"
$env:OPENNOW_ORIGIN = "https://your-domain.example"
$env:SESSION_SECRET = "replace-with-at-least-32-random-characters"
npm start
```

</details>

### Checklist

- [ ] Run behind a reverse proxy that provides **HTTPS** and forwards WebSocket upgrades for `/api/signaling`. Streaming and microphone access need HTTPS.
- [ ] Use the same strong `SESSION_SECRET` on every server instance. You don't need sticky sessions or a shared session database.
- [ ] Keep `SESSION_SECRET` (and `OPENNOW_INSTANCE_PASSWORD`) in a secret manager, never in source control.
- [ ] Set `OPENNOW_ORIGIN` to the exact public origin.
- [ ] Never expose the Vite development server publicly.

---

## Development checks

```bash
npm run typecheck   # TypeScript
npm test            # Vitest unit tests
npm run build       # Production build
```

### Load test

With the dev server running:

```bash
npm run test:load
```

Set `LOAD_TEST_REQUESTS`, `LOAD_TEST_CONCURRENCY`, or `LOAD_TEST_URL` to change its scope.

> Full login, queue, and gameplay testing needs a real NVIDIA / GeForce NOW account. Provider discovery and the QR sign-in start/cancel flow can be tested without credentials.

---

## Troubleshooting

<details>
<summary><b>Stuck on "Waiting for the first clear frame"</b></summary>

Look at the `toSessionInfo` line in the server log. If every connection is `rtsps://...` with no WebRTC entry, NVIDIA gave the session a native-only seat.

**End the session completely** (in OpenNOW or on GeForce NOW) and launch again. Resuming keeps the same seat.

</details>

<details>
<summary><b>"Resume attach failed" / signaling closed</b></summary>

Make sure you're on this fork's `main` (it includes the v3 signaling fix). Send the server log lines starting with `[Signaling]` and `[CloudMatch]` when reporting an issue.

</details>

<details>
<summary><b>Locked out of a private instance</b></summary>

After too many wrong passwords, wait 15 minutes. If everyone is locked out behind a proxy, see the `trust proxy` note in [Private instance](#private-instance).

</details>

---

## Credits

- [OpenCloudGaming / OpenNOW](https://github.com/OpenCloudGaming): the original desktop, Android, and web clients this is built on.
- This fork is maintained by [@smallemi](https://github.com/smallemi).

To pull in upstream updates:

```bash
git remote add origin https://github.com/OpenCloudGaming/Opennow-web.git  # once
git pull origin main
```

*Not affiliated with NVIDIA. GeForce NOW is a trademark of NVIDIA Corporation.*
