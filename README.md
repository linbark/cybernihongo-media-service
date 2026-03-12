# cybernihongo-media-service

Dedicated media ownership service for the current CyberNihongo split architecture.

Current scope:

- own `videos`, `media_assets`, and `upload_sessions`
- provide public catalog and media read APIs
- provide admin catalog editing and local file upload APIs
- provide internal source lookup and subtitle attachment APIs for `task-service` / workers
- serve a built-in admin UI from `/admin`

This service is now the default media backend for local and split deployments. `cloud-video-service` is no longer the primary implementation.

## Local Run

```bash
./install.sh
./start.sh
```

Default URLs:

- service: `http://127.0.0.1:8786`
- admin UI: `http://127.0.0.1:8786/admin`
- admin config: `http://127.0.0.1:8786/admin/config`

If `ADMIN_TOKEN` is set, admin APIs require `Authorization: Bearer <token>` or `X-Admin-Token`.

## Storage And Database

Supported metadata backends:

- `sqlite`
- `postgres`
- `mysql`
- `cloudbase_rdb`

For local SQLite runtime this repository now uses built-in `node:sqlite` instead of `better-sqlite3`.

Reason:

- local Node `v23.x` runtime on this machine hangs with `better-sqlite3`
- `node:sqlite` works without native rebuilds and is now the recommended local default

## Core Environment

- `HOST`, default `0.0.0.0`
- `PORT`, default `8786`
- `ADMIN_TOKEN`, optional for admin endpoints
- `INTERNAL_TOKEN`, optional for internal endpoints
- `MEDIA_DB_DRIVER`: `sqlite` / `postgres` / `mysql` / `cloudbase_rdb`
- `MEDIA_DB_FILE`, SQLite path
- `MEDIA_DATABASE_URL`, Postgres/MySQL URL
- `MEDIA_BUCKET`, object storage bucket name
- `MEDIA_UPLOAD_KEY_PREFIX`, default `uploads`
- `MEDIA_UPLOAD_SESSION_TTL_SEC`, default `1800`
- `MEDIA_ASSET_PUBLIC_BASE_URL`, optional CDN/COS public prefix

CloudBase RDB:

- `TCB_ENV_ID` / `CLOUDBASE_ENV_ID`
- `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`
- `MEDIA_CLOUDBASE_DB_INSTANCE`, default `default`
- `MEDIA_CLOUDBASE_DATABASE`
- `MEDIA_CLOUDBASE_VIDEOS_TABLE`, default `videos`
- `MEDIA_CLOUDBASE_ASSETS_TABLE`, default `media_assets`
- `MEDIA_CLOUDBASE_UPLOAD_SESSIONS_TABLE`, default `upload_sessions`

## Public APIs

- `GET /`
- `GET /health`
- `GET /videos`
- `GET /catalog`
- `GET /api/videos`
- `GET /api/catalog`
- `GET /videos/:id`
- `GET /api/videos/:id`
- `GET /videos/:id/subtitle-document`
- `GET /media/:id/stream`
- `GET /media/:id/download`
- `GET /media/:id/thumbnail`
- `POST /upload-sessions`
- `POST /api/upload-sessions`
- `POST /upload-sessions/:id/confirm`
- `POST /api/upload-sessions/:id/confirm`

## Admin APIs

- `GET /admin`
- `GET /admin/config`
- `GET /admin/videos`
- `GET /admin/videos/:id`
- `POST /admin/videos`
- `PUT /admin/videos/:id`
- `DELETE /admin/videos/:id?deleteFiles=1`
- `PUT /admin/videos/:id/media`
- `PUT /admin/videos/:id/thumbnail`
- `PUT /admin/videos/:id/subtitle-document`

Typical admin flow:

1. `POST /admin/videos`
2. `PUT /admin/videos/:id/media`
3. `PUT /admin/videos/:id/thumbnail` if needed
4. `PUT /admin/videos/:id/subtitle-document` if needed
5. `DELETE /admin/videos/:id?deleteFiles=1` for full cleanup

## Internal APIs

- `GET /internal/videos/:id/source`
- `POST /internal/videos/:id/subtitle-asset`

## Migration Bootstrap

```bash
npm run migrate
```

Examples:

```bash
MEDIA_DB_DRIVER=sqlite MEDIA_DB_FILE=./data/media.db npm run migrate
MEDIA_DB_DRIVER=postgres MEDIA_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/media npm run migrate
MEDIA_DB_DRIVER=mysql MEDIA_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/media npm run migrate
```

For `cloudbase_rdb`, run the SQL in `migrations/mysql/` manually before first production use.

## Local Smoke Example

```bash
curl http://127.0.0.1:8786/health
curl http://127.0.0.1:8786/admin/config
```

Create, upload, read, and delete:

```bash
curl -X POST http://127.0.0.1:8786/admin/videos \
  -H 'Content-Type: application/json' \
  --data '{"id":"demo-video","title":"Demo Video","provider":"local","language":"ja-JP","mediaType":"video"}'

printf '{"segments":[]}' | curl -X PUT http://127.0.0.1:8786/admin/videos/demo-video/subtitle-document \
  -H 'Content-Type: application/json' \
  -H 'X-Filename: demo.json' \
  --data-binary @-

printf 'fake-media-binary' | curl -X PUT http://127.0.0.1:8786/admin/videos/demo-video/media \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: demo.mp4' \
  --data-binary @-

curl http://127.0.0.1:8786/videos/demo-video
curl http://127.0.0.1:8786/videos/demo-video/subtitle-document
curl http://127.0.0.1:8786/media/demo-video/stream
curl -X DELETE 'http://127.0.0.1:8786/admin/videos/demo-video?deleteFiles=1'
```
