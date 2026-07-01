# Bestdori Mirror Sync

This project should not rely on browser-side direct requests to `bestdori.com`: the Bestdori API and asset responses do not currently include CORS headers that allow this site to read them. If you want to abandon reverse proxying, mirror the required files onto your own server and serve them as static files.

## Runtime paths

The frontend always reads from the local mirror path:

- `/mirror/bestdori-api/*` serves mirrored API JSON.
- `/mirror/bestdori-assets/*` serves mirrored asset files.

For local development and `pnpm preview`, Vite serves the repository's `mirror/` directory at `/mirror/`. For production, configure your web server to expose the generated mirror directory at `/mirror/`.

The TypeScript sync script mirrors the API and asset structure used by the app:

- `/api/characters/all.2.json`
- `/api/explorer/jp/assets/_info.json`
- `/api/costumes/all.5.json`
- `/api/cards/all.5.json`
- `/assets/jp/live2d/chara/{modelName}_rip/buildData.asset`
- every model, physics, texture, motion, transition, and expression file referenced by `buildData.asset`'s `Base`
- costume thumbnails used by the UI
- normal and trained card images used by the UI

## Commands

Install and build the app dependencies first:

```bash
pnpm install
```

Run a small validation sync:

```bash
pnpm sync:bestdori -- --out=mirror --limit=3
```

Run a dry run:

```bash
pnpm sync:bestdori -- --out=mirror --limit=3 --dry-run
```

Run the full mirror:

```bash
pnpm sync:bestdori -- --out=mirror --scope=all --concurrency=8
```

Sync only selected models:

```bash
pnpm sync:bestdori -- --out=mirror --scope=live2d --models=001_casual,002_casual
```

## Nginx shape

Serve the Vite build from one directory and the mirror from another:

```nginx
server {
  listen 80;
  server_name example.com;

  root /var/www/bestdori-live2d/dist;

  location /mirror/bestdori-api/ {
    alias /srv/bestdori-mirror/bestdori-api/;
    add_header Cache-Control "no-cache";
    try_files $uri =404;
  }

  location = /mirror/manifest.json {
    alias /srv/bestdori-mirror/manifest.json;
    add_header Cache-Control "no-cache";
    try_files $uri =404;
  }

  location /mirror/ {
    alias /srv/bestdori-mirror/;
    add_header Cache-Control "public, max-age=2592000";
    try_files $uri =404;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

## Cron

Use `flock` so a slow sync does not overlap the next run:

```cron
17 */6 * * * cd /var/www/bestdori-live2d && flock -n /tmp/bestdori-sync.lock pnpm sync:bestdori -- --out=/srv/bestdori-mirror --scope=all --concurrency=8 >> /var/log/bestdori-sync.log 2>&1
```

## Deployment notes

- Runtime requests are fixed in `src/config.ts` to `/mirror/bestdori-api` and `/mirror/bestdori-assets`.
- `pnpm dev` and `pnpm preview` both serve the local `mirror/` directory at `/mirror/`.
- Start with `--limit=3`, open the site, preview one synced model, and download one ZIP before running the full mirror.
- After a full sync, check disk usage with `du -sh /srv/bestdori-mirror`.
