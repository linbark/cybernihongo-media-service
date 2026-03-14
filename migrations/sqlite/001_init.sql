CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  published_at TEXT NOT NULL DEFAULT '',
  cover_asset_id TEXT NOT NULL DEFAULT '',
  source_asset_id TEXT NOT NULL DEFAULT '',
  subtitle_asset_id TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'video',
  media_file TEXT NOT NULL DEFAULT '',
  thumbnail_file TEXT NOT NULL DEFAULT '',
  subtitle_document_file TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  download_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  subtitle_document_url TEXT NOT NULL DEFAULT '',
  reference_text TEXT NOT NULL DEFAULT '',
  has_refined_subtitles INTEGER NOT NULL DEFAULT 0,
  has_translation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT 'video_source',
  media_type TEXT NOT NULL DEFAULT 'video',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NULL,
  bucket TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL DEFAULT '',
  checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT 'video_source',
  media_type TEXT NOT NULL DEFAULT 'video',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NULL,
  bucket TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'issued',
  asset_id TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'unknown',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  actor_display_name TEXT NOT NULL DEFAULT '',
  actor_roles_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_videos_updated_at ON videos(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_object_key ON media_assets(bucket, object_key);
CREATE INDEX IF NOT EXISTS idx_media_assets_updated_at ON media_assets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_object_key ON upload_sessions(bucket, object_key);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_updated_at ON upload_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_video_created_at ON audit_logs(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
