import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createCosUploadSigner } from './cosUploadSigner.js';
import { createMediaStore } from './mediaStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const execFileAsync = promisify(execFile);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8786);
const SERVICE_NAME = 'cybernihongo-media-service';
const VERSION = 2;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '') || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || '';
const SESSION_PROXY_TOKEN = process.env.SESSION_PROXY_TOKEN?.trim() || '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN?.trim() || '';
const MEDIA_DB_DRIVER = process.env.MEDIA_DB_DRIVER?.trim() || process.env.CATALOG_DB_DRIVER?.trim() || '';
const MEDIA_DB_FILE = process.env.MEDIA_DB_FILE?.trim() || process.env.CATALOG_DB_FILE?.trim() || path.join(__dirname, 'data', 'media.db');
const MEDIA_DATABASE_URL = process.env.MEDIA_DATABASE_URL?.trim() || process.env.CATALOG_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || '';
const MEDIA_STORAGE_PROVIDER = process.env.MEDIA_STORAGE_PROVIDER?.trim() || 'cos';
const MEDIA_UPLOAD_MODE = process.env.MEDIA_UPLOAD_MODE?.trim() || 'direct';
const MEDIA_BUCKET = process.env.MEDIA_BUCKET?.trim() || '';
const MEDIA_UPLOAD_KEY_PREFIX = process.env.MEDIA_UPLOAD_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, '') || 'uploads';
const MEDIA_UPLOAD_SESSION_TTL_SEC = Math.max(60, Number(process.env.MEDIA_UPLOAD_SESSION_TTL_SEC || 1800));
const MEDIA_DOWNLOAD_URL_TTL_SEC = Math.max(60, Number(process.env.MEDIA_DOWNLOAD_URL_TTL_SEC || 1800));
const MEDIA_ASSET_PUBLIC_BASE_URL = process.env.MEDIA_ASSET_PUBLIC_BASE_URL?.trim().replace(/\/$/, '') || '';
const MEDIA_COS_REGION = process.env.MEDIA_COS_REGION?.trim()
  || process.env.COS_REGION?.trim()
  || process.env.TENCENTCLOUD_REGION?.trim()
  || '';
const MEDIA_COS_DOMAIN = process.env.MEDIA_COS_DOMAIN?.trim() || '';
const MEDIA_COS_PROTOCOL = process.env.MEDIA_COS_PROTOCOL?.trim() || 'https';
const MEDIA_COS_SECRET_ID = process.env.MEDIA_COS_SECRET_ID?.trim() || process.env.TENCENTCLOUD_SECRET_ID?.trim() || '';
const MEDIA_COS_SECRET_KEY = process.env.MEDIA_COS_SECRET_KEY?.trim() || process.env.TENCENTCLOUD_SECRET_KEY?.trim() || '';
const MEDIA_COS_SESSION_TOKEN = process.env.MEDIA_COS_SESSION_TOKEN?.trim()
  || process.env.TENCENTCLOUD_SESSION_TOKEN?.trim()
  || process.env.TCB_SESSION_TOKEN?.trim()
  || '';
const STORAGE_MODE = process.env.STORAGE_MODE?.trim() === 'external' ? 'external' : 'local';
const EXTERNAL_MEDIA_BASE_URL = process.env.EXTERNAL_MEDIA_BASE_URL?.trim().replace(/\/$/, '') || '';
const EXTERNAL_THUMBNAIL_BASE_URL = process.env.EXTERNAL_THUMBNAIL_BASE_URL?.trim().replace(/\/$/, '') || '';
const EXTERNAL_SUBTITLE_BASE_URL = process.env.EXTERNAL_SUBTITLE_BASE_URL?.trim().replace(/\/$/, '') || '';
const ALLOW_LOCAL_UPLOADS = process.env.ALLOW_LOCAL_UPLOADS
  ? ['1', 'true', 'yes', 'on'].includes(process.env.ALLOW_LOCAL_UPLOADS.trim().toLowerCase())
  : STORAGE_MODE === 'local';
const MAX_MEDIA_UPLOAD_MB = Number(process.env.MAX_MEDIA_UPLOAD_MB || 512);
const MAX_SUBTITLE_UPLOAD_MB = Number(process.env.MAX_SUBTITLE_UPLOAD_MB || 8);
const FFPROBE_BIN = process.env.FFPROBE_BIN?.trim() || 'ffprobe';
const TCB_ENV_ID = process.env.TCB_ENV_ID?.trim() || process.env.CLOUDBASE_ENV_ID?.trim() || '';

const DATA_DIR = path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const THUMBNAIL_DIR = path.join(DATA_DIR, 'thumbnails');
const SUBTITLE_DIR = path.join(DATA_DIR, 'subtitles');
const ADMIN_DIR = path.join(__dirname, 'admin');

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
[DATA_DIR, MEDIA_DIR, THUMBNAIL_DIR, SUBTITLE_DIR, ADMIN_DIR].forEach(ensureDir);

const mediaStore = await createMediaStore({
  driver: MEDIA_DB_DRIVER,
  dbFilePath: MEDIA_DB_FILE,
  databaseUrl: MEDIA_DATABASE_URL,
});
const MEDIA_BACKEND = mediaStore.driver;
const cosUploadSigner = createCosUploadSigner({
  secretId: MEDIA_COS_SECRET_ID,
  secretKey: MEDIA_COS_SECRET_KEY,
  sessionToken: MEDIA_COS_SESSION_TOKEN,
  region: MEDIA_COS_REGION,
  protocol: MEDIA_COS_PROTOCOL,
  domain: MEDIA_COS_DOMAIN,
});

const jsonParser = express.json({ limit: '2mb' });
const rawMediaParser = express.raw({ type: '*/*', limit: `${MAX_MEDIA_UPLOAD_MB}mb` });
const textParser = express.text({ type: '*/*', limit: `${MAX_SUBTITLE_UPLOAD_MB}mb` });

const normalizeString = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const coerceBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) return false;
  }
  return fallback;
};
const coerceNumber = (value, fallback) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};
const coerceTags = (value, fallback = []) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)));
  }
  return fallback;
};
const coerceRoleList = (value, fallback = []) => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((item) => normalizeString(item)).filter(Boolean)));
      }
    } catch {
      return Array.from(new Set(text.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)));
    }
    return fallback;
  }
  return fallback;
};
const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const sanitizeFileName = (value) =>
  String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const inferMediaTypeFromFileName = (fileName) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(fileName) ? 'audio' : 'video';
