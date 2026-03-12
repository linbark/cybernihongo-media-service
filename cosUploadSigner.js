import COS from 'cos-nodejs-sdk-v5';

const pickTrimmedValue = (...values) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
};

const normalizeProtocol = (value) => {
  const normalized = pickTrimmedValue(value, 'https').toLowerCase();
  return normalized.endsWith(':') ? normalized : `${normalized}:`;
};

const callbackToPromise = (fn, options) =>
  new Promise((resolve, reject) => {
    fn(options, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });

const normalizeSignedUrl = (value) => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.Url === 'string') return value.Url;
    if (typeof value.url === 'string') return value.url;
  }
  return String(value || '');
};

export const createCosUploadSigner = ({
  secretId = '',
  secretKey = '',
  sessionToken = '',
  region = '',
  protocol = 'https:',
  domain = '',
} = {}) => {
  const resolvedSecretId = pickTrimmedValue(secretId);
  const resolvedSecretKey = pickTrimmedValue(secretKey);
  const resolvedSessionToken = pickTrimmedValue(sessionToken);
  const resolvedRegion = pickTrimmedValue(region);
  const resolvedProtocol = normalizeProtocol(protocol);
  const resolvedDomain = pickTrimmedValue(domain);

  const configured = Boolean(resolvedSecretId && resolvedSecretKey && resolvedRegion);
  const client = configured
    ? new COS({
        SecretId: resolvedSecretId,
        SecretKey: resolvedSecretKey,
        SecurityToken: resolvedSessionToken || undefined,
      })
    : null;

  return {
    configured,
    summary: {
      configured,
      region: resolvedRegion || undefined,
      protocol: resolvedProtocol,
      domain: resolvedDomain || undefined,
      usesSessionToken: Boolean(resolvedSessionToken),
    },
    async createPresignedPut({
      bucket,
      objectKey,
      expiresInSec = 1800,
      contentType = '',
    }) {
      if (!client) {
        throw new Error('COS upload signer is not configured.');
      }

      const headers = {};
      if (pickTrimmedValue(contentType)) {
        headers['Content-Type'] = pickTrimmedValue(contentType);
      }

      const signedUrl = await callbackToPromise(client.getObjectUrl.bind(client), {
        Bucket: bucket,
        Region: resolvedRegion,
        Key: objectKey,
        Sign: true,
        Expires: Math.max(60, Math.round(expiresInSec)),
        Method: 'PUT',
        Protocol: resolvedProtocol,
        Domain: resolvedDomain || undefined,
        Headers: headers,
      });

      return {
        url: normalizeSignedUrl(signedUrl),
        method: 'PUT',
        headers,
      };
    },
    async createPresignedGet({
      bucket,
      objectKey,
      expiresInSec = 1800,
    }) {
      if (!client) {
        throw new Error('COS upload signer is not configured.');
      }

      const signedUrl = await callbackToPromise(client.getObjectUrl.bind(client), {
        Bucket: bucket,
        Region: resolvedRegion,
        Key: objectKey,
        Sign: true,
        Expires: Math.max(60, Math.round(expiresInSec)),
        Method: 'GET',
        Protocol: resolvedProtocol,
        Domain: resolvedDomain || undefined,
      });

      return {
        url: normalizeSignedUrl(signedUrl),
        method: 'GET',
      };
    },
  };
};
