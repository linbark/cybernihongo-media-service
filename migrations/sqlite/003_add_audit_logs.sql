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

CREATE INDEX IF NOT EXISTS idx_audit_logs_video_created_at ON audit_logs(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