const buildObjectKey = ({ fileName = '' }) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const safeName = sanitizeFileName(fileName || 'media.bin') || 'media.bin';
  return `${MEDIA_UPLOAD_KEY_PREFIX}/${today}/${randomUUID()}-${safeName}`;
};
const resolveExistingFile = (directory, fileName) => {
  const cleanFileName = sanitizeFileName(fileName);
  if (!cleanFileName) return '';
  const filePath = path.join(directory, cleanFileName);
  return fs.existsSync(filePath) ? filePath : '';
};
const resolveUploadFileName = (id, headerFileName, defaultExtension) => {
  const cleanHeader = sanitizeFileName(headerFileName);
  if (cleanHeader) {
    const ext = path.extname(cleanHeader);
    return ext ? `${id}${ext.toLowerCase()}` : `${id}${defaultExtension}`;
  }
  return `${id}${defaultExtension}`;
};
const writeBinaryFile = (directory, fileName, buffer) => {
  ensureDir(directory);
  const targetPath = path.join(directory, fileName);
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
};
const extractUploadDisplayTitle = (value) => {
  const rawName = normalizeString(value);
  if (!rawName) return '';
  const baseName = rawName.split(/[\\/]/).pop() || '';
  return path.parse(baseName).name.trim();
};
const shouldReplaceTitleFromUpload = (item, uploadedTitle) => {
  if (!uploadedTitle) return false;
  const currentTitle = normalizeString(item?.title);
  const currentId = normalizeString(item?.id);
  return !currentTitle || currentTitle === currentId;
};
const getBaseUrl = (req) => PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};
const withErrorHandling = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};
const buildCloudFileId = ({ bucket = '', objectKey = '' }) => {
  if (!bucket || !objectKey || !TCB_ENV_ID) return '';
  return `cloud://${TCB_ENV_ID}.${bucket}/${objectKey}`;
};
const buildUploadInstruction = async ({
  bucket = '',
  objectKey = '',
  mimeType = '',
  expiresAt = '',
  sessionId = '',
  req,
}) => {
  const confirmUrl = `${getBaseUrl(req)}/upload-sessions/${encodeURIComponent(sessionId)}/confirm`;
  const fileId = buildCloudFileId({ bucket, objectKey });
  const uploadBase = {
    provider: MEDIA_STORAGE_PROVIDER,
    mode: MEDIA_UPLOAD_MODE,
    bucket: bucket || undefined,
    object_key: objectKey,
    file_id: fileId || undefined,
    expires_at: expiresAt || undefined,
    confirm_url: confirmUrl,
  };

  if (MEDIA_UPLOAD_MODE === 'presigned_put') {
    if (MEDIA_STORAGE_PROVIDER !== 'cos') {
      throw createHttpError(503, `MEDIA_UPLOAD_MODE=${MEDIA_UPLOAD_MODE} currently requires MEDIA_STORAGE_PROVIDER=cos.`);
    }
    if (!bucket) {
      throw createHttpError(503, 'MEDIA_BUCKET is required for presigned COS uploads.');
    }
    if (!cosUploadSigner.configured) {
      throw createHttpError(503, 'COS presigned upload is not configured. Set MEDIA_COS_REGION and COS credentials first.');
    }

    const expiresInSec = Math.max(
      60,
      expiresAt ? Math.round((Date.parse(expiresAt) - Date.now()) / 1000) : MEDIA_UPLOAD_SESSION_TTL_SEC,
    );
    const signedUpload = await cosUploadSigner.createPresignedPut({
      bucket,
      objectKey,
      expiresInSec,
      contentType: mimeType,
    });
    return {
      ...uploadBase,
      method: signedUpload.method,
      url: signedUpload.url,
      headers: signedUpload.headers,
      note: 'Upload the object with the provided presigned PUT URL, then call confirm.',
    };
  }

  return {
    ...uploadBase,
    note: 'This endpoint issues backend-controlled object keys. Upload the object, then call confirm.',
  };
};
const buildPublicAssetUrl = (objectKey) => {
  if (!MEDIA_ASSET_PUBLIC_BASE_URL || !objectKey) return '';
  try {
    return new URL(objectKey, `${MEDIA_ASSET_PUBLIC_BASE_URL}/`).toString();
  } catch {
    return `${MEDIA_ASSET_PUBLIC_BASE_URL}/${objectKey}`;
  }
};
const buildAbsoluteUrl = (value, req) => {
  if (!value) return '';
  try {
    return new URL(value, `${getBaseUrl(req)}/`).toString();
  } catch {
    return value;
  }
};
const buildExternalAssetUrl = (baseUrl, fileName, req) => {
  if (!baseUrl || !fileName) return '';
  try {
    return new URL(fileName, `${baseUrl}/`).toString();
  } catch {
    return buildAbsoluteUrl(`${baseUrl}/${fileName}`, req);
  }
};

