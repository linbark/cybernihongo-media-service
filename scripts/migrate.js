#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  CLOUDBASE_RDB_DRIVER,
  inferMediaDriver,
  resolveCloudbaseRdbConfig,
  summarizeCloudbaseRdbConnection,
} from '../cloudbaseRdb.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = path.resolve(SCRIPT_DIR, '..');
const MIGRATION_TABLE = 'media_migrations';

const normalizeString = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });

const parseArgs = (argv) => {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...valueParts] = arg.slice(2).split('=');
    options[key] = valueParts.length > 0 ? valueParts.join('=') : 'true';
  }
  return options;
};

const listMigrationFiles = (migrationDir) => {
  if (!fs.existsSync(migrationDir)) {
    throw new Error(`Migration directory not found: ${migrationDir}`);
  }
  return fs
    .readdirSync(migrationDir)
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
};

const readSql = (migrationDir, fileName) => fs.readFileSync(path.join(migrationDir, fileName), 'utf8');

const summarize = (driver, details) => JSON.stringify({ driver, ...details }, null, 2);

const summarizeTarget = ({ driver, dbFilePath = '', databaseUrl = '' }) => {
  if (driver === 'sqlite') {
    return path.resolve(dbFilePath);
  }
  if (driver === CLOUDBASE_RDB_DRIVER) {
    return summarizeCloudbaseRdbConnection(resolveCloudbaseRdbConfig(process.env));
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

const ensureMysqlIndexes = async (pool) => {
  const safeCreate = async (table, indexName, sql) => {
    const [rows] = await pool.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
    if (Array.isArray(rows) && rows.length > 0) return;
    await pool.query(sql);
  };

  await safeCreate('videos', 'idx_videos_updated_at', 'CREATE INDEX idx_videos_updated_at ON videos(updated_at)');
  await safeCreate('videos', 'idx_videos_published_at', 'CREATE INDEX idx_videos_published_at ON videos(published_at)');
  await safeCreate(
    'media_assets',
    'idx_media_assets_object_key',
    'CREATE INDEX idx_media_assets_object_key ON media_assets(bucket, object_key(255))',
  );
  await safeCreate(
    'media_assets',
    'idx_media_assets_updated_at',
    'CREATE INDEX idx_media_assets_updated_at ON media_assets(updated_at)',
  );
  await safeCreate(
    'upload_sessions',
    'idx_upload_sessions_object_key',
    'CREATE INDEX idx_upload_sessions_object_key ON upload_sessions(bucket, object_key(255))',
  );
  await safeCreate(
    'upload_sessions',
    'idx_upload_sessions_status',
    'CREATE INDEX idx_upload_sessions_status ON upload_sessions(status)',
  );
  await safeCreate(
    'upload_sessions',
    'idx_upload_sessions_updated_at',
    'CREATE INDEX idx_upload_sessions_updated_at ON upload_sessions(updated_at)',
  );
  await safeCreate(
    'audit_logs',
    'idx_audit_logs_video_created_at',
    'CREATE INDEX idx_audit_logs_video_created_at ON audit_logs(video_id, created_at)',
  );
  await safeCreate(
    'audit_logs',
    'idx_audit_logs_created_at',
    'CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at)',
  );
};

const runSqliteMigrations = ({ dbFilePath, migrationDir, files }) => {
  ensureDir(path.dirname(dbFilePath));
  const db = new DatabaseSync(dbFilePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare(`SELECT name FROM ${MIGRATION_TABLE} ORDER BY name ASC`).all();
  const applied = new Set(appliedRows.map((row) => row.name));
  const markAppliedStmt = db.prepare(`INSERT INTO ${MIGRATION_TABLE} (name, applied_at) VALUES (?, ?)`);

  let appliedCount = 0;
  for (const fileName of files) {
    if (applied.has(fileName)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readSql(migrationDir, fileName));
      markAppliedStmt.run(fileName, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    appliedCount += 1;
  }

  db.close();
  return {
    applied: appliedCount,
    skipped: files.length - appliedCount,
    target: summarizeTarget({ driver: 'sqlite', dbFilePath }),
    migrationDir,
  };
};

const runPostgresMigrations = async ({ databaseUrl, migrationDir, files }) => {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const { rows } = await pool.query(`SELECT name FROM ${MIGRATION_TABLE} ORDER BY name ASC`);
  const applied = new Set(rows.map((row) => row.name));
  const client = await pool.connect();
  let appliedCount = 0;

  try {
    for (const fileName of files) {
      if (applied.has(fileName)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readSql(migrationDir, fileName));
        await client.query(`INSERT INTO ${MIGRATION_TABLE} (name, applied_at) VALUES ($1, $2)`, [fileName, new Date().toISOString()]);
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  return {
    applied: appliedCount,
    skipped: files.length - appliedCount,
    target: summarizeTarget({ driver: 'postgres', databaseUrl }),
    migrationDir,
  };
};

const runMysqlMigrations = async ({ databaseUrl, migrationDir, files }) => {
  const mysql = await import('mysql2/promise');
  const connectionUrl = new URL(databaseUrl);
  if (!connectionUrl.searchParams.has('multipleStatements')) {
    connectionUrl.searchParams.set('multipleStatements', 'true');
  }
  const pool = mysql.createPool(connectionUrl.toString());
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      name VARCHAR(191) PRIMARY KEY,
      applied_at VARCHAR(64) NOT NULL
    )
  `);
  const [rows] = await pool.query(`SELECT name FROM ${MIGRATION_TABLE} ORDER BY name ASC`);
  const applied = new Set(rows.map((row) => row.name));
  const connection = await pool.getConnection();
  let appliedCount = 0;

  try {
    for (const fileName of files) {
      if (applied.has(fileName)) continue;
      await connection.beginTransaction();
      try {
        await connection.query(readSql(migrationDir, fileName));
        await connection.query(`INSERT INTO ${MIGRATION_TABLE} (name, applied_at) VALUES (?, ?)`, [fileName, new Date().toISOString()]);
        await connection.commit();
        appliedCount += 1;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    await ensureMysqlIndexes(pool);
  } finally {
    connection.release();
    await pool.end();
  }

  return {
    applied: appliedCount,
    skipped: files.length - appliedCount,
    target: summarizeTarget({ driver: 'mysql', databaseUrl }),
    migrationDir,
  };
};

const runCloudbaseRdbMigrations = ({ target, manualSqlFile }) => ({
  applied: 0,
  skipped: 0,
  target,
  manualSqlFile,
  note: 'CloudBase RDB 模式不会自动执行 SQL 迁移，请先在 CloudBase MySQL 中创建 videos/media_assets/upload_sessions/audit_logs 表。',
});

const printHelp = () => {
  console.log(`Usage: node scripts/migrate.js [--driver=sqlite|postgres|mysql|cloudbase_rdb] [--db-file=FILE] [--database-url=URL] [--migration-dir=DIR]

Environment fallbacks:
  MEDIA_DB_DRIVER
  MEDIA_DB_FILE
  MEDIA_DATABASE_URL / DATABASE_URL
  TCB_ENV_ID / CLOUDBASE_ENV_ID
  MEDIA_CLOUDBASE_DB_INSTANCE
  MEDIA_CLOUDBASE_DATABASE
  MEDIA_CLOUDBASE_VIDEOS_TABLE
  MEDIA_CLOUDBASE_ASSETS_TABLE
  MEDIA_CLOUDBASE_UPLOAD_SESSIONS_TABLE
  MEDIA_CLOUDBASE_AUDIT_LOGS_TABLE`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printHelp();
    return;
  }

  const databaseUrl = normalizeString(args['database-url'] || process.env.MEDIA_DATABASE_URL || process.env.DATABASE_URL);
  const driver = inferMediaDriver({
    driver: normalizeString(args.driver || process.env.MEDIA_DB_DRIVER || process.env.CATALOG_DB_DRIVER),
    databaseUrl,
  });
  const dbFilePath = path.resolve(
    normalizeString(args['db-file'] || process.env.MEDIA_DB_FILE || process.env.CATALOG_DB_FILE || path.join(SERVICE_ROOT, 'data', 'media.db')),
  );
  const cloudbaseRdbConfig = resolveCloudbaseRdbConfig({
    ...process.env,
    ...(args['env-id'] ? { TCB_ENV_ID: args['env-id'], CLOUDBASE_ENV_ID: args['env-id'] } : {}),
    ...(args['cloudbase-instance'] ? { MEDIA_CLOUDBASE_DB_INSTANCE: args['cloudbase-instance'] } : {}),
    ...(args['cloudbase-database'] ? { MEDIA_CLOUDBASE_DATABASE: args['cloudbase-database'] } : {}),
    ...(args['cloudbase-videos-table'] ? { MEDIA_CLOUDBASE_VIDEOS_TABLE: args['cloudbase-videos-table'] } : {}),
    ...(args['cloudbase-assets-table'] ? { MEDIA_CLOUDBASE_ASSETS_TABLE: args['cloudbase-assets-table'] } : {}),
    ...(args['cloudbase-upload-sessions-table']
      ? { MEDIA_CLOUDBASE_UPLOAD_SESSIONS_TABLE: args['cloudbase-upload-sessions-table'] }
      : {}),
  });
  const migrationDir =
    driver === CLOUDBASE_RDB_DRIVER
      ? ''
      : path.resolve(normalizeString(args['migration-dir'] || path.join(SERVICE_ROOT, 'migrations', driver)));
  const files = driver === CLOUDBASE_RDB_DRIVER ? [] : listMigrationFiles(migrationDir);

  if (driver === 'postgres' && !databaseUrl) {
    throw new Error('Postgres 模式需要提供 MEDIA_DATABASE_URL。');
  }
  if (driver === 'mysql' && !databaseUrl) {
    throw new Error('MySQL 模式需要提供 MEDIA_DATABASE_URL。');
  }
  if (driver === CLOUDBASE_RDB_DRIVER && !cloudbaseRdbConfig.envId) {
    throw new Error('CloudBase RDB 模式需要提供 TCB_ENV_ID 或 CLOUDBASE_ENV_ID。');
  }

  let result;
  if (driver === 'sqlite') {
    result = runSqliteMigrations({ dbFilePath, migrationDir, files });
  } else if (driver === 'postgres') {
    result = await runPostgresMigrations({ databaseUrl, migrationDir, files });
  } else if (driver === 'mysql') {
    result = await runMysqlMigrations({ databaseUrl, migrationDir, files });
  } else {
    result = runCloudbaseRdbMigrations({
      target: summarizeCloudbaseRdbConnection(cloudbaseRdbConfig),
      manualSqlFile: path.resolve(SERVICE_ROOT, 'migrations', 'mysql', '001_init.sql'),
    });
  }

  console.log(summarize(driver, result));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
