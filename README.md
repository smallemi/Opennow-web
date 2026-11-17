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
| `OPENNOW_DATA_DIR` | No | `.opennow-data` | Where the device ID, caches, and thumbnails are stored. |

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