let hasLoggedMissingDurationProbe = false;
const probeMediaDurationSeconds = async (mediaPath) => {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        mediaPath,
      ],
      { timeout: 15000 },
    );
    const parsed = Number(String(stdout || '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Number(parsed.toFixed(3));
  } catch (error) {
    if (!hasLoggedMissingDurationProbe && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      hasLoggedMissingDurationProbe = true;
      console.warn(`[${SERVICE_NAME}] ffprobe not found, skip auto duration detection. Set FFPROBE_BIN or install ffmpeg.`);
      return undefined;
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    console.warn(`[${SERVICE_NAME}] Failed to detect media duration for ${mediaPath}:`, error instanceof Error ? error.message : error);
    return undefined;
  }
};

const subtitleSummaryFromDocument = (document) => {
  const segments = Array.isArray(document?.segments) ? document.segments : [];
  const referenceText = typeof document?.referenceText === 'string'
    ? document.referenceText.trim()
    : segments
        .map((segment) => (typeof segment?.text === 'string' ? segment.text.trim() : ''))
        .filter(Boolean)
        .join('\n');
  const hasTranslation = segments.some((segment) => {
    if (typeof segment?.translation === 'string' && segment.translation.trim()) return true;
    return Array.isArray(segment?.tokens) && segment.tokens.some((token) => typeof token?.translation === 'string' && token.translation.trim());
  });
  return {
    hasRefinedSubtitles: segments.length > 0,
    hasTranslation,
    referenceText,
  };
};

const requireAdmin = (req, res, next) => {
  if (!ADMIN_TOKEN && !SESSION_PROXY_TOKEN) {
    next();
    return;
  }
  const token = req.header('x-admin-token') || String(req.query.token || '').trim();
  if (token === ADMIN_TOKEN) {
    next();
    return;
  }
  const sessionProxyToken = req.header('x-session-proxy-token') || '';
  const hasActorContext = Boolean(
    normalizeString(req.header('x-auth-user-id'))
    || normalizeString(req.header('x-auth-user-email'))
    || normalizeString(req.header('x-auth-user-display-name'))
    || coerceRoleList(req.header('x-auth-user-roles')).length > 0
  );
  if (SESSION_PROXY_TOKEN && sessionProxyToken === SESSION_PROXY_TOKEN && hasActorContext) {
    next();
    return;
  }
  res.status(401).json({ message: 'Unauthorized admin request.' });
};

const requireInternal = (req, res, next) => {
  const accepted = [INTERNAL_TOKEN, ADMIN_TOKEN].filter(Boolean);
  if (accepted.length === 0) {
    next();
    return;
  }
  const token = req.header('x-internal-token') || req.header('x-admin-token') || String(req.query.token || '').trim();
  if (accepted.includes(token)) {
    next();
    return;
  }
  res.status(401).json({ message: 'Unauthorized internal request.' });
};

const assertUploadsEnabled = () => {
  if (!ALLOW_LOCAL_UPLOADS) {
    throw createHttpError(409, '当前服务已配置为外部存储模式，已禁用本地文件上传。请改为在元数据中填写对象存储/COS 公网 URL。');
  }
};

const normalizeVideoPayload = (payload, existing = null) => {
  const resolvedId = slugify(payload.id || existing?.id || payload.title || 'video');
  if (!resolvedId) {
    throw createHttpError(400, 'Video id is required.');
  }

  return {
    id: resolvedId,
    title: normalizeString(payload.title, existing?.title || resolvedId),
    description: normalizeString(payload.description, existing?.description || ''),
    provider: normalizeString(payload.provider, existing?.provider || SERVICE_NAME),
    language: normalizeString(payload.language, existing?.language || 'ja-JP'),
    level: normalizeString(payload.level, existing?.level || ''),
    tags: coerceTags(payload.tags, existing?.tags || []),
    status: normalizeString(payload.status, existing?.status || 'active'),
    durationSeconds: coerceNumber(payload.durationSeconds ?? payload.duration_seconds, existing?.durationSeconds ?? null),
    publishedAt: normalizeString(payload.publishedAt || payload.published_at, existing?.publishedAt || new Date().toISOString()),
    coverAssetId: normalizeString(payload.coverAssetId || payload.cover_asset_id, existing?.coverAssetId || ''),
    sourceAssetId: normalizeString(payload.sourceAssetId || payload.source_asset_id, existing?.sourceAssetId || ''),
    subtitleAssetId: normalizeString(payload.subtitleAssetId || payload.subtitle_asset_id, existing?.subtitleAssetId || ''),
    mediaType: normalizeString(payload.mediaType || payload.media_type, existing?.mediaType || 'video') === 'audio' ? 'audio' : 'video',
    mediaFile: normalizeString(payload.mediaFile || payload.media_file, existing?.mediaFile || ''),
    thumbnailFile: normalizeString(payload.thumbnailFile || payload.thumbnail_file, existing?.thumbnailFile || ''),
    subtitleDocumentFile: normalizeString(payload.subtitleDocumentFile || payload.subtitle_document_file, existing?.subtitleDocumentFile || ''),
    mediaUrl: normalizeString(payload.mediaUrl || payload.media_url, existing?.mediaUrl || ''),
    downloadUrl: normalizeString(payload.downloadUrl || payload.download_url, existing?.downloadUrl || ''),
    thumbnailUrl: normalizeString(payload.thumbnailUrl || payload.thumbnail_url, existing?.thumbnailUrl || ''),
    subtitleDocumentUrl: normalizeString(payload.subtitleDocumentUrl || payload.subtitle_document_url, existing?.subtitleDocumentUrl || ''),
    referenceText: normalizeString(payload.referenceText || payload.reference_text, existing?.referenceText || ''),
    hasRefinedSubtitles: coerceBoolean(payload.hasRefinedSubtitles ?? payload.has_refined_subtitles, existing?.hasRefinedSubtitles || false),
    hasTranslation: coerceBoolean(payload.hasTranslation ?? payload.has_translation, existing?.hasTranslation || false),
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt,
  };
};

const resolvePublishedAssetUrls = async (req, item) => {
  const baseUrl = getBaseUrl(req);
  const localMediaPath = resolveExistingFile(MEDIA_DIR, item.mediaFile);
  const localThumbnailPath = resolveExistingFile(THUMBNAIL_DIR, item.thumbnailFile);
  const localSubtitlePath = resolveExistingFile(SUBTITLE_DIR, item.subtitleDocumentFile);
  const [sourceAsset, subtitleAsset] = await Promise.all([
    item.sourceAssetId ? mediaStore.getMediaAssetById(item.sourceAssetId) : null,
    item.subtitleAssetId ? mediaStore.getMediaAssetById(item.subtitleAssetId) : null,
  ]);

  const sourceObjectUrl = sourceAsset?.objectKey ? buildPublicAssetUrl(sourceAsset.objectKey) : '';
  const subtitleObjectUrl = subtitleAsset?.objectKey ? buildPublicAssetUrl(subtitleAsset.objectKey) : '';
  const mediaUrl = buildAbsoluteUrl(item.mediaUrl, req)
    || (localMediaPath ? `${baseUrl}/media/${encodeURIComponent(item.id)}/stream` : '')
    || sourceObjectUrl
    || buildExternalAssetUrl(EXTERNAL_MEDIA_BASE_URL, item.mediaFile, req);
  const downloadUrl = buildAbsoluteUrl(item.downloadUrl, req)
    || (localMediaPath ? `${baseUrl}/media/${encodeURIComponent(item.id)}/download` : '')
    || (sourceAsset?.objectKey ? `${baseUrl}/media/${encodeURIComponent(item.id)}/download` : '')
    || mediaUrl
    || sourceObjectUrl
    || buildExternalAssetUrl(EXTERNAL_MEDIA_BASE_URL, item.mediaFile, req);
  const thumbnailUrl = buildAbsoluteUrl(item.thumbnailUrl, req)
    || (localThumbnailPath ? `${baseUrl}/media/${encodeURIComponent(item.id)}/thumbnail` : '')
    || buildExternalAssetUrl(EXTERNAL_THUMBNAIL_BASE_URL, item.thumbnailFile, req);
  const subtitleDocumentUrl = buildAbsoluteUrl(item.subtitleDocumentUrl, req)
    || (localSubtitlePath ? `${baseUrl}/videos/${encodeURIComponent(item.id)}/subtitle-document` : '')
    || subtitleObjectUrl
    || buildExternalAssetUrl(EXTERNAL_SUBTITLE_BASE_URL, item.subtitleDocumentFile, req);

  return {
    mediaUrl,
    downloadUrl,
    thumbnailUrl,
    subtitleDocumentUrl,
    mediaFileExists: Boolean(localMediaPath),
    thumbnailFileExists: Boolean(localThumbnailPath),
    subtitleDocumentExists: Boolean(localSubtitlePath),
    sourceAsset,
    subtitleAsset,
  };
};

const buildPublicCatalogItem = async (req, item) => {
  const published = await resolvePublishedAssetUrls(req, item);
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    provider: item.provider,
    language: item.language,
    level: item.level,
    tags: item.tags || [],
    status: item.status || 'active',
    duration_seconds: item.durationSeconds ?? undefined,
    published_at: item.publishedAt,
    media_type: item.mediaType || 'video',
    media_url: published.mediaUrl,
    download_url: published.downloadUrl,
    thumbnail_url: published.thumbnailUrl,
    subtitle_document_url: published.subtitleDocumentUrl,
    reference_text: item.referenceText || '',
    has_refined_subtitles: Boolean(item.hasRefinedSubtitles),
    has_translation: Boolean(item.hasTranslation),
    source_asset_id: item.sourceAssetId || '',
    subtitle_asset_id: item.subtitleAssetId || '',
    links: {
      self: `${getBaseUrl(req)}/videos/${encodeURIComponent(item.id)}`,
      admin: `${getBaseUrl(req)}/admin/videos/${encodeURIComponent(item.id)}`,
    },
  };
};

