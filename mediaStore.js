import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  buildCloudbaseInitOptions,
  CLOUDBASE_RDB_DRIVER,
  inferMediaDriver,
  summarizeCloudbaseRdbConnection,
} from './cloudbaseRdb.js';

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const normalizeString = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const normalizeTags = (value) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)));
  }
  return [];
};
const normalizeBoolean = (value) => Boolean(value);
const normalizeInteger = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
};
const normalizeNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};
const normalizeRoleList = (value) => {
  const parsed = parseJsonValue(value, value);
  if (Array.isArray(parsed)) {
    return Array.from(new Set(parsed.map((item) => normalizeString(item)).filter(Boolean)));
  }
  if (typeof parsed === 'string') {
    return Array.from(new Set(parsed.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)));
  }
  return [];
};
const normalizeJsonRecord = (value) => {
  const parsed = parseJsonValue(value, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return {};
};

const summarizeConnection = ({ driver, dbFilePath = '', databaseUrl = '' }) => {
  if (driver === 'sqlite') {
    const fileName = path.basename(dbFilePath || 'media.db');
    return `sqlite:${fileName}`;
  }
  if (!databaseUrl) return `${driver}:unconfigured`;
  try {
    const parsed = new URL(databaseUrl);
    const protocol = parsed.protocol.replace(/:$/, '') || driver;
    const host = parsed.host || 'local';
    const databaseName = parsed.pathname.replace(/^\/+/, '') || '(default)';
    return `${protocol}://${host}/${databaseName}`;
  } catch {
    return `${driver}:configured`;
  }
};

const formatCloudbaseError = (error, fallbackMessage) => {
  if (!error) return fallbackMessage;
  if (typeof error === 'string') return `${fallbackMessage}: ${error}`;
  if (error instanceof Error) return `${fallbackMessage}: ${error.message}`;

  const code = normalizeString(error.code);
  const message = normalizeString(error.message || error.msg || error.error_description || error.error);
  return [fallbackMessage, code ? `[${code}]` : '', message].filter(Boolean).join(' ');
};

const ensureCloudbaseSuccess = (result, action) => {
  if (result?.error) {
    throw new Error(formatCloudbaseError(result.error, action));
  }
  return result || {};
};

const CLOUDBASE_RDB_BOOTSTRAP_SQL_FILE = path.resolve('migrations/mysql/001_init.sql');

const ensureCloudbaseRdbSchema = async ({ cloudbase }) => {
  const runSqlRaw = cloudbase?.models?.$runSQLRaw;
  if (typeof runSqlRaw !== 'function') {
    return;
  }
  if (!fs.existsSync(CLOUDBASE_RDB_BOOTSTRAP_SQL_FILE)) {
    return;
  }

  const bootstrapSql = fs.readFileSync(CLOUDBASE_RDB_BOOTSTRAP_SQL_FILE, 'utf8').trim();
  if (!bootstrapSql) return;

  try {
    const result = await runSqlRaw(bootstrapSql);
    if (result?.error) {
      const message = formatCloudbaseError(result.error, 'CloudBase RDB 自动建表失败');
      if (!/already exists|Duplicate key name/i.test(message)) {
        throw new Error(message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|Duplicate key name/i.test(message)) {
      throw error;
    }
  }
};

const mapRowToVideo = (row) => {
  if (!row) return null;
  let tags = [];
  try {
    tags = normalizeTags(JSON.parse(row.tags_json || '[]'));
  } catch {
    tags = [];
  }
  return {
    id: row.id || '',
    title: row.title || '',
    description: row.description || '',
    provider: row.provider || '',
    language: row.language || '',
    level: row.level || '',
    tags,
    status: row.status || 'active',
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
    publishedAt: row.published_at || '',
    coverAssetId: row.cover_asset_id || '',
    sourceAssetId: row.source_asset_id || '',
    subtitleAssetId: row.subtitle_asset_id || '',
    mediaType: row.media_type || 'video',
    mediaFile: row.media_file || '',
    thumbnailFile: row.thumbnail_file || '',
    subtitleDocumentFile: row.subtitle_document_file || '',
    mediaUrl: row.media_url || '',
    downloadUrl: row.download_url || '',
    thumbnailUrl: row.thumbnail_url || '',
    subtitleDocumentUrl: row.subtitle_document_url || '',
    referenceText: row.reference_text || '',
    hasRefinedSubtitles: Boolean(row.has_refined_subtitles),
    hasTranslation: Boolean(row.has_translation),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
};

const mapVideoToParams = (video, now = new Date().toISOString()) => ({
  id: normalizeString(video.id),
  title: normalizeString(video.title),
  description: normalizeString(video.description),
  provider: normalizeString(video.provider),
  language: normalizeString(video.language),
  level: normalizeString(video.level),
  tags_json: JSON.stringify(normalizeTags(video.tags)),
  status: normalizeString(video.status, 'active'),
  duration_seconds: normalizeNumber(video.durationSeconds),
  published_at: normalizeString(video.publishedAt, now),
  cover_asset_id: normalizeString(video.coverAssetId),
  source_asset_id: normalizeString(video.sourceAssetId),
  subtitle_asset_id: normalizeString(video.subtitleAssetId),
  media_type: normalizeString(video.mediaType, 'video') === 'audio' ? 'audio' : 'video',
  media_file: normalizeString(video.mediaFile),
  thumbnail_file: normalizeString(video.thumbnailFile),
  subtitle_document_file: normalizeString(video.subtitleDocumentFile),
  media_url: normalizeString(video.mediaUrl),
  download_url: normalizeString(video.downloadUrl),
  thumbnail_url: normalizeString(video.thumbnailUrl),
  subtitle_document_url: normalizeString(video.subtitleDocumentUrl),
  reference_text: normalizeString(video.referenceText),
  has_refined_subtitles: normalizeBoolean(video.hasRefinedSubtitles),
  has_translation: normalizeBoolean(video.hasTranslation),
  created_at: normalizeString(video.createdAt, now),
  updated_at: now,
});

const mapRowToMediaAsset = (row) => {
  if (!row) return null;
  return {
    id: row.id || '',
    userId: row.user_id || '',
    purpose: row.purpose || 'video_source',
    mediaType: row.media_type || 'video',
    fileName: row.file_name || '',
    mimeType: row.mime_type || '',
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    bucket: row.bucket || '',
    objectKey: row.object_key || '',
    fileId: row.file_id || '',
    checksum: row.checksum || '',
    status: row.status || 'ready',
    source: row.source || 'manual',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
};

const mapMediaAssetToParams = (asset, now = new Date().toISOString()) => ({
  id: normalizeString(asset.id),
  user_id: normalizeString(asset.userId),
  purpose: normalizeString(asset.purpose, 'video_source'),
  media_type: normalizeString(asset.mediaType, 'video') === 'audio' ? 'audio' : 'video',
  file_name: normalizeString(asset.fileName),
  mime_type: normalizeString(asset.mimeType),
  size_bytes: normalizeInteger(asset.sizeBytes),
  bucket: normalizeString(asset.bucket),
  object_key: normalizeString(asset.objectKey),
  file_id: normalizeString(asset.fileId),
  checksum: normalizeString(asset.checksum || asset.checksumValue || asset.checksumSha256 || asset.checksum_sha256),
  status: normalizeString(asset.status, 'ready'),
  source: normalizeString(asset.source, 'manual'),
  created_at: normalizeString(asset.createdAt, now),
  updated_at: now,
});

const mapRowToUploadSession = (row) => {
  if (!row) return null;
  return {
    id: row.id || '',
    userId: row.user_id || '',
    purpose: row.purpose || 'video_source',
    mediaType: row.media_type || 'video',
    fileName: row.file_name || '',
    mimeType: row.mime_type || '',
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    bucket: row.bucket || '',
    objectKey: row.object_key || '',
    status: row.status || 'issued',
    assetId: row.asset_id || '',
    expiresAt: row.expires_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
};

const mapUploadSessionToParams = (session, now = new Date().toISOString()) => ({
  id: normalizeString(session.id),
  user_id: normalizeString(session.userId),
  purpose: normalizeString(session.purpose, 'video_source'),
  media_type: normalizeString(session.mediaType, 'video') === 'audio' ? 'audio' : 'video',
  file_name: normalizeString(session.fileName),
  mime_type: normalizeString(session.mimeType),
  size_bytes: normalizeInteger(session.sizeBytes),
  bucket: normalizeString(session.bucket),
  object_key: normalizeString(session.objectKey),
  status: normalizeString(session.status, 'issued'),
  asset_id: normalizeString(session.assetId),
  expires_at: normalizeString(session.expiresAt),
  created_at: normalizeString(session.createdAt, now),
  updated_at: now,
});

const mapRowToAuditLog = (row) => {
  if (!row) return null;
  return {
    id: row.id || '',
    videoId: row.video_id || '',
    action: row.action || '',
    actorType: row.actor_type || 'unknown',
    actorId: row.actor_id || '',
    actorEmail: row.actor_email || '',
    actorDisplayName: row.actor_display_name || '',
    actorRoles: normalizeRoleList(row.actor_roles_json),
    summary: row.summary || '',
    details: normalizeJsonRecord(row.details_json),
    createdAt: row.created_at || '',
  };
};

const mapAuditLogToParams = (entry, now = new Date().toISOString()) => ({
  id: normalizeString(entry.id),
  video_id: normalizeString(entry.videoId),
  action: normalizeString(entry.action),
  actor_type: normalizeString(entry.actorType, 'unknown'),
  actor_id: normalizeString(entry.actorId),
  actor_email: normalizeString(entry.actorEmail),
  actor_display_name: normalizeString(entry.actorDisplayName),
  actor_roles_json: JSON.stringify(normalizeRoleList(entry.actorRoles)),
  summary: normalizeString(entry.summary),
  details_json: JSON.stringify(normalizeJsonRecord(entry.details)),
  created_at: normalizeString(entry.createdAt, now),
});

const toSqliteParams = (params) => ({
  ...params,
  has_refined_subtitles: params.has_refined_subtitles ? 1 : 0,
  has_translation: params.has_translation ? 1 : 0,
});

const toCloudbaseRdbParams = (params) => ({
  ...params,
  has_refined_subtitles: params.has_refined_subtitles ? 1 : 0,
  has_translation: params.has_translation ? 1 : 0,
});

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    duration_seconds REAL NULL,
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
`;

const createSqliteStore = async ({ dbFilePath }) => {
  ensureDir(path.dirname(dbFilePath));
  const db = new DatabaseSync(dbFilePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA user_version = 1;
  `);
  db.exec(SQLITE_DDL);

  const selectVideoByIdStmt = db.prepare('SELECT * FROM videos WHERE id = ? LIMIT 1');
  const selectAssetByIdStmt = db.prepare('SELECT * FROM media_assets WHERE id = ? LIMIT 1');
  const selectAssetByObjectStmt = db.prepare('SELECT * FROM media_assets WHERE bucket = ? AND object_key = ? ORDER BY updated_at DESC LIMIT 1');
  const selectUploadSessionByIdStmt = db.prepare('SELECT * FROM upload_sessions WHERE id = ? LIMIT 1');
  const selectAuditLogByIdStmt = db.prepare('SELECT * FROM audit_logs WHERE id = ? LIMIT 1');

  const insertVideoStmt = db.prepare(`
    INSERT INTO videos (
      id, title, description, provider, language, level, tags_json, status,
      duration_seconds, published_at, cover_asset_id, source_asset_id, subtitle_asset_id, media_type,
      media_file, thumbnail_file, subtitle_document_file, media_url, download_url,
      thumbnail_url, subtitle_document_url, reference_text, has_refined_subtitles,
      has_translation, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @provider, @language, @level, @tags_json, @status,
      @duration_seconds, @published_at, @cover_asset_id, @source_asset_id, @subtitle_asset_id, @media_type,
      @media_file, @thumbnail_file, @subtitle_document_file, @media_url, @download_url,
      @thumbnail_url, @subtitle_document_url, @reference_text, @has_refined_subtitles,
      @has_translation, @created_at, @updated_at
    )
  `);
  const updateVideoStmt = db.prepare(`
    UPDATE videos SET
      title = @title,
      description = @description,
      provider = @provider,
      language = @language,
      level = @level,
      tags_json = @tags_json,
      status = @status,
      duration_seconds = @duration_seconds,
      published_at = @published_at,
      cover_asset_id = @cover_asset_id,
      source_asset_id = @source_asset_id,
      subtitle_asset_id = @subtitle_asset_id,
      media_type = @media_type,
      media_file = @media_file,
      thumbnail_file = @thumbnail_file,
      subtitle_document_file = @subtitle_document_file,
      media_url = @media_url,
      download_url = @download_url,
      thumbnail_url = @thumbnail_url,
      subtitle_document_url = @subtitle_document_url,
      reference_text = @reference_text,
      has_refined_subtitles = @has_refined_subtitles,
      has_translation = @has_translation,
      updated_at = @updated_at
    WHERE id = @id
  `);

  const insertAssetStmt = db.prepare(`
    INSERT INTO media_assets (
      id, user_id, purpose, media_type, file_name, mime_type, size_bytes,
      bucket, object_key, file_id, checksum, status, source, created_at, updated_at
    ) VALUES (
      @id, @user_id, @purpose, @media_type, @file_name, @mime_type, @size_bytes,
      @bucket, @object_key, @file_id, @checksum, @status, @source, @created_at, @updated_at
    )
  `);

  const insertUploadSessionStmt = db.prepare(`
    INSERT INTO upload_sessions (
      id, user_id, purpose, media_type, file_name, mime_type, size_bytes, bucket, object_key,
      status, asset_id, expires_at, created_at, updated_at
    ) VALUES (
      @id, @user_id, @purpose, @media_type, @file_name, @mime_type, @size_bytes, @bucket, @object_key,
      @status, @asset_id, @expires_at, @created_at, @updated_at
    )
  `);
  const updateUploadSessionStmt = db.prepare(`
    UPDATE upload_sessions SET
      user_id = @user_id,
      purpose = @purpose,
      media_type = @media_type,
      file_name = @file_name,
      mime_type = @mime_type,
      size_bytes = @size_bytes,
      bucket = @bucket,
      object_key = @object_key,
      status = @status,
      asset_id = @asset_id,
      expires_at = @expires_at,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertAuditLogStmt = db.prepare(`
    INSERT INTO audit_logs (
      id, video_id, action, actor_type, actor_id, actor_email, actor_display_name,
      actor_roles_json, summary, details_json, created_at
    ) VALUES (
      @id, @video_id, @action, @actor_type, @actor_id, @actor_email, @actor_display_name,
      @actor_roles_json, @summary, @details_json, @created_at
    )
  `);
  const deleteVideoStmt = db.prepare('DELETE FROM videos WHERE id = ?');

  return {
    driver: 'sqlite',
    connectionSummary: summarizeConnection({ driver: 'sqlite', dbFilePath }),
    async listVideos({ status = '', limit = 100, offset = 0 } = {}) {
      const normalizedLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
      const normalizedOffset = Math.max(0, Math.round(Number(offset) || 0));
      if (status) {
        const stmt = db.prepare('SELECT * FROM videos WHERE status = ? ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT ? OFFSET ?');
        return stmt.all(status, normalizedLimit, normalizedOffset).map(mapRowToVideo);
      }
      const stmt = db.prepare('SELECT * FROM videos ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT ? OFFSET ?');
      return stmt.all(normalizedLimit, normalizedOffset).map(mapRowToVideo);
    },
    async countVideos({ status = '' } = {}) {
      if (status) {
        const row = db.prepare('SELECT COUNT(*) AS count FROM videos WHERE status = ?').get(status);
        return Number(row?.count || 0);
      }
      const row = db.prepare('SELECT COUNT(*) AS count FROM videos').get();
      return Number(row?.count || 0);
    },
    async getVideoById(id) {
      return mapRowToVideo(selectVideoByIdStmt.get(id));
    },
    async createVideo(video) {
      const params = toSqliteParams(mapVideoToParams(video));
      insertVideoStmt.run(params);
      return mapRowToVideo(selectVideoByIdStmt.get(params.id));
    },
    async updateVideo(id, nextVideo) {
      const current = mapRowToVideo(selectVideoByIdStmt.get(id));
      if (!current) throw new Error('Video not found.');
      const params = toSqliteParams(mapVideoToParams({ ...current, ...nextVideo, id, createdAt: current.createdAt }));
      const { created_at, ...updateParams } = params;
      updateVideoStmt.run(updateParams);
      return mapRowToVideo(selectVideoByIdStmt.get(id));
    },
    async deleteVideo(id) {
      deleteVideoStmt.run(id);
      return true;
    },
    async createMediaAsset(asset) {
      const params = mapMediaAssetToParams(asset);
      insertAssetStmt.run(params);
      return mapRowToMediaAsset(selectAssetByIdStmt.get(params.id));
    },
    async getMediaAssetById(id) {
      return mapRowToMediaAsset(selectAssetByIdStmt.get(id));
    },
    async findMediaAssetByObjectKey(bucket, objectKey) {
      return mapRowToMediaAsset(selectAssetByObjectStmt.get(bucket, objectKey));
    },
    async createUploadSession(session) {
      const params = mapUploadSessionToParams(session);
      insertUploadSessionStmt.run(params);
      return mapRowToUploadSession(selectUploadSessionByIdStmt.get(params.id));
    },
    async getUploadSessionById(id) {
      return mapRowToUploadSession(selectUploadSessionByIdStmt.get(id));
    },
    async updateUploadSession(id, patch) {
      const current = mapRowToUploadSession(selectUploadSessionByIdStmt.get(id));
      if (!current) throw new Error('Upload session not found.');
      const params = mapUploadSessionToParams({ ...current, ...patch, id, createdAt: current.createdAt });
      const { created_at, ...updateParams } = params;
      updateUploadSessionStmt.run(updateParams);
      return mapRowToUploadSession(selectUploadSessionByIdStmt.get(id));
    },
    async listAuditLogs({ videoId = '', limit = 100, offset = 0 } = {}) {
      const normalizedLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
      const normalizedOffset = Math.max(0, Math.round(Number(offset) || 0));
      if (videoId) {
        const stmt = db.prepare('SELECT * FROM audit_logs WHERE video_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?');
        return stmt.all(videoId, normalizedLimit, normalizedOffset).map(mapRowToAuditLog);
      }
      const stmt = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?');
      return stmt.all(normalizedLimit, normalizedOffset).map(mapRowToAuditLog);
    },
    async countAuditLogs({ videoId = '' } = {}) {
      if (videoId) {
        const row = db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE video_id = ?').get(videoId);
        return Number(row?.count || 0);
      }
      const row = db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get();
      return Number(row?.count || 0);
    },
    async createAuditLog(entry) {
      const params = mapAuditLogToParams(entry);
      insertAuditLogStmt.run(params);
      return mapRowToAuditLog(selectAuditLogByIdStmt.get(params.id));
    },
    async ping() {
      db.prepare('SELECT 1 AS ok').get();
      return true;
    },
    async close() {
      db.close();
    },
  };
};

const createPostgresStore = async ({ databaseUrl }) => {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      duration_seconds DOUBLE PRECISION NULL,
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
      has_refined_subtitles BOOLEAN NOT NULL DEFAULT FALSE,
      has_translation BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT 'video_source',
      media_type TEXT NOT NULL DEFAULT 'video',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes BIGINT NULL,
      bucket TEXT NOT NULL DEFAULT '',
      object_key TEXT NOT NULL DEFAULT '',
      file_id TEXT NOT NULL DEFAULT '',
      checksum TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT 'video_source',
      media_type TEXT NOT NULL DEFAULT 'video',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes BIGINT NULL,
      bucket TEXT NOT NULL DEFAULT '',
      object_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'issued',
      asset_id TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  await pool.query(`
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
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_updated_at ON videos(updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_media_assets_object_key ON media_assets(bucket, object_key)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_media_assets_updated_at ON media_assets(updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_upload_sessions_object_key ON upload_sessions(bucket, object_key)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_upload_sessions_updated_at ON upload_sessions(updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_video_created_at ON audit_logs(video_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)');

  return {
    driver: 'postgres',
    connectionSummary: summarizeConnection({ driver: 'postgres', databaseUrl }),
    async listVideos({ status = '', limit = 100, offset = 0 } = {}) {
      const values = [];
      const clauses = [];
      if (status) {
        values.push(status);
        clauses.push(`status = $${values.length}`);
      }
      values.push(Math.max(1, Math.min(500, Math.round(Number(limit) || 100))));
      const limitIndex = values.length;
      values.push(Math.max(0, Math.round(Number(offset) || 0)));
      const offsetIndex = values.length;
      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM videos ${whereClause} ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
      return rows.map(mapRowToVideo);
    },
    async countVideos({ status = '' } = {}) {
      if (status) {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM videos WHERE status = $1', [status]);
        return Number(rows[0]?.count || 0);
      }
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM videos');
      return Number(rows[0]?.count || 0);
    },
    async getVideoById(id) {
      const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1 LIMIT 1', [id]);
      return mapRowToVideo(rows[0]);
    },
    async createVideo(video) {
      const params = mapVideoToParams(video);
      await pool.query(
        `INSERT INTO videos (
          id, title, description, provider, language, level, tags_json, status,
          duration_seconds, published_at, cover_asset_id, source_asset_id, subtitle_asset_id, media_type,
          media_file, thumbnail_file, subtitle_document_file, media_url, download_url,
          thumbnail_url, subtitle_document_url, reference_text, has_refined_subtitles,
          has_translation, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
        )`,
        [
          params.id,
          params.title,
          params.description,
          params.provider,
          params.language,
          params.level,
          params.tags_json,
          params.status,
          params.duration_seconds,
          params.published_at,
          params.cover_asset_id,
          params.source_asset_id,
          params.subtitle_asset_id,
          params.media_type,
          params.media_file,
          params.thumbnail_file,
          params.subtitle_document_file,
          params.media_url,
          params.download_url,
          params.thumbnail_url,
          params.subtitle_document_url,
          params.reference_text,
          params.has_refined_subtitles,
          params.has_translation,
          params.created_at,
          params.updated_at,
        ],
      );
      return this.getVideoById(params.id);
    },
    async updateVideo(id, nextVideo) {
      const current = await this.getVideoById(id);
      if (!current) throw new Error('Video not found.');
      const params = mapVideoToParams({ ...current, ...nextVideo, id, createdAt: current.createdAt });
      await pool.query(
        `UPDATE videos SET
          title = $2,
          description = $3,
          provider = $4,
          language = $5,
          level = $6,
          tags_json = $7,
          status = $8,
          duration_seconds = $9,
          published_at = $10,
          cover_asset_id = $11,
          source_asset_id = $12,
          subtitle_asset_id = $13,
          media_type = $14,
          media_file = $15,
          thumbnail_file = $16,
          subtitle_document_file = $17,
          media_url = $18,
          download_url = $19,
          thumbnail_url = $20,
          subtitle_document_url = $21,
          reference_text = $22,
          has_refined_subtitles = $23,
          has_translation = $24,
          updated_at = $25
        WHERE id = $1`,
        [
          params.id,
          params.title,
          params.description,
          params.provider,
          params.language,
          params.level,
          params.tags_json,
          params.status,
          params.duration_seconds,
          params.published_at,
          params.cover_asset_id,
          params.source_asset_id,
          params.subtitle_asset_id,
          params.media_type,
          params.media_file,
          params.thumbnail_file,
          params.subtitle_document_file,
          params.media_url,
          params.download_url,
          params.thumbnail_url,
          params.subtitle_document_url,
          params.reference_text,
          params.has_refined_subtitles,
          params.has_translation,
          params.updated_at,
        ],
      );
      return this.getVideoById(id);
    },
    async deleteVideo(id) {
      await pool.query('DELETE FROM videos WHERE id = $1', [id]);
      return true;
    },
    async createMediaAsset(asset) {
      const params = mapMediaAssetToParams(asset);
      await pool.query(
        `INSERT INTO media_assets (
          id, user_id, purpose, media_type, file_name, mime_type, size_bytes,
          bucket, object_key, file_id, checksum, status, source, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        )`,
        [
          params.id,
          params.user_id,
          params.purpose,
          params.media_type,
          params.file_name,
          params.mime_type,
          params.size_bytes,
          params.bucket,
          params.object_key,
          params.file_id,
          params.checksum,
          params.status,
          params.source,
          params.created_at,
          params.updated_at,
        ],
      );
      return this.getMediaAssetById(params.id);
    },
    async getMediaAssetById(id) {
      const { rows } = await pool.query('SELECT * FROM media_assets WHERE id = $1 LIMIT 1', [id]);
      return mapRowToMediaAsset(rows[0]);
    },
    async findMediaAssetByObjectKey(bucket, objectKey) {
      const { rows } = await pool.query(
        'SELECT * FROM media_assets WHERE bucket = $1 AND object_key = $2 ORDER BY updated_at DESC LIMIT 1',
        [bucket, objectKey],
      );
      return mapRowToMediaAsset(rows[0]);
    },
    async createUploadSession(session) {
      const params = mapUploadSessionToParams(session);
      await pool.query(
        `INSERT INTO upload_sessions (
          id, user_id, purpose, media_type, file_name, mime_type, size_bytes, bucket, object_key,
          status, asset_id, expires_at, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
        )`,
        [
          params.id,
          params.user_id,
          params.purpose,
          params.media_type,
          params.file_name,
          params.mime_type,
          params.size_bytes,
          params.bucket,
          params.object_key,
          params.status,
          params.asset_id,
          params.expires_at,
          params.created_at,
          params.updated_at,
        ],
      );
      return this.getUploadSessionById(params.id);
    },
    async getUploadSessionById(id) {
      const { rows } = await pool.query('SELECT * FROM upload_sessions WHERE id = $1 LIMIT 1', [id]);
      return mapRowToUploadSession(rows[0]);
    },
    async updateUploadSession(id, patch) {
      const current = await this.getUploadSessionById(id);
      if (!current) throw new Error('Upload session not found.');
      const params = mapUploadSessionToParams({ ...current, ...patch, id, createdAt: current.createdAt });
      await pool.query(
        `UPDATE upload_sessions SET
          user_id = $2,
          purpose = $3,
          media_type = $4,
          file_name = $5,
          mime_type = $6,
          size_bytes = $7,
          bucket = $8,
          object_key = $9,
          status = $10,
          asset_id = $11,
          expires_at = $12,
          updated_at = $13
        WHERE id = $1`,
        [
          params.id,
          params.user_id,
          params.purpose,
          params.media_type,
          params.file_name,
          params.mime_type,
          params.size_bytes,
          params.bucket,
          params.object_key,
          params.status,
          params.asset_id,
          params.expires_at,
          params.updated_at,
        ],
      );
      return this.getUploadSessionById(id);
    },
    async listAuditLogs({ videoId = '', limit = 100, offset = 0 } = {}) {
      const values = [];
      const clauses = [];
      if (videoId) {
        values.push(videoId);
        clauses.push(`video_id = $${values.length}`);
      }
      values.push(Math.max(1, Math.min(500, Math.round(Number(limit) || 100))));
      const limitIndex = values.length;
      values.push(Math.max(0, Math.round(Number(offset) || 0)));
      const offsetIndex = values.length;
      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
      return rows.map(mapRowToAuditLog);
    },
    async countAuditLogs({ videoId = '' } = {}) {
      if (videoId) {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM audit_logs WHERE video_id = $1', [videoId]);
        return Number(rows[0]?.count || 0);
      }
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM audit_logs');
      return Number(rows[0]?.count || 0);
    },
    async createAuditLog(entry) {
      const params = mapAuditLogToParams(entry);
      await pool.query(
        `INSERT INTO audit_logs (
          id, video_id, action, actor_type, actor_id, actor_email, actor_display_name,
          actor_roles_json, summary, details_json, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )`,
        [
          params.id,
          params.video_id,
          params.action,
          params.actor_type,
          params.actor_id,
          params.actor_email,
          params.actor_display_name,
          params.actor_roles_json,
          params.summary,
          params.details_json,
          params.created_at,
        ],
      );
      const { rows } = await pool.query('SELECT * FROM audit_logs WHERE id = $1 LIMIT 1', [params.id]);
      return mapRowToAuditLog(rows[0]);
    },
    async ping() {
      await pool.query('SELECT 1 AS ok');
      return true;
    },
    async close() {
      await pool.end();
    },
  };
};

const createMysqlStore = async ({ databaseUrl }) => {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool(databaseUrl);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id VARCHAR(191) PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      provider TEXT NOT NULL,
      language VARCHAR(64) NOT NULL,
      level VARCHAR(64) NOT NULL,
      tags_json LONGTEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      duration_seconds DOUBLE NULL,
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
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`
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
    )
  `);

  const ensureIndex = async (table, name, sql) => {
    const [rows] = await pool.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [name]);
    if (Array.isArray(rows) && rows.length > 0) return;
    await pool.query(sql);
  };

  await ensureIndex('videos', 'idx_videos_updated_at', 'CREATE INDEX idx_videos_updated_at ON videos(updated_at)');
  await ensureIndex('videos', 'idx_videos_published_at', 'CREATE INDEX idx_videos_published_at ON videos(published_at)');
  await ensureIndex('media_assets', 'idx_media_assets_object_key', 'CREATE INDEX idx_media_assets_object_key ON media_assets(bucket, object_key(255))');
  await ensureIndex('media_assets', 'idx_media_assets_updated_at', 'CREATE INDEX idx_media_assets_updated_at ON media_assets(updated_at)');
  await ensureIndex('upload_sessions', 'idx_upload_sessions_object_key', 'CREATE INDEX idx_upload_sessions_object_key ON upload_sessions(bucket, object_key(255))');
  await ensureIndex('upload_sessions', 'idx_upload_sessions_status', 'CREATE INDEX idx_upload_sessions_status ON upload_sessions(status)');
  await ensureIndex('upload_sessions', 'idx_upload_sessions_updated_at', 'CREATE INDEX idx_upload_sessions_updated_at ON upload_sessions(updated_at)');
  await ensureIndex('audit_logs', 'idx_audit_logs_video_created_at', 'CREATE INDEX idx_audit_logs_video_created_at ON audit_logs(video_id, created_at)');
  await ensureIndex('audit_logs', 'idx_audit_logs_created_at', 'CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at)');

  return {
    driver: 'mysql',
    connectionSummary: summarizeConnection({ driver: 'mysql', databaseUrl }),
    async listVideos({ status = '', limit = 100, offset = 0 } = {}) {
      const values = [];
      let where = '';
      if (status) {
        where = 'WHERE status = ?';
        values.push(status);
      }
      values.push(Math.max(1, Math.min(500, Math.round(Number(limit) || 100))));
      values.push(Math.max(0, Math.round(Number(offset) || 0)));
      const [rows] = await pool.query(
        `SELECT * FROM videos ${where} ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT ? OFFSET ?`,
        values,
      );
      return rows.map(mapRowToVideo);
    },
    async countVideos({ status = '' } = {}) {
      if (status) {
        const [rows] = await pool.query('SELECT COUNT(*) AS count FROM videos WHERE status = ?', [status]);
        return Number(rows[0]?.count || 0);
      }
      const [rows] = await pool.query('SELECT COUNT(*) AS count FROM videos');
      return Number(rows[0]?.count || 0);
    },
    async getVideoById(id) {
      const [rows] = await pool.query('SELECT * FROM videos WHERE id = ? LIMIT 1', [id]);
      return mapRowToVideo(rows[0]);
    },
    async createVideo(video) {
      const params = mapVideoToParams(video);
      await pool.query(
        `INSERT INTO videos (
          id, title, description, provider, language, level, tags_json, status, duration_seconds, published_at,
          cover_asset_id, source_asset_id, subtitle_asset_id, media_type, media_file, thumbnail_file,
          subtitle_document_file, media_url, download_url, thumbnail_url, subtitle_document_url,
          reference_text, has_refined_subtitles, has_translation, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.id,
          params.title,
          params.description,
          params.provider,
          params.language,
          params.level,
          params.tags_json,
          params.status,
          params.duration_seconds,
          params.published_at,
          params.cover_asset_id,
          params.source_asset_id,
          params.subtitle_asset_id,
          params.media_type,
          params.media_file,
          params.thumbnail_file,
          params.subtitle_document_file,
          params.media_url,
          params.download_url,
          params.thumbnail_url,
          params.subtitle_document_url,
          params.reference_text,
          params.has_refined_subtitles ? 1 : 0,
          params.has_translation ? 1 : 0,
          params.created_at,
          params.updated_at,
        ],
      );
      return this.getVideoById(params.id);
    },
    async updateVideo(id, nextVideo) {
      const current = await this.getVideoById(id);
      if (!current) throw new Error('Video not found.');
      const params = mapVideoToParams({ ...current, ...nextVideo, id, createdAt: current.createdAt });
      await pool.query(
        `UPDATE videos SET
          title = ?,
          description = ?,
          provider = ?,
          language = ?,
          level = ?,
          tags_json = ?,
          status = ?,
          duration_seconds = ?,
          published_at = ?,
          cover_asset_id = ?,
          source_asset_id = ?,
          subtitle_asset_id = ?,
          media_type = ?,
          media_file = ?,
          thumbnail_file = ?,
          subtitle_document_file = ?,
          media_url = ?,
          download_url = ?,
          thumbnail_url = ?,
          subtitle_document_url = ?,
          reference_text = ?,
          has_refined_subtitles = ?,
          has_translation = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          params.title,
          params.description,
          params.provider,
          params.language,
          params.level,
          params.tags_json,
          params.status,
          params.duration_seconds,
          params.published_at,
          params.cover_asset_id,
          params.source_asset_id,
          params.subtitle_asset_id,
          params.media_type,
          params.media_file,
          params.thumbnail_file,
          params.subtitle_document_file,
          params.media_url,
          params.download_url,
          params.thumbnail_url,
          params.subtitle_document_url,
          params.reference_text,
          params.has_refined_subtitles ? 1 : 0,
          params.has_translation ? 1 : 0,
          params.updated_at,
          id,
        ],
      );
      return this.getVideoById(id);
    },
    async deleteVideo(id) {
      await pool.query('DELETE FROM videos WHERE id = ?', [id]);
      return true;
    },
    async createMediaAsset(asset) {
      const params = mapMediaAssetToParams(asset);
      await pool.query(
        `INSERT INTO media_assets (
          id, user_id, purpose, media_type, file_name, mime_type, size_bytes, bucket, object_key,
          file_id, checksum, status, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.id,
          params.user_id,
          params.purpose,
          params.media_type,
          params.file_name,
          params.mime_type,
          params.size_bytes,
          params.bucket,
          params.object_key,
          params.file_id,
          params.checksum,
          params.status,
          params.source,
          params.created_at,
          params.updated_at,
        ],
      );
      return this.getMediaAssetById(params.id);
    },
    async getMediaAssetById(id) {
      const [rows] = await pool.query('SELECT * FROM media_assets WHERE id = ? LIMIT 1', [id]);
      return mapRowToMediaAsset(rows[0]);
    },
    async findMediaAssetByObjectKey(bucket, objectKey) {
      const [rows] = await pool.query(
        'SELECT * FROM media_assets WHERE bucket = ? AND object_key = ? ORDER BY updated_at DESC LIMIT 1',
        [bucket, objectKey],
      );
      return mapRowToMediaAsset(rows[0]);
    },
    async createUploadSession(session) {
      const params = mapUploadSessionToParams(session);
      await pool.query(
        `INSERT INTO upload_sessions (
          id, user_id, purpose, media_type, file_name, mime_type, size_bytes, bucket, object_key,
          status, asset_id, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.id,
          params.user_id,
          params.purpose,
          params.media_type,
          params.file_name,
          params.mime_type,
          params.size_bytes,
          params.bucket,
          params.object_key,
          params.status,
          params.asset_id,
          params.expires_at,
          params.created_at,
          params.updated_at,
        ],
      );
      return this.getUploadSessionById(params.id);
    },
    async getUploadSessionById(id) {
      const [rows] = await pool.query('SELECT * FROM upload_sessions WHERE id = ? LIMIT 1', [id]);
      return mapRowToUploadSession(rows[0]);
    },
    async updateUploadSession(id, patch) {
      const current = await this.getUploadSessionById(id);
      if (!current) throw new Error('Upload session not found.');
      const params = mapUploadSessionToParams({ ...current, ...patch, id, createdAt: current.createdAt });
      await pool.query(
        `UPDATE upload_sessions SET
          user_id = ?,
          purpose = ?,
          media_type = ?,
          file_name = ?,
          mime_type = ?,
          size_bytes = ?,
          bucket = ?,
          object_key = ?,
          status = ?,
          asset_id = ?,
          expires_at = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          params.user_id,
          params.purpose,
          params.media_type,
          params.file_name,
          params.mime_type,
          params.size_bytes,
          params.bucket,
          params.object_key,
          params.status,
          params.asset_id,
          params.expires_at,
          params.updated_at,
          id,
        ],
      );
      return this.getUploadSessionById(id);
    },
    async listAuditLogs({ videoId = '', limit = 100, offset = 0 } = {}) {
      const values = [];
      let where = '';
      if (videoId) {
        where = 'WHERE video_id = ?';
        values.push(videoId);
      }
      values.push(Math.max(1, Math.min(500, Math.round(Number(limit) || 100))));
      values.push(Math.max(0, Math.round(Number(offset) || 0)));
      const [rows] = await pool.query(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        values,
      );
      return rows.map(mapRowToAuditLog);
    },
    async countAuditLogs({ videoId = '' } = {}) {
      if (videoId) {
        const [rows] = await pool.query('SELECT COUNT(*) AS count FROM audit_logs WHERE video_id = ?', [videoId]);
        return Number(rows[0]?.count || 0);
      }
      const [rows] = await pool.query('SELECT COUNT(*) AS count FROM audit_logs');
      return Number(rows[0]?.count || 0);
    },
    async createAuditLog(entry) {
      const params = mapAuditLogToParams(entry);
      await pool.query(
        `INSERT INTO audit_logs (
          id, video_id, action, actor_type, actor_id, actor_email, actor_display_name,
          actor_roles_json, summary, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.id,
          params.video_id,
          params.action,
          params.actor_type,
          params.actor_id,
          params.actor_email,
          params.actor_display_name,
          params.actor_roles_json,
          params.summary,
          params.details_json,
          params.created_at,
        ],
      );
      const [rows] = await pool.query('SELECT * FROM audit_logs WHERE id = ? LIMIT 1', [params.id]);
      return mapRowToAuditLog(rows[0]);
    },
    async ping() {
      await pool.query('SELECT 1 AS ok');
      return true;
    },
    async close() {
      await pool.end();
    },
  };
};

const createCloudbaseRdbStore = async ({ envConfig }) => {
  const { initOptions, rdbConfig } = buildCloudbaseInitOptions(envConfig);
  const cloudbaseModule = await import('@cloudbase/node-sdk');
  const cloudbaseSdk =
    cloudbaseModule?.default && typeof cloudbaseModule.default.init === 'function' ? cloudbaseModule.default : cloudbaseModule;

  if (!cloudbaseSdk || typeof cloudbaseSdk.init !== 'function') {
    throw new Error('CloudBase RDB 模式缺少 @cloudbase/node-sdk 运行时。');
  }

  const cloudbase = cloudbaseSdk.init(initOptions);
  await ensureCloudbaseRdbSchema({ cloudbase });
  const mysqlClient = cloudbase.rdb({
    instance: rdbConfig.instance,
    database: rdbConfig.database,
  });
  const tableRef = (tableName) => mysqlClient.from(tableName);

  return {
    driver: CLOUDBASE_RDB_DRIVER,
    connectionSummary: summarizeCloudbaseRdbConnection(rdbConfig),
    async listVideos({ status = '', limit = 100, offset = 0 } = {}) {
      let query = tableRef(rdbConfig.videosTable)
        .select('*')
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });
      if (status) query = query.eq('status', status);
      const result = ensureCloudbaseSuccess(
        await query,
        `CloudBase RDB 查询 ${rdbConfig.videosTable} 失败`,
      );
      const rows = Array.isArray(result.data) ? result.data.map(mapRowToVideo) : [];
      const normalizedOffset = Math.max(0, Math.round(Number(offset) || 0));
      const normalizedLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
      return rows.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    },
    async countVideos({ status = '' } = {}) {
      let query = tableRef(rdbConfig.videosTable).select('id', { head: true, count: 'exact' });
      if (status) query = query.eq('status', status);
      const result = ensureCloudbaseSuccess(
        await query,
        `CloudBase RDB 统计 ${rdbConfig.videosTable} 失败`,
      );
      return Number(result.count || 0);
    },
    async getVideoById(id) {
      const result = ensureCloudbaseSuccess(
        await tableRef(rdbConfig.videosTable).select('*').eq('id', id).limit(1).maybeSingle(),
        `CloudBase RDB 查询视频 ${id} 失败`,
      );
      return mapRowToVideo(result.data);
    },
    async createVideo(video) {
      const params = toCloudbaseRdbParams(mapVideoToParams(video));
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.videosTable).insert(params),
        `CloudBase RDB 新增视频 ${params.id} 失败`,
      );
      return this.getVideoById(params.id);
    },
    async updateVideo(id, nextVideo) {
      const current = await this.getVideoById(id);
      if (!current) throw new Error('Video not found.');
      const params = toCloudbaseRdbParams(mapVideoToParams({ ...current, ...nextVideo, id, createdAt: current.createdAt }));
      const updatePayload = { ...params };
      delete updatePayload.id;
      delete updatePayload.created_at;
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.videosTable).update(updatePayload).eq('id', id),
        `CloudBase RDB 更新视频 ${id} 失败`,
      );
      return this.getVideoById(id);
    },
    async deleteVideo(id) {
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.videosTable).delete().eq('id', id),
        `CloudBase RDB 删除视频 ${id} 失败`,
      );
      return true;
    },
    async createMediaAsset(asset) {
      const params = mapMediaAssetToParams(asset);
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.assetsTable).insert(params),
        `CloudBase RDB 新增媒体资产 ${params.id} 失败`,
      );
      return this.getMediaAssetById(params.id);
    },
    async getMediaAssetById(id) {
      const result = ensureCloudbaseSuccess(
        await tableRef(rdbConfig.assetsTable).select('*').eq('id', id).limit(1).maybeSingle(),
        `CloudBase RDB 查询媒体资产 ${id} 失败`,
      );
      return mapRowToMediaAsset(result.data);
    },
    async findMediaAssetByObjectKey(bucket, objectKey) {
      const result = ensureCloudbaseSuccess(
        await tableRef(rdbConfig.assetsTable)
          .select('*')
          .eq('bucket', bucket)
          .eq('object_key', objectKey)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        `CloudBase RDB 查询媒体资产 bucket=${bucket}, key=${objectKey} 失败`,
      );
      return mapRowToMediaAsset(result.data);
    },
    async createUploadSession(session) {
      const params = mapUploadSessionToParams(session);
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.uploadSessionsTable).insert(params),
        `CloudBase RDB 新增上传会话 ${params.id} 失败`,
      );
      return this.getUploadSessionById(params.id);
    },
    async getUploadSessionById(id) {
      const result = ensureCloudbaseSuccess(
        await tableRef(rdbConfig.uploadSessionsTable).select('*').eq('id', id).limit(1).maybeSingle(),
        `CloudBase RDB 查询上传会话 ${id} 失败`,
      );
      return mapRowToUploadSession(result.data);
    },
    async updateUploadSession(id, patch) {
      const current = await this.getUploadSessionById(id);
      if (!current) throw new Error('Upload session not found.');
      const params = mapUploadSessionToParams({ ...current, ...patch, id, createdAt: current.createdAt });
      const updatePayload = { ...params };
      delete updatePayload.id;
      delete updatePayload.created_at;
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.uploadSessionsTable).update(updatePayload).eq('id', id),
        `CloudBase RDB 更新上传会话 ${id} 失败`,
      );
      return this.getUploadSessionById(id);
    },
    async listAuditLogs({ videoId = '', limit = 100, offset = 0 } = {}) {
      let query = tableRef(rdbConfig.auditLogsTable)
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (videoId) query = query.eq('video_id', videoId);
      const result = ensureCloudbaseSuccess(
        await query,
        `CloudBase RDB 查询 ${rdbConfig.auditLogsTable} 失败`,
      );
      const rows = Array.isArray(result.data) ? result.data.map(mapRowToAuditLog) : [];
      const normalizedOffset = Math.max(0, Math.round(Number(offset) || 0));
      const normalizedLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
      return rows.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    },
    async countAuditLogs({ videoId = '' } = {}) {
      let query = tableRef(rdbConfig.auditLogsTable).select('id', { head: true, count: 'exact' });
      if (videoId) query = query.eq('video_id', videoId);
      const result = ensureCloudbaseSuccess(
        await query,
        `CloudBase RDB 统计 ${rdbConfig.auditLogsTable} 失败`,
      );
      return Number(result.count || 0);
    },
    async createAuditLog(entry) {
      const params = mapAuditLogToParams(entry);
      ensureCloudbaseSuccess(
        await tableRef(rdbConfig.auditLogsTable).insert(params),
        `CloudBase RDB 新增审计日志 ${params.id} 失败`,
      );
      const result = ensureCloudbaseSuccess(
        await tableRef(rdbConfig.auditLogsTable).select('*').eq('id', params.id).limit(1).maybeSingle(),
        `CloudBase RDB 查询审计日志 ${params.id} 失败`,
      );
      return mapRowToAuditLog(result.data);
    },
    async ping() {
      await this.countVideos();
      return true;
    },
    async close() {
      return true;
    },
  };
};

export const createMediaStore = async ({ driver = '', dbFilePath = '', databaseUrl = '' }) => {
  const resolvedDriver = inferMediaDriver({ driver, databaseUrl });
  if (resolvedDriver === 'postgres') {
    if (!databaseUrl) throw new Error('Postgres 模式需要提供 MEDIA_DATABASE_URL。');
    return createPostgresStore({ databaseUrl });
  }
  if (resolvedDriver === 'mysql') {
    if (!databaseUrl) throw new Error('MySQL 模式需要提供 MEDIA_DATABASE_URL。');
    return createMysqlStore({ databaseUrl });
  }
  if (resolvedDriver === CLOUDBASE_RDB_DRIVER) {
    return createCloudbaseRdbStore({ envConfig: process.env });
  }
  const resolvedDbFilePath = dbFilePath || path.resolve('media.db');
  return createSqliteStore({ dbFilePath: resolvedDbFilePath });
};
