# cybernihongo-media-service

Dedicated media ownership service for the next-stage CyberNihongo architecture.

Current scope:

- issue upload sessions with backend-controlled object keys
- confirm upload and register durable `media_asset` records
- own `videos` catalog metadata
- expose internal source/subtitle attachment APIs for task orchestration

## Local Run

```bash
./install.sh
./start.sh
```

Default URL: `http://127.0.0.1:8786`

## Core Environment

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

## API Baseline

- `POST /upload-sessions`
- `POST /upload-sessions/:id/confirm`
- `GET /videos`
- `GET /videos/:id`
- `GET /admin/videos`
- `POST /admin/videos`
- `PUT /admin/videos/:id`
- `GET /internal/videos/:id/source`
- `POST /internal/videos/:id/subtitle-asset`

Compatibility aliases:

- `/api/videos`
- `/api/videos/:id`
- `/api/upload-sessions`
- `/api/upload-sessions/:id/confirm`

## Migration Bootstrap

```bash
npm run migrate
```

For `cloudbase_rdb`, SQL migrations are manual. Execute `migrations/mysql/001_init.sql` in CloudBase MySQL first.