const buildAdminCatalogItem = async (req, item) => {
  const published = await resolvePublishedAssetUrls(req, item);
  return {
    ...item,
    ...published,
    public: await buildPublicCatalogItem(req, item),
  };
};

const AUDITABLE_VIDEO_FIELDS = [
  'title',
  'description',
  'provider',
  'language',
  'level',
  'tags',
  'status',
  'durationSeconds',
  'publishedAt',
  'sourceAssetId',
  'subtitleAssetId',
  'mediaType',
  'mediaFile',
  'thumbnailFile',
  'subtitleDocumentFile',
  'mediaUrl',
  'downloadUrl',
  'thumbnailUrl',
  'subtitleDocumentUrl',
  'referenceText',
  'hasRefinedSubtitles',
  'hasTranslation',
];

const listChangedVideoFields = (before = {}, after = {}) =>
  AUDITABLE_VIDEO_FIELDS.filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));

const getRequestActor = (req) => {
  const actorId = normalizeString(req.header('x-auth-user-id'));
  const actorEmail = normalizeString(req.header('x-auth-user-email'));
  const actorDisplayName = normalizeString(req.header('x-auth-user-display-name'));
  const actorRoles = coerceRoleList(req.header('x-auth-user-roles'));
  if (actorId || actorEmail || actorDisplayName || actorRoles.length > 0) {
    return {
      actorType: 'session_user',
      actorId,
      actorEmail,
      actorDisplayName,
      actorRoles,
    };
  }

  const adminToken = normalizeString(req.header('x-admin-token'));
  if (adminToken && ADMIN_TOKEN && adminToken === ADMIN_TOKEN) {
    return {
      actorType: 'admin_token',
      actorId: '',
      actorEmail: '',
      actorDisplayName: 'Direct admin token',
      actorRoles: ['admin_token'],
    };
  }

  return {
    actorType: 'unknown',
    actorId: '',
    actorEmail: '',
    actorDisplayName: '',
    actorRoles: [],
  };
};

const writeAuditLog = async (req, { action, videoId = '', summary = '', details = {} }) => {
  await mediaStore.createAuditLog({
    id: randomUUID(),
    videoId,
    action,
    ...getRequestActor(req),
    summary,
    details,
    createdAt: new Date().toISOString(),
  });
};

const maybeRedirectToExternalAsset = (req, res, publishedUrl) => {
  if (!publishedUrl) {
    res.status(404).json({ message: 'Asset not found.' });
    return true;
  }
  const selfUrl = `${getBaseUrl(req)}${req.originalUrl}`;
  if (publishedUrl === selfUrl) {
    res.status(404).json({ message: 'Asset not found.' });
    return true;
  }
  res.redirect(302, publishedUrl);
  return true;
};

const streamMediaAssetDownload = async (req, res, asset, fallbackFileName = '') => {
  if (!asset) {
    throw createHttpError(404, 'Media asset not found.');
  }

  if (asset.bucket && asset.objectKey && cosUploadSigner.configured) {
    const signedDownload = await cosUploadSigner.createPresignedGet({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
      expiresInSec: MEDIA_DOWNLOAD_URL_TTL_SEC,
    });
    const upstream = await fetch(signedDownload.url);
    if (!upstream.ok) {
      throw createHttpError(upstream.status || 502, `Upstream asset download failed (${upstream.status}).`);
    }

    const contentType = upstream.headers.get('content-type') || asset.mimeType || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const downloadName = sanitizeFileName(asset.fileName || fallbackFileName || `${asset.id}.bin`) || `${asset.id}.bin`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    if (!upstream.body) {
      res.status(204).end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }

  const publishedUrl =
    buildPublicAssetUrl(asset.objectKey || '')
    || normalizeString(asset.objectKey)
    || normalizeString(asset.fileId);
  maybeRedirectToExternalAsset(req, res, publishedUrl);
};

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, X-Filename, X-Admin-Token, X-Internal-Token');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/admin/config', withErrorHandling(async (_req, res) => {
  res.json({
    service: SERVICE_NAME,
    version: VERSION,
    adminProtected: Boolean(ADMIN_TOKEN || SESSION_PROXY_TOKEN),
    directAdminProtected: Boolean(ADMIN_TOKEN),
    sessionProxyProtected: Boolean(SESSION_PROXY_TOKEN),
    internalProtected: Boolean(INTERNAL_TOKEN || ADMIN_TOKEN),
    storageMode: STORAGE_MODE,
    allowLocalUploads: ALLOW_LOCAL_UPLOADS,
    mediaBackend: MEDIA_BACKEND,
    mediaConnection: mediaStore.connectionSummary,
    mediaStorageProvider: MEDIA_STORAGE_PROVIDER,
    mediaUploadMode: MEDIA_UPLOAD_MODE,
    cosUploadSigning: cosUploadSigner.summary,
    maxMediaUploadMb: MAX_MEDIA_UPLOAD_MB,
    maxSubtitleUploadMb: MAX_SUBTITLE_UPLOAD_MB,
    mediaBucket: MEDIA_BUCKET || undefined,
    mediaAssetPublicBaseUrl: MEDIA_ASSET_PUBLIC_BASE_URL || undefined,
    externalMediaBaseUrl: EXTERNAL_MEDIA_BASE_URL || undefined,
    externalThumbnailBaseUrl: EXTERNAL_THUMBNAIL_BASE_URL || undefined,
    externalSubtitleBaseUrl: EXTERNAL_SUBTITLE_BASE_URL || undefined,
  });
}));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'index.html'));
});
app.use('/admin', express.static(ADMIN_DIR));

