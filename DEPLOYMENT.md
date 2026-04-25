# Afterburn Deployment

Afterburn deploys as two containers behind the existing Akatsuki host nginx:

- `afterburn-web`: nginx serving the static Vite build.
- `afterburn-server`: Node/Express/Socket.IO authoritative game server.

The public origin is `https://afterburn.akatsuki.gg`.

## Runtime

No Vault secrets are required for the initial deployment.

`afterburn-server`:

```env
NODE_ENV=production
SERVE_CLIENT=0
PORT=8092
```

`afterburn-web`:

```env
APP_PORT=8093
```

## Routing

Host nginx routes:

- `/socket.io/` to `afterburn-server` on port `8092`.
- `/` to `afterburn-web` on port `8093`.

This keeps the browser on a single origin while allowing nginx to serve static assets separately from the realtime server.

## Release Flow

1. Merge the `hetzner-infra` PR so compose and nginx know about the new services.
2. Merge the app repo PR.
3. The app workflow publishes:
   - `ghcr.io/osuakatsuki/afterburn-server:latest`
   - `ghcr.io/osuakatsuki/afterburn-web:latest`
4. The app workflow then runs `docker compose pull` and `docker compose up -d` for both services.
5. Point `afterburn.akatsuki.gg` at the Hetzner server in Cloudflare.
