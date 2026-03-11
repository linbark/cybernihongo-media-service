# CloudBase Deployment

`cybernihongo-media-service` owns:

- upload session issuance
- media asset registration
- video catalog metadata

## Required Runtime Env

```bash
PORT=8786
MEDIA_DB_DRIVER=cloudbase_rdb
TCB_ENV_ID=<env-id>
TENCENTCLOUD_SECRET_ID=<secret-id>
TENCENTCLOUD_SECRET_KEY=<secret-key>
```

Optional:

```bash
ADMIN_TOKEN=<admin-token>
INTERNAL_TOKEN=<internal-token>
MEDIA_CLOUDBASE_DB_INSTANCE=default
MEDIA_CLOUDBASE_DATABASE=<env-id>
MEDIA_CLOUDBASE_VIDEOS_TABLE=videos
MEDIA_CLOUDBASE_ASSETS_TABLE=media_assets
MEDIA_CLOUDBASE_UPLOAD_SESSIONS_TABLE=upload_sessions
MEDIA_STORAGE_PROVIDER=cos
MEDIA_UPLOAD_MODE=direct
MEDIA_BUCKET=<bucket-name>
MEDIA_UPLOAD_KEY_PREFIX=uploads
MEDIA_UPLOAD_SESSION_TTL_SEC=1800
MEDIA_ASSET_PUBLIC_BASE_URL=https://<cdn-or-cos-public-prefix>
```

## Health Check

- `GET /health`

## Deploy

```bash
sh ./deploy/cloudbase/deploy.sh -e <env-id> -s cybernihongo-media-service --force
```

Default entrypoint:

```bash
sh ./deploy/cloudbase/start.sh
```