app.get('/', (_req, res) => {
  res.redirect('/admin');
});

app.get('/health', withErrorHandling(async (_req, res) => {
  let healthy = true;
  let errorMessage = '';
  let videoCount = null;

  try {
    await mediaStore.ping();
    videoCount = await mediaStore.countVideos();
  } catch (error) {
    healthy = false;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: SERVICE_NAME,
    version: VERSION,
    mediaBackend: MEDIA_BACKEND,
    mediaConnection: mediaStore.connectionSummary,
    storageMode: STORAGE_MODE,
    allowLocalUploads: ALLOW_LOCAL_UPLOADS,
    storage: {
      provider: MEDIA_STORAGE_PROVIDER,
      mode: MEDIA_UPLOAD_MODE,
      bucket: MEDIA_BUCKET || undefined,
      cosUploadSigning: cosUploadSigner.summary,
      publicBaseUrl: MEDIA_ASSET_PUBLIC_BASE_URL || undefined,
      envId: TCB_ENV_ID || undefined,
    },
    videos: {
      count: videoCount,
    },
    adminProtected: Boolean(ADMIN_TOKEN || SESSION_PROXY_TOKEN),
    directAdminProtected: Boolean(ADMIN_TOKEN),
    sessionProxyProtected: Boolean(SESSION_PROXY_TOKEN),
    internalProtected: Boolean(INTERNAL_TOKEN || ADMIN_TOKEN),
    error: healthy ? undefined : errorMessage,
    now: new Date().toISOString(),
  });
}));

app.get(['/videos', '/api/videos', '/catalog', '/api/catalog', '/videos.json', '/catalog.json', '/index.json'], withErrorHandling(async (req, res) => {
  const filters = {
    status: normalizeString(req.query.status),
    limit: Math.max(1, Math.min(500, Math.round(coerceNumber(req.query.limit, 100)))),
    offset: Math.max(0, Math.round(coerceNumber(req.query.offset, 0))),
  };

  const [items, total] = await Promise.all([
    mediaStore.listVideos(filters),
    mediaStore.countVideos({ status: filters.status }),
  ]);
  const publicItems = await Promise.all(items.map((item) => buildPublicCatalogItem(req, item)));

  res.json({
    service: SERVICE_NAME,
    version: VERSION,
    generated_at: new Date().toISOString(),
    media_backend: MEDIA_BACKEND,
    total,
    limit: filters.limit,
    offset: filters.offset,
    items: publicItems,
  });
}));

app.get(['/videos/:id', '/api/videos/:id'], withErrorHandling(async (req, res) => {
  const video = await mediaStore.getVideoById(req.params.id);
  if (!video) {
    throw createHttpError(404, 'Video not found.');
  }
  res.json(await buildPublicCatalogItem(req, video));
}));

app.get('/videos/:id/subtitle-document', withErrorHandling(async (req, res) => {
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }

  const subtitlePath = resolveExistingFile(SUBTITLE_DIR, item.subtitleDocumentFile);
  if (subtitlePath) {
    res.json(JSON.parse(fs.readFileSync(subtitlePath, 'utf8')));
    return;
  }

  const published = await resolvePublishedAssetUrls(req, item);
  maybeRedirectToExternalAsset(req, res, published.subtitleDocumentUrl);
}));

app.get('/media/:id/stream', withErrorHandling(async (req, res) => {
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }

  const mediaPath = resolveExistingFile(MEDIA_DIR, item.mediaFile);
  if (mediaPath) {
    res.sendFile(mediaPath);
    return;
  }

  const published = await resolvePublishedAssetUrls(req, item);
  maybeRedirectToExternalAsset(req, res, published.mediaUrl || published.downloadUrl);
}));

app.get('/media/:id/download', withErrorHandling(async (req, res) => {
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }

  const mediaPath = resolveExistingFile(MEDIA_DIR, item.mediaFile);
  if (mediaPath) {
    res.download(mediaPath, item.mediaFile || `${item.id}.bin`);
    return;
  }

  const published = await resolvePublishedAssetUrls(req, item);
  if (published.sourceAsset) {
    await streamMediaAssetDownload(req, res, published.sourceAsset, item.mediaFile || `${item.id}.bin`);
    return;
  }

  maybeRedirectToExternalAsset(req, res, published.downloadUrl || published.mediaUrl);
}));

app.get('/internal/assets/:id/download', requireInternal, withErrorHandling(async (req, res) => {
  const asset = await mediaStore.getMediaAssetById(req.params.id);
  await streamMediaAssetDownload(req, res, asset, `${req.params.id}.bin`);
}));

app.get('/media/:id/thumbnail', withErrorHandling(async (req, res) => {
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }

  const thumbnailPath = resolveExistingFile(THUMBNAIL_DIR, item.thumbnailFile);
  if (thumbnailPath) {
    res.sendFile(thumbnailPath);
    return;
  }

  const published = await resolvePublishedAssetUrls(req, item);
  maybeRedirectToExternalAsset(req, res, published.thumbnailUrl);
}));

app.get('/admin/videos', requireAdmin, withErrorHandling(async (req, res) => {
  const filters = {
    status: normalizeString(req.query.status),
    limit: Math.max(1, Math.min(500, Math.round(coerceNumber(req.query.limit, 100)))),
    offset: Math.max(0, Math.round(coerceNumber(req.query.offset, 0))),
  };
  const [items, total] = await Promise.all([
    mediaStore.listVideos(filters),
    mediaStore.countVideos({ status: filters.status }),
  ]);
  const result = await Promise.all(items.map((item) => buildAdminCatalogItem(req, item)));
  res.json({
    items: result,
    total,
    service: SERVICE_NAME,
    version: VERSION,
    storageMode: STORAGE_MODE,
    allowLocalUploads: ALLOW_LOCAL_UPLOADS,
    mediaBackend: MEDIA_BACKEND,
  });
}));

app.get('/admin/videos/:id', requireAdmin, withErrorHandling(async (req, res) => {
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }
  res.json(await buildAdminCatalogItem(req, item));
}));

