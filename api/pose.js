import { getVercelOidcToken } from '@vercel/oidc';
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library';

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

let _cachedIdClient = null;
let _cachedAudience = '';

function _toBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function _getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function _isWifConfigured() {
  return Boolean(
    process.env.GCP_PROJECT_NUMBER &&
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID &&
    process.env.GCP_SERVICE_ACCOUNT_EMAIL
  );
}

function _wifConfig() {
  return {
    projectNumber: _getRequiredEnv('GCP_PROJECT_NUMBER'),
    poolId: _getRequiredEnv('GCP_WORKLOAD_IDENTITY_POOL_ID'),
    providerId: _getRequiredEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'),
    serviceAccountEmail: _getRequiredEnv('GCP_SERVICE_ACCOUNT_EMAIL'),
  };
}

function _parseServiceAccountJson(raw) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

async function _getIdToken(audience) {
  if (_isWifConfigured()) {
    return _getIdTokenViaWif(audience);
  }

  return _getIdTokenViaGoogleAuth(audience);
}

async function _getIdTokenViaWif(audience) {
  const { projectNumber, poolId, providerId, serviceAccountEmail } = _wifConfig();
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: getVercelOidcToken,
    },
  });

  const accessTokenResponse = await authClient.getAccessToken();
  const accessToken = typeof accessTokenResponse === 'string'
    ? accessTokenResponse
    : accessTokenResponse?.token;

  if (!accessToken) {
    throw new Error('Failed to mint federated access token via Workload Identity Federation');
  }

  const tokenRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateIdToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audience,
        includeEmail: true,
      }),
    }
  );

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`WIF generateIdToken failed (${tokenRes.status}): ${body}`);
  }

  const payload = await tokenRes.json();
  if (!payload?.token) {
    throw new Error('WIF generateIdToken succeeded but no token was returned');
  }

  return `Bearer ${payload.token}`;
}

async function _getIdTokenViaGoogleAuth(audience) {
  if (_cachedIdClient && _cachedAudience === audience) {
    const headers = await _cachedIdClient.getRequestHeaders(audience);
    return headers.Authorization || headers.authorization;
  }

  const credentials = _parseServiceAccountJson(process.env.GCP_SERVICE_ACCOUNT_JSON || '');
  const auth = credentials ? new GoogleAuth({ credentials }) : new GoogleAuth();
  _cachedIdClient = await auth.getIdTokenClient(audience);
  _cachedAudience = audience;

  const headers = await _cachedIdClient.getRequestHeaders(audience);
  return headers.Authorization || headers.authorization;
}

async function _readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function _requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  if (req.body === undefined || req.body === null) {
    return _readRawBody(req);
  }
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
    return req.body;
  }
  return JSON.stringify(req.body);
}

function _stripProxyPrefix(pathLike) {
  const raw = String(pathLike || '').replace(/^\/+/, '');
  if (raw === 'api/pose') return '';
  if (raw.startsWith('api/pose/')) return raw.slice('api/pose/'.length);
  return raw;
}

function _extractProxyPath(req) {
  const pathParam = req?.query?.path;
  if (Array.isArray(pathParam) && pathParam.length > 0) {
    return _stripProxyPrefix(pathParam.join('/'));
  }
  if (typeof pathParam === 'string' && pathParam.trim()) {
    return _stripProxyPrefix(pathParam);
  }

  const rawUrl = req?.url || '';
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    return _stripProxyPrefix(parsed.pathname);
  } catch {
    return _stripProxyPrefix(rawUrl.split('?')[0] || '');
  }
}

function _buildUpstreamUrl(req, baseUrl) {
  const path = _extractProxyPath(req);
  const rawUrl = req.url || '';
  const queryIndex = rawUrl.indexOf('?');
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';
  return path ? `${baseUrl}/${path}${query}` : `${baseUrl}${query}`;
}

function _copyResponseHeaders(upstream, res) {
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      return;
    }
    res.setHeader(key, value);
  });
}

export default async function handler(req, res) {
  try {
    const debugEnabled = _toBool(process.env.POSE_PROXY_DEBUG, false);

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const baseUrl = _getRequiredEnv('POSE_API_URL').replace(/\/+$/, '');
    const audience = (process.env.POSE_API_AUDIENCE || baseUrl).trim();
    const authHeader = await _getIdToken(audience);
    if (!authHeader) {
      throw new Error('Failed to mint identity token for upstream request');
    }

    const body = await _requestBody(req);
    const upstreamUrl = _buildUpstreamUrl(req, baseUrl);
    if (debugEnabled) {
      console.log(`[pose-proxy] ${req.method} ${req.url || ''} -> ${upstreamUrl}`);
    }
    const upstreamHeaders = {
      Authorization: authHeader,
    };

    if (req.headers['content-type']) {
      upstreamHeaders['Content-Type'] = req.headers['content-type'];
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
    });

    if (debugEnabled) {
      res.setHeader('x-pose-proxy-upstream-url', upstreamUrl);
      res.setHeader('x-pose-proxy-upstream-status', String(upstreamRes.status));
    }

    _copyResponseHeaders(upstreamRes, res);
    res.status(upstreamRes.status);

    const raw = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(raw);
  } catch (error) {
    const exposeDetails = _toBool(process.env.POSE_PROXY_EXPOSE_ERRORS, false);
    const debugEnabled = _toBool(process.env.POSE_PROXY_DEBUG, false);
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    if (debugEnabled) {
      console.error('[pose-proxy] request failed:', message);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
    res.status(500).json({
      error: 'pose_proxy_error',
      message: exposeDetails ? message : 'Proxy request failed',
    });
  }
}
