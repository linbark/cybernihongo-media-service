CREATE TABLE IF NOT EXISTS videos (
  id VARCHAR(191) PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  provider TEXT NOT NULL,
  language VARCHAR(64) NOT NULL,
  level VARCHAR(64) NOT NULL,
  tags_json LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  published_at VARCHAR(64) NOT NULL,
  cover_asset_id VARCHAR(191) NOT NULL DEFAULT '',
  source_asset_id VARCHAR(191) NOT NULL DEFAULT '',
  subtitle_asset_id VARCHAR(191) NOT NULL DEFAULT '',
  media_type VARCHAR(16) NOT NULL,
  media_file TEXT NOT NULL,
  thumbnail_file TEXT NOT NULL,
  subtitle_document_file TEXT NOT NULL,
  media_url TEXT NOT NULL,
  download_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  subtitle_document_url TEXT NOT NULL,
  reference_text LONGTEXT NOT NULL,
  has_refined_subtitles TINYINT(1) NOT NULL DEFAULT 0,
  has_translation TINYINT(1) NOT NULL DEFAULT 0,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL DEFAULT '',
  purpose VARCHAR(64) NOT NULL DEFAULT 'video_source',
  media_type VARCHAR(16) NOT NULL DEFAULT 'video',
  file_name TEXT NOT NULL,
  mime_type VARCHAR(191) NOT NULL DEFAULT '',
  size_bytes BIGINT NULL,
  bucket VARCHAR(191) NOT NULL DEFAULT '',
  object_key TEXT NOT NULL,
  file_id TEXT NOT NULL,
  checksum VARCHAR(191) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  source VARCHAR(64) NOT NULL DEFAULT 'manual',
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL DEFAULT '',
  purpose VARCHAR(64) NOT NULL DEFAULT 'video_source',
  media_type VARCHAR(16) NOT NULL DEFAULT 'video',
  file_name TEXT NOT NULL,
  mime_type VARCHAR(191) NOT NULL DEFAULT '',
  size_bytes BIGINT NULL,
  bucket VARCHAR(191) NOT NULL DEFAULT '',
  object_key TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'issued',
  asset_id VARCHAR(191) NOT NULL DEFAULT '',
  expires_at VARCHAR(64) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(191) PRIMARY KEY,
  video_id VARCHAR(191) NOT NULL DEFAULT '',
  action VARCHAR(191) NOT NULL DEFAULT '',
  actor_type VARCHAR(64) NOT NULL DEFAULT 'unknown',
  actor_id VARCHAR(191) NOT NULL DEFAULT '',
  actor_email VARCHAR(191) NOT NULL DEFAULT '',
  actor_display_name VARCHAR(191) NOT NULL DEFAULT '',
  actor_roles_json LONGTEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json LONGTEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL
);

CREATE INDEX idx_videos_updated_at ON videos(updated_at);
CREATE INDEX idx_videos_published_at ON videos(published_at);
CREATE INDEX idx_media_assets_object_key ON media_assets(bucket, object_key(255));
CREATE INDEX idx_media_assets_updated_at ON media_assets(updated_at);
CREATE INDEX idx_upload_sessions_object_key ON upload_sessions(bucket, object_key(255));
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX idx_upload_sessions_updated_at ON upload_sessions(updated_at);
CREATE INDEX idx_audit_logs_video_created_at ON audit_logs(video_id, created_at);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