app.get('/admin/audit-logs', requireAdmin, withErrorHandling(async (req, res) => {
  const filters = {
    videoId: normalizeString(req.query.videoId || req.query.video_id),
    limit: Math.max(1, Math.min(500, Math.round(coerceNumber(req.query.limit, 100)))),
    offset: Math.max(0, Math.round(coerceNumber(req.query.offset, 0))),
  };
  const [items, total] = await Promise.all([
    mediaStore.listAuditLogs(filters),
    mediaStore.countAuditLogs({ videoId: filters.videoId }),
  ]);
  res.json({
    items,
    total,
    limit: filters.limit,
    offset: filters.offset,
    videoId: filters.videoId || '',
    service: SERVICE_NAME,
    version: VERSION,
  });
}));

app.post('/admin/videos', requireAdmin, jsonParser, withErrorHandling(async (req, res) => {
  if (!isObject(req.body)) {
    throw createHttpError(400, 'Invalid video payload.');
  }
  const next = normalizeVideoPayload(req.body);
  if (await mediaStore.getVideoById(next.id)) {
    throw createHttpError(409, `Video ${next.id} already exists.`);
  }
  const created = await mediaStore.createVideo(next);
  await writeAuditLog(req, {
    action: 'video.create',
    videoId: created.id,
    summary: `Created video ${created.id}`,
    details: {
      title: created.title,
      provider: created.provider,
      language: created.language,
      mediaType: created.mediaType,
      status: created.status,
    },
  });
  res.status(201).json(await buildAdminCatalogItem(req, created));
}));

app.put('/admin/videos/:id', requireAdmin, jsonParser, withErrorHandling(async (req, res) => {
  if (!isObject(req.body)) {
    throw createHttpError(400, 'Invalid video payload.');
  }
  const current = await mediaStore.getVideoById(req.params.id);
  if (!current) {
    throw createHttpError(404, 'Video not found.');
  }
  const normalized = normalizeVideoPayload(req.body, current);
  if (normalized.id !== current.id) {
    throw createHttpError(400, 'Changing existing video id is not supported.');
  }
  const updated = await mediaStore.updateVideo(current.id, normalized);
  await writeAuditLog(req, {
    action: 'video.update',
    videoId: updated.id,
    summary: `Updated video ${updated.id}`,
    details: {
      changedFields: listChangedVideoFields(current, updated),
      title: updated.title,
      status: updated.status,
    },
  });
  res.json(await buildAdminCatalogItem(req, updated));
}));

app.delete('/admin/videos/:id', requireAdmin, withErrorHandling(async (req, res) => {
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }

  const deleteFiles = coerceBoolean(req.query.deleteFiles, false);
  await mediaStore.deleteVideo(item.id);

  if (deleteFiles) {
    [
      resolveExistingFile(MEDIA_DIR, item.mediaFile),
      resolveExistingFile(THUMBNAIL_DIR, item.thumbnailFile),
      resolveExistingFile(SUBTITLE_DIR, item.subtitleDocumentFile),
    ].filter(Boolean).forEach((filePath) => fs.unlinkSync(filePath));
  }

  await writeAuditLog(req, {
    action: 'video.delete',
    videoId: item.id,
    summary: `Deleted video ${item.id}`,
    details: {
      title: item.title,
      deleteFiles,
      mediaFile: item.mediaFile || '',
      thumbnailFile: item.thumbnailFile || '',
      subtitleDocumentFile: item.subtitleDocumentFile || '',
    },
  });

  res.json({ ok: true, deletedId: item.id, deletedFiles: deleteFiles });
}));

app.put('/admin/videos/:id/media', requireAdmin, rawMediaParser, withErrorHandling(async (req, res) => {
  assertUploadsEnabled();
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw createHttpError(400, '媒体文件为空。');
  }

  const uploadedTitle = extractUploadDisplayTitle(req.header('x-filename'));
  const fileName = resolveUploadFileName(item.id, req.header('x-filename'), '.mp4');
  const mediaPath = writeBinaryFile(MEDIA_DIR, fileName, req.body);
  const detectedDurationSeconds = await probeMediaDurationSeconds(mediaPath);
  const updated = await mediaStore.updateVideo(item.id, {
    title: shouldReplaceTitleFromUpload(item, uploadedTitle) ? uploadedTitle : item.title,
    durationSeconds: detectedDurationSeconds ?? item.durationSeconds,
    mediaFile: fileName,
    mediaType: inferMediaTypeFromFileName(fileName),
    mediaUrl: '',
    downloadUrl: '',
    sourceAssetId: '',
  });
  await writeAuditLog(req, {
    action: 'video.upload_media',
    videoId: updated.id,
    summary: `Uploaded media for ${updated.id}`,
    details: {
      fileName,
      uploadedBytes: req.body.length,
      mediaType: updated.mediaType,
      detectedDurationSeconds: detectedDurationSeconds ?? null,
    },
  });

  res.json({
    ok: true,
    uploaded: fileName,
    detectedDurationSeconds,
    item: await buildAdminCatalogItem(req, updated),
  });
}));

app.put('/admin/videos/:id/thumbnail', requireAdmin, rawMediaParser, withErrorHandling(async (req, res) => {
  assertUploadsEnabled();
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw createHttpError(400, '缩略图文件为空。');
  }

  const fileName = resolveUploadFileName(item.id, req.header('x-filename'), '.jpg');
  writeBinaryFile(THUMBNAIL_DIR, fileName, req.body);
  const updated = await mediaStore.updateVideo(item.id, {
    thumbnailFile: fileName,
    thumbnailUrl: '',
    coverAssetId: '',
  });
  await writeAuditLog(req, {
    action: 'video.upload_thumbnail',
    videoId: updated.id,
    summary: `Uploaded thumbnail for ${updated.id}`,
    details: {
      fileName,
      uploadedBytes: req.body.length,
    },
  });
  res.json({ ok: true, uploaded: fileName, item: await buildAdminCatalogItem(req, updated) });
}));

app.put('/admin/videos/:id/subtitle-document', requireAdmin, textParser, withErrorHandling(async (req, res) => {
  assertUploadsEnabled();
  const item = await mediaStore.getVideoById(req.params.id);
  if (!item) {
    throw createHttpError(404, 'Video not found.');
  }
  const rawText = typeof req.body === 'string' ? req.body.trim() : '';
  if (!rawText) {
    throw createHttpError(400, '字幕 JSON 不能为空。');
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw createHttpError(400, '字幕文件必须是合法 JSON。');
  }

  const fileName = resolveUploadFileName(item.id, req.header('x-filename'), '.json');
  fs.writeFileSync(path.join(SUBTITLE_DIR, fileName), JSON.stringify(payload, null, 2) + '\n');
  const summary = subtitleSummaryFromDocument(payload);
  const updated = await mediaStore.updateVideo(item.id, {
    subtitleDocumentFile: fileName,
    subtitleDocumentUrl: '',
    subtitleAssetId: '',
    hasRefinedSubtitles: summary.hasRefinedSubtitles,
    hasTranslation: summary.hasTranslation,
    referenceText: summary.referenceText || item.referenceText,
  });
  await writeAuditLog(req, {
    action: 'video.upload_subtitle',
    videoId: updated.id,
    summary: `Uploaded subtitle document for ${updated.id}`,
    details: {
      fileName,
      hasRefinedSubtitles: summary.hasRefinedSubtitles,
      hasTranslation: summary.hasTranslation,
    },
  });
  res.json({ ok: true, uploaded: fileName, item: await buildAdminCatalogItem(req, updated) });
}));

