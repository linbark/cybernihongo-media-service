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

CREATE INDEX idx_audit_logs_video_created_at ON audit_logs(video_id, created_at);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
