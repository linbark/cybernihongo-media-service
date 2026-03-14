# cybernihongo-media-service

Dedicated media ownership service for the current CyberNihongo split architecture.

Current scope:

- own `videos`, `media_assets`, and `upload_sessions`
- provide public catalog and media read APIs
- provide admin catalog editing and local file upload APIs
- provide internal source lookup and subtitle attachment APIs for `task-service` / workers
- serve a built-in admin UI from `/admin`

When that admin UI is opened through `cybernihongo-bff`, the page can also call proxied `auth-service` user-management routes under `/admin/users`.
Direct `media-service` access still keeps video/media management working, but user management will show as unavailable.
Admin UI now has two explicit modes:

- through `cybernihongo-bff /admin`: use session login, do not enter `Admin Token`
- direct `media-service /admin`: use `Admin Token` only when `ADMIN_TOKEN` is enabled on the service

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
When `SESSION_PROXY_TOKEN` is set, BFF may proxy session-backed admin traffic with `X-Session-Proxy-Token` plus forwarded actor headers instead of the direct admin token.

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
- `SESSION_PROXY_TOKEN`, optional dedicated token for BFF session-backed admin proxy calls
- `INTERNAL_TOKEN`, optional for internal endpoints
- `MEDIA_DB_DRIVER`: `sqlite` / `postgres` / `mysql` / `cloudbase_rdb`
- `MEDIA_DB_FILE`, SQLite path
- `MEDIA_DATABASE_URL`, Postgres/MySQL URL
- `MEDIA_BUCKET`, object storage bucket name
- `MEDIA_UPLOAD_KEY_PREFIX`, default `uploads`
- `MEDIA_UPLOAD_SESSION_TTL_SEC`, default `1800`
- `MEDIA_DOWNLOAD_URL_TTL_SEC`, default `1800`
- `MEDIA_ASSET_PUBLIC_BASE_URL`, optional CDN/COS public prefix
- `MEDIA_UPLOAD_MODE`, `direct` or `presigned_put`
- `MEDIA_COS_REGION`, COS region for presigned upload issuance
- `MEDIA_COS_DOMAIN`, optional custom COS upload domain for signed URLs
- `MEDIA_COS_PROTOCOL`, optional upload URL protocol, default `https`
- `MEDIA_COS_SECRET_ID` / `MEDIA_COS_SECRET_KEY`, optional overrides for COS signing; defaults to `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`
- `MEDIA_COS_SESSION_TOKEN`, optional session token override; also accepts `TENCENTCLOUD_SESSION_TOKEN` / `TCB_SESSION_TOKEN`

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

When `MEDIA_UPLOAD_MODE=presigned_put`, `POST /upload-sessions` returns a one-time presigned COS `PUT` URL plus any required request headers. The client must upload to that URL first, then call the returned `confirm_url`.

Important:

- browser direct upload requires COS bucket CORS to allow your web origin
- if the bucket or custom upload domain does not return the correct CORS headers for `OPTIONS` and `PUT`, browser upload will fail before `confirm`
- private object download does not require public read if clients download through `media-service /media/:id/download`

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
- `GET /internal/assets/:id/download`
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

Presigned upload example:

```bash
MEDIA_STORAGE_PROVIDER=cos \
MEDIA_UPLOAD_MODE=presigned_put \
MEDIA_BUCKET=test-1250000000 \
MEDIA_COS_REGION=ap-shanghai \
TENCENTCLOUD_SECRET_ID=xxxx \
TENCENTCLOUD_SECRET_KEY=xxxx \
node server.js

curl -X POST http://127.0.0.1:8786/upload-sessions \
  -H 'Content-Type: application/json' \
  --data '{"fileName":"lesson.mp4","mimeType":"video/mp4","purpose":"video_source"}'
```

The response includes:

- backend-controlled `object_key`
- presigned `upload.url`
- upload `method`
- required `headers`
- `confirm_url` to finalize asset registration