app.post(['/upload-sessions', '/api/upload-sessions'], jsonParser, withErrorHandling(async (req, res) => {
  if (!isObject(req.body)) {
    throw createHttpError(400, 'Invalid upload session payload.');
  }

  const fileName = normalizeString(req.body.fileName || req.body.file_name, 'media.bin');
  const bucket = normalizeString(req.body.bucket, MEDIA_BUCKET);
  const objectKey = normalizeString(req.body.objectKey || req.body.object_key) || buildObjectKey({ fileName });
  const now = Date.now();
  const expiresAt = new Date(now + MEDIA_UPLOAD_SESSION_TTL_SEC * 1000).toISOString();

  const uploadSession = await mediaStore.createUploadSession({
    id: randomUUID(),
    userId: normalizeString(req.body.userId || req.body.user_id),
    purpose: normalizeString(req.body.purpose, 'video_source'),
    mediaType: normalizeString(req.body.mediaType || req.body.media_type, 'video'),
    fileName,
    mimeType: normalizeString(req.body.mimeType || req.body.mime_type),
    sizeBytes: coerceNumber(req.body.sizeBytes ?? req.body.size_bytes, null),
    bucket,
    objectKey,
    status: 'issued',
    assetId: '',
    expiresAt,
  });

  const upload = await buildUploadInstruction({
    bucket,
    objectKey,
    mimeType: normalizeString(req.body.mimeType || req.body.mime_type),
    expiresAt,
    sessionId: uploadSession.id,
    req,
  });
  res.status(201).json({
    ok: true,
    upload_session: uploadSession,
    upload,
  });
}));

app.post(['/upload-sessions/:id/confirm', '/api/upload-sessions/:id/confirm'], jsonParser, withErrorHandling(async (req, res) => {
  if (!isObject(req.body)) {
    throw createHttpError(400, 'Invalid upload confirm payload.');
  }

  const session = await mediaStore.getUploadSessionById(req.params.id);
  if (!session) {
    throw createHttpError(404, 'Upload session not found.');
  }
  if (!['issued', 'confirmed'].includes(session.status)) {
    throw createHttpError(409, `Upload session status ${session.status} cannot be confirmed.`);
  }
  if (session.expiresAt && Date.now() > Date.parse(session.expiresAt)) {
    await mediaStore.updateUploadSession(session.id, { status: 'expired' });
    throw createHttpError(410, 'Upload session has expired.');
  }

  const bucket = normalizeString(req.body.bucket, session.bucket || MEDIA_BUCKET);
  const objectKey = normalizeString(req.body.objectKey || req.body.object_key, session.objectKey);
  const fileName = normalizeString(req.body.fileName || req.body.file_name, session.fileName);
  if (!objectKey) {
    throw createHttpError(400, 'objectKey is required to confirm upload.');
  }

  let asset = await mediaStore.findMediaAssetByObjectKey(bucket, objectKey);
  if (!asset) {
    const fileId = normalizeString(req.body.fileId || req.body.file_id) || buildCloudFileId({ bucket, objectKey });
    asset = await mediaStore.createMediaAsset({
      id: randomUUID(),
      userId: normalizeString(req.body.userId || req.body.user_id, session.userId),
      purpose: normalizeString(req.body.purpose, session.purpose),
      mediaType: normalizeString(req.body.mediaType || req.body.media_type, session.mediaType),
      fileName,
      mimeType: normalizeString(req.body.mimeType || req.body.mime_type, session.mimeType),
      sizeBytes: coerceNumber(req.body.sizeBytes ?? req.body.size_bytes, session.sizeBytes),
      bucket,
      objectKey,
      fileId,
      checksum: normalizeString(req.body.checksum),
      status: 'ready',
      source: 'upload_session',
    });
  }

  const updatedSession = await mediaStore.updateUploadSession(session.id, {
    status: 'confirmed',
    assetId: asset.id,
    bucket,
    objectKey,
    mimeType: normalizeString(req.body.mimeType || req.body.mime_type, session.mimeType),
    sizeBytes: coerceNumber(req.body.sizeBytes ?? req.body.size_bytes, session.sizeBytes),
  });

  let video = null;
  const createVideo = coerceBoolean(req.body.createVideo ?? req.body.create_video, session.purpose === 'video_source');
  if (createVideo) {
    const explicitVideoId = normalizeString(req.body.videoId || req.body.video_id || req.body.video?.id);
    const fallbackVideoName = path.parse(fileName || objectKey).name || 'video';
    const videoId = slugify(explicitVideoId || fallbackVideoName) || randomUUID();
    const existing = await mediaStore.getVideoById(videoId);

    if (existing) {
      video = await mediaStore.updateVideo(existing.id, {
        sourceAssetId: asset.id,
        mediaType: normalizeString(req.body.mediaType || req.body.media_type, existing.mediaType),
        mediaUrl: normalizeString(req.body.mediaUrl || req.body.media_url, existing.mediaUrl),
        downloadUrl: normalizeString(req.body.downloadUrl || req.body.download_url, existing.downloadUrl),
      });
    } else {
      const normalizedVideo = normalizeVideoPayload(
        {
          ...(isObject(req.body.video) ? req.body.video : {}),
          id: videoId,
          title: normalizeString(req.body.title, path.parse(fileName).name || videoId),
          mediaType: normalizeString(req.body.mediaType || req.body.media_type, 'video'),
          sourceAssetId: asset.id,
          mediaUrl: normalizeString(req.body.mediaUrl || req.body.media_url),
          downloadUrl: normalizeString(req.body.downloadUrl || req.body.download_url),
        },
        null,
      );
      video = await mediaStore.createVideo(normalizedVideo);
    }
  }

  await writeAuditLog(req, {
    action: 'upload_session.confirm',
    videoId: video?.id || '',
    summary: `Confirmed upload session ${updatedSession.id}`,
    details: {
      sessionId: updatedSession.id,
      assetId: asset.id,
      purpose: updatedSession.purpose,
      objectKey: updatedSession.objectKey,
      bucket: updatedSession.bucket,
      createdVideo: Boolean(video),
      videoId: video?.id || '',
    },
  });

  res.json({
    ok: true,
    upload_session: updatedSession,
    media_asset: asset,
    video: video ? await buildPublicCatalogItem(req, video) : null,
  });
}));

