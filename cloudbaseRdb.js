const normalizeString = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);

export const CLOUDBASE_RDB_DRIVER = 'cloudbase_rdb';

const CLOUDBASE_RDB_DRIVER_ALIASES = new Set([
  CLOUDBASE_RDB_DRIVER,
  'cloudbase-rdb',
  'cloudbase',
  'rdb',
  'tcb_rdb',
  'tcb-rdb',
]);

const pickValue = (source, ...names) => {
  for (const name of names) {
    const value = normalizeString(source?.[name]);
    if (value) return value;
  }
  return '';
};

export const inferMediaDriver = ({ driver = '', databaseUrl = '' }) => {
  const normalizedDriver = normalizeString(driver).toLowerCase();
  if (CLOUDBASE_RDB_DRIVER_ALIASES.has(normalizedDriver)) return CLOUDBASE_RDB_DRIVER;
  if (normalizedDriver === 'sqlite' || normalizedDriver === 'postgres' || normalizedDriver === 'mysql') return normalizedDriver;
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) return 'postgres';
  if (databaseUrl.startsWith('mysql://')) return 'mysql';
  return 'sqlite';
};

export const resolveCloudbaseRdbConfig = (source = {}) => {
  const envId = pickValue(source, 'TCB_ENV_ID', 'CLOUDBASE_ENV_ID', 'TCB_ENV', 'CLOUDBASE_ENV');
  const accessKey = pickValue(source, 'CLOUDBASE_APIKEY', 'TCB_ACCESS_KEY', 'CLOUDBASE_ACCESS_KEY');
  const secretId = pickValue(
    source,
    'TENCENTCLOUD_SECRETID',
    'TENCENTCLOUD_SECRET_ID',
    'TCB_SECRET_ID',
    'CLOUDBASE_SECRETID',
    'CLOUDBASE_SECRET_ID',
  );
  const secretKey = pickValue(
    source,
    'TENCENTCLOUD_SECRETKEY',
    'TENCENTCLOUD_SECRET_KEY',
    'TCB_SECRET_KEY',
    'CLOUDBASE_SECRETKEY',
    'CLOUDBASE_SECRET_KEY',
  );
  const token = pickValue(
    source,
    'TENCENTCLOUD_SESSIONTOKEN',
    'TENCENTCLOUD_SESSION_TOKEN',
    'TCB_SESSION_TOKEN',
    'TENCENTCLOUD_TOKEN',
    'TCB_TOKEN',
  );
  const instance = pickValue(source, 'MEDIA_CLOUDBASE_DB_INSTANCE', 'CLOUDBASE_DB_INSTANCE', 'TCB_DB_INSTANCE') || 'default';
  const database = pickValue(source, 'MEDIA_CLOUDBASE_DATABASE', 'CLOUDBASE_DATABASE', 'TCB_DATABASE') || envId;
  const videosTable = pickValue(source, 'MEDIA_CLOUDBASE_VIDEOS_TABLE') || 'videos';
  const assetsTable = pickValue(source, 'MEDIA_CLOUDBASE_ASSETS_TABLE') || 'media_assets';
  const uploadSessionsTable = pickValue(source, 'MEDIA_CLOUDBASE_UPLOAD_SESSIONS_TABLE') || 'upload_sessions';
  const auditLogsTable = pickValue(source, 'MEDIA_CLOUDBASE_AUDIT_LOGS_TABLE') || 'audit_logs';

  return {
    envId,
    accessKey,
    secretId,
    secretKey,
    token,
    instance,
    database,
    videosTable,
    assetsTable,
    uploadSessionsTable,
    auditLogsTable,
  };
};

export const buildCloudbaseInitOptions = (source = {}) => {
  const rdbConfig = resolveCloudbaseRdbConfig(source);
  if (!rdbConfig.envId) {
    throw new Error('CloudBase RDB 模式需要设置 TCB_ENV_ID 或 CLOUDBASE_ENV_ID。');
  }
  if (!rdbConfig.database) {
    throw new Error('CloudBase RDB 模式需要设置 MEDIA_CLOUDBASE_DATABASE，或让它默认等于环境 ID。');
  }

  const initOptions = { env: rdbConfig.envId };
  if (rdbConfig.accessKey) {
    initOptions.accessKey = rdbConfig.accessKey;
    return { initOptions, rdbConfig };
  }

  if (rdbConfig.secretId || rdbConfig.secretKey) {
    if (!rdbConfig.secretId || !rdbConfig.secretKey) {
      throw new Error('CloudBase RDB 模式下 secretId/secretKey 必须成对设置。');
    }
    initOptions.secretId = rdbConfig.secretId;
    initOptions.secretKey = rdbConfig.secretKey;
    if (rdbConfig.token) {
      initOptions.token = rdbConfig.token;
      initOptions.sessionToken = rdbConfig.token;
    }
  }

  return { initOptions, rdbConfig };
};

export const summarizeCloudbaseRdbConnection = ({
  envId = '',
  instance = 'default',
  database = '',
  videosTable = 'videos',
  assetsTable = 'media_assets',
  uploadSessionsTable = 'upload_sessions',
  auditLogsTable = 'audit_logs',
}) =>
  `cloudbase_rdb://${envId || '(env)'}/${instance}/${database || '(database)'}?videos=${videosTable}&assets=${assetsTable}&sessions=${uploadSessionsTable}&audit=${auditLogsTable}`;
