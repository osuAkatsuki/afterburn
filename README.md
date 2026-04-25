# Afterburn

Afterburn is a browser-based multiplayer arcade fighter jet dogfighting game. It runs as a Vite/React/Three.js client with a Node/Express/Socket.IO authoritative game server.

The live deployment target is:

https://afterburn.akatsuki.gg

## Features

- Private browser rooms with shareable room codes.
- 3D arcade jet flight with keyboard controls.
- Server-authoritative PvP state simulation.
- Guns, missiles, flares, lock-on behavior, damage, respawns, scoring, and terrain collisions.
- Static frontend deployment through nginx plus a separate realtime Socket.IO server.
- Debug performance/network overlay via `F3`.

## Controls

- `W` / `S`: pitch
- `A` / `D`: roll
- Arrow keys or `IJKL`: alternate pitch/yaw controls
- `Shift`: afterburner
- `Space`: guns
- `E`: missile
- `F`: flare
- `Tab`: scoreboard
- `F3`: debug overlay

## Local Development

Install dependencies:

```bash
npm ci
```

Run the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The server uses Vite middleware in development, so the client hot reloads while the Node server handles Socket.IO.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Production Packaging

Afterburn builds two container images:

- `ghcr.io/osuakatsuki/afterburn-web:latest`
- `ghcr.io/osuakatsuki/afterburn-server:latest`

The web container serves the static Vite build with nginx. The server container runs the authoritative game loop and Socket.IO endpoint.

In production, host nginx routes:

- `/` to `afterburn-web`
- `/socket.io/` to `afterburn-server`

No Vault secrets are required for the current deployment.

## Project Notes

This is an active prototype. See [GAPS.md](./GAPS.md) for the current gap analysis and future improvement areas.