app.get('/internal/videos/:id/source', requireInternal, withErrorHandling(async (req, res) => {
  const video = await mediaStore.getVideoById(req.params.id);
  if (!video) {
    throw createHttpError(404, 'Video not found.');
  }

  const published = await resolvePublishedAssetUrls(req, video);
  const sourceUri =
    published.downloadUrl ||
    published.mediaUrl ||
    normalizeString(video.mediaUrl) ||
    normalizeString(video.downloadUrl) ||
    normalizeString(published.sourceAsset?.fileId) ||
    buildCloudFileId({ bucket: published.sourceAsset?.bucket || MEDIA_BUCKET, objectKey: published.sourceAsset?.objectKey || '' }) ||
    buildPublicAssetUrl(published.sourceAsset?.objectKey || '') ||
    normalizeString(published.sourceAsset?.objectKey);

  if (!sourceUri) {
    throw createHttpError(409, 'Video source is not ready.');
  }

  res.json({
    video_id: video.id,
    source_uri: sourceUri,
    source_asset_id: published.sourceAsset?.id || video.sourceAssetId || '',
    source_asset: published.sourceAsset || null,
  });
}));

app.post('/internal/videos/:id/subtitle-asset', requireInternal, jsonParser, withErrorHandling(async (req, res) => {
  if (!isObject(req.body)) {
    throw createHttpError(400, 'Invalid subtitle asset payload.');
  }
  const current = await mediaStore.getVideoById(req.params.id);
  if (!current) {
    throw createHttpError(404, 'Video not found.');
  }

  const inlineSubtitleDocument = req.body.subtitleDocument || req.body.subtitle_document;
  if (isObject(inlineSubtitleDocument)) {
    const fileName = resolveUploadFileName(
      current.id,
      normalizeString(req.body.fileName || req.body.file_name, `${current.id}.json`),
      '.json',
    );
    fs.writeFileSync(
      path.join(SUBTITLE_DIR, fileName),
      JSON.stringify(inlineSubtitleDocument, null, 2) + '\n',
    );
    const summary = subtitleSummaryFromDocument(inlineSubtitleDocument);
    const updated = await mediaStore.updateVideo(current.id, {
      subtitleAssetId: '',
      subtitleDocumentFile: fileName,
      subtitleDocumentUrl: '',
      hasRefinedSubtitles: coerceBoolean(
        req.body.hasRefinedSubtitles ?? req.body.has_refined_subtitles,
        summary.hasRefinedSubtitles,
      ),
      hasTranslation: coerceBoolean(
        req.body.hasTranslation ?? req.body.has_translation,
        summary.hasTranslation,
      ),
      referenceText: normalizeString(
        req.body.referenceText || req.body.reference_text,
        summary.referenceText || current.referenceText,
      ),
    });

    res.json({
      ok: true,
      mode: 'inline_subtitle_document',
      video: await buildPublicCatalogItem(req, updated),
      subtitle_asset: null,
      subtitle_document_file: fileName,
    });
    return;
  }

  let subtitleAsset = null;
  const requestedAssetId = normalizeString(req.body.assetId || req.body.asset_id);
  if (requestedAssetId) {
    subtitleAsset = await mediaStore.getMediaAssetById(requestedAssetId);
    if (!subtitleAsset) {
      throw createHttpError(404, 'Subtitle asset not found.');
    }
  } else {
    const bucket = normalizeString(req.body.bucket, MEDIA_BUCKET);
    const objectKey = normalizeString(req.body.objectKey || req.body.object_key);
    if (!objectKey) {
      throw createHttpError(400, 'objectKey is required when assetId is not provided.');
    }
    subtitleAsset =
      (await mediaStore.findMediaAssetByObjectKey(bucket, objectKey)) ||
      (await mediaStore.createMediaAsset({
        id: randomUUID(),
        userId: normalizeString(req.body.userId || req.body.user_id),
        purpose: 'subtitle_result',
        mediaType: 'subtitle',
        fileName: normalizeString(req.body.fileName || req.body.file_name, `${current.id}.json`),
        mimeType: normalizeString(req.body.mimeType || req.body.mime_type, 'application/json'),
        sizeBytes: coerceNumber(req.body.sizeBytes ?? req.body.size_bytes, null),
        bucket,
        objectKey,
        fileId: normalizeString(req.body.fileId || req.body.file_id) || buildCloudFileId({ bucket, objectKey }),
        checksum: normalizeString(req.body.checksum),
        status: 'ready',
        source: 'task_result',
      }));
  }

  const updated = await mediaStore.updateVideo(current.id, {
    subtitleAssetId: subtitleAsset.id,
    subtitleDocumentFile: '',
    subtitleDocumentUrl: normalizeString(req.body.subtitleDocumentUrl || req.body.subtitle_document_url, current.subtitleDocumentUrl),
    hasRefinedSubtitles: coerceBoolean(
      req.body.hasRefinedSubtitles ?? req.body.has_refined_subtitles,
      current.hasRefinedSubtitles || true,
    ),
    hasTranslation: coerceBoolean(req.body.hasTranslation ?? req.body.has_translation, current.hasTranslation),
    referenceText: normalizeString(req.body.referenceText || req.body.reference_text, current.referenceText),
  });

  res.json({
    ok: true,
    video: await buildPublicCatalogItem(req, updated),
    subtitle_asset: subtitleAsset,
  });
}));

app.use((error, _req, res, _next) => {
  const status = Number(error?.status || error?.statusCode || 500);
  const isEntityTooLarge = error?.type === 'entity.too.large' || status === 413;
  const message = isEntityTooLarge
    ? `上传内容过大。当前媒体上限 ${MAX_MEDIA_UPLOAD_MB} MB，字幕上限 ${MAX_SUBTITLE_UPLOAD_MB} MB。`
    : error instanceof Error
      ? error.message
      : 'Internal server error.';
  if (status >= 500 && !isEntityTooLarge) {
    console.error(error);
  }
  res.status(isEntityTooLarge ? 413 : status).json({ message });
});

app.listen(PORT, HOST, () => {
  console.log(`[${SERVICE_NAME}] listening on http://${HOST}:${PORT} backend=${MEDIA_BACKEND} storage=${STORAGE_MODE}`);
});
